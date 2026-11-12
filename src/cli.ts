#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { RecordingTransport, firstDifference, recordedCalls } from "./record.js";
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

Connects with the stateless 2026-07-28 protocol (server/discover) when the
server speaks it, else with the initialize handshake, then lists the server's
tools, resources, and prompts,
and lints their schemas (missing descriptions, malformed input schemas, etc.).
With --call it invokes one tool and prints the result.

Options:
  --url <endpoint>    Inspect an HTTP MCP endpoint instead of a stdio command
  --header <h>        Extra HTTP header as "Name: value" for --url (repeatable)
  --call <tool>       Call this tool instead of listing
  --args <json>       JSON object of arguments for --call (default: {})
  --lint-only         Print only the lint findings
  --legacy            Skip server/discover and use the initialize handshake
                      (for a stdio server that stays silent on unknown methods)
  --record <file>     Write every JSON-RPC message to <file> (JSON lines)
  --replay <file>     Make the tools/call requests of a recording again and
                      report which results changed (exit 1 if any did)
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
        legacy: { type: "boolean", default: false },
        record: { type: "string" },
        replay: { type: "string" },
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

  if (values.replay !== undefined && values.call !== undefined) {
    process.stderr.write("error: use either --call or --replay\n");
    return 1;
  }
  let replayText: string | undefined;
  if (values.replay !== undefined) {
    try {
      replayText = readFileSync(values.replay, "utf8");
    } catch (err) {
      process.stderr.write(`error: cannot read ${values.replay}: ${(err as Error).message}\n`);
      return 1;
    }
  }
  if (values.record !== undefined) {
    try {
      transport = new RecordingTransport(transport, values.record);
    } catch (err) {
      process.stderr.write(`error: cannot write ${values.record}: ${(err as Error).message}\n`);
      return 1;
    }
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
    const connect = { legacy: values.legacy };
    if (replayText !== undefined) {
      const calls = recordedCalls(replayText);
      if (calls.length === 0) throw new Error(`no tools/call exchanges in ${values.replay}`);
      await client.initialize(connect);
      const report: { tool: string; same: boolean; difference?: string }[] = [];
      for (const call of calls) {
        let now: { result?: unknown; error?: { code: number; message: string } };
        try {
          now = { result: await client.callTool(call.tool, call.args) };
        } catch (err) {
          now = { error: { code: (err as { code?: number }).code ?? 0, message: (err as Error).message } };
        }
        const before = call.error ? { error: call.error.code } : { result: call.result };
        const after = now.error ? { error: now.error.code } : { result: now.result };
        const difference = firstDifference(before, after);
        report.push({ tool: call.tool, same: difference === undefined, ...(difference ? { difference } : {}) });
      }
      if (values.json) {
        process.stdout.write(JSON.stringify({ calls: report }, null, 2) + "\n");
      } else {
        for (const r of report) {
          process.stdout.write(`${r.same ? "same   " : "CHANGED"}  ${r.tool}${r.difference ? `  (first difference: ${r.difference})` : ""}\n`);
        }
        const changed = report.filter((r) => !r.same).length;
        process.stdout.write(`\n${report.length} call(s) replayed, ${changed} changed\n`);
      }
      return report.some((r) => !r.same) ? 1 : 0;
    }
    if (values.call) {
      await client.initialize(connect);
      const result = await client.callTool(values.call, callArgs);
      process.stdout.write(values.json ? JSON.stringify(result, null, 2) + "\n" : renderToolResult(result, color));
      return toolResultIsError(result) ? 2 : 0;
    }

    const inspection = await inspect(client, connect);
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
