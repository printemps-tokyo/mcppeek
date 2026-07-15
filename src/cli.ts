#!/usr/bin/env node
import { parseArgs } from "node:util";
import { McpClient } from "./client.js";
import { inspect } from "./inspect.js";
import { hasErrors } from "./issue.js";
import { parseHeaderFlags, parseTimeout, toolResultIsError } from "./options.js";
import { renderJson, renderText, renderToolResult } from "./render.js";
import { StdioTransport } from "./transport-stdio.js";
import { HttpTransport } from "./transport-http.js";
import type { Transport } from "./transport.js";

const HELP = `mcppeek - inspect a Model Context Protocol (MCP) server

Usage:
  mcppeek [options] -- <command> [args...]   Launch a stdio MCP server and inspect it
  mcppeek [options] --url <endpoint>         Inspect a Streamable HTTP MCP server

Runs the MCP handshake, then lists the server's tools, resources, and prompts,
and lints their schemas (missing descriptions, malformed input schemas, etc.).
With --call it invokes one tool and prints the result.

Options:
  --url <endpoint>    Inspect an HTTP MCP endpoint instead of a stdio command
  --header <h>        Extra HTTP header as "Name: value" for --url (repeatable)
  --call <tool>       Call this tool instead of listing
  --args <json>       JSON object of arguments for --call (default: {})
  --lint-only         Print only the lint findings
  --timeout <ms>      Per-request timeout (default: 20000)
  --json              Output JSON instead of text
  --no-color          Disable ANSI colors
  -h, --help          Show this help
  -v, --version       Show version

Everything after -- is the server command run over stdio. The exit code is 1
when linting finds an error (a tool with no input schema, etc.), so it fits CI.
With --call the exit code is 2 when the tool result reports isError.

Examples:
  mcppeek -- npx -y @modelcontextprotocol/server-everything
  mcppeek --url https://example.com/mcp
  mcppeek --url https://example.com/mcp --header "Authorization: Bearer TOKEN"
  mcppeek --call add --args '{"a":2,"b":3}' -- node my-server.js
`;

async function readVersion(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = await readFile(join(here, "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/** Split argv at the first "--"; the tail is the stdio server command. */
function splitCommand(argv: string[]): { head: string[]; command: string[] } {
  const idx = argv.indexOf("--");
  return idx === -1 ? { head: argv, command: [] } : { head: argv.slice(0, idx), command: argv.slice(idx + 1) };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  if (argv[0] === "-v" || argv[0] === "--version") {
    process.stdout.write((await readVersion()) + "\n");
    return 0;
  }

  const { head, command } = splitCommand(argv);

  let values;
  try {
    values = parseArgs({
      args: head,
      allowPositionals: false,
      options: {
        url: { type: "string" },
        header: { type: "string", multiple: true },
        call: { type: "string" },
        args: { type: "string" },
        "lint-only": { type: "boolean", default: false },
        timeout: { type: "string" },
        json: { type: "boolean", default: false },
        "no-color": { type: "boolean", default: false },
      },
    }).values;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.stderr.write("run 'mcppeek --help' for usage.\n");
    return 1;
  }

  let timeoutMs: number | undefined;
  let headers: Record<string, string>;
  try {
    timeoutMs = parseTimeout(values.timeout);
    headers = parseHeaderFlags(values.header ?? []);
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }

  let transport: Transport;
  if (values.url) {
    transport = new HttpTransport({ url: values.url, headers, timeoutMs });
  } else if (command.length > 0) {
    transport = new StdioTransport({ command: command[0]!, args: command.slice(1), timeoutMs });
  } else {
    process.stderr.write("error: give a stdio command after -- , or --url <endpoint>\n\n" + HELP);
    return 1;
  }

  let callArgs: Record<string, unknown> = {};
  if (values.args) {
    try {
      callArgs = JSON.parse(values.args) as Record<string, unknown>;
    } catch (err) {
      process.stderr.write(`error: --args is not valid JSON: ${(err as Error).message}\n`);
      return 1;
    }
  }

  const color = !values["no-color"] && !process.env.NO_COLOR && process.stdout.isTTY === true;
  const client = new McpClient(transport);

  try {
    if (values.call) {
      await client.initialize();
      const result = await client.callTool(values.call, callArgs);
      process.stdout.write(values.json ? JSON.stringify(result, null, 2) + "\n" : renderToolResult(result, color));
      return toolResultIsError(result) ? 2 : 0;
    }

    const inspection = await inspect(client);
    if (values["lint-only"]) {
      process.stdout.write(values.json ? JSON.stringify(inspection.issues, null, 2) + "\n" : lintText(inspection.issues, color));
    } else {
      process.stdout.write(values.json ? renderJson(inspection) : renderText(inspection, color));
    }
    return hasErrors(inspection.issues) ? 1 : 0;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  } finally {
    await client.close();
  }
}

function lintText(issues: { severity: string; subject: string; message: string }[], color: boolean): string {
  if (issues.length === 0) return "no lint findings\n";
  const tag = (s: string): string => {
    if (!color) return s === "error" ? "error" : s === "warning" ? "warn " : "info ";
    const code = s === "error" ? "31" : s === "warning" ? "33" : "36";
    return `\x1b[${code}m${s === "warning" ? "warn " : s.padEnd(5)}\x1b[0m`;
  };
  return issues.map((i) => `${tag(i.severity)} ${i.subject}: ${i.message}`).join("\n") + "\n";
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
