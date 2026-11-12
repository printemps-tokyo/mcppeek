# mcppeek

> Inspect a Model Context Protocol (MCP) server: list its tools, resources, and prompts, lint their schemas, and call a tool. Zero-dependency CLI.

[![CI](https://github.com/printemps-tokyo/mcppeek/actions/workflows/ci.yml/badge.svg)](https://github.com/printemps-tokyo/mcppeek/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

MCP servers are everywhere now, but seeing what one actually exposes usually
means wiring it into a client. `mcppeek` runs the handshake for you and prints
the server's tools, resources, and prompts in one view — then lints the
definitions for the things that make a server hard for an LLM to use (a tool
with no description, a malformed input schema, a `required` field that points at
nothing).

```console
$ mcppeek -- npx -y @modelcontextprotocol/server-everything
Server: everything 2.0.0 (Everything Reference Server)
Protocol: 2025-06-18 (initialize handshake)
Capabilities: tools, prompts, resources, logging, completions

Tools (13)
  echo(message)
      Echoes back the input string
  get-sum(a, b)
      Returns the sum of two numbers
  ...

Prompts (4)
  args-prompt(city, state?)
      A prompt with two arguments, one required and one optional

Lint (2)
  info  tool "get-resource-reference": property "resourceType" has no description
  info  prompt "args-prompt": argument "state" has no description
```

It speaks both eras of MCP — the stateless `2026-07-28` revision and the
`2025-06-18` initialize handshake — over both transports, stdio (it launches
the server as a subprocess) and Streamable HTTP, using only Node's built-ins.

## Requirements

- Node.js >= 22

## Install

Not published to npm yet — install from source:

```bash
git clone https://github.com/printemps-tokyo/mcppeek
cd mcppeek
npm install && npm run build
npm link   # optional: puts the `mcppeek` command on your PATH
```

## Usage

Everything after `--` is the command mcppeek launches over stdio:

```bash
mcppeek -- npx -y @modelcontextprotocol/server-everything   # inspect a stdio server
mcppeek --url https://example.com/mcp                       # inspect an HTTP server
mcppeek --url https://example.com/mcp --header "Authorization: Bearer TOKEN"
mcppeek --lint-only -- node my-server.js                    # just the schema findings
mcppeek --call get-sum --args '{"a":2,"b":3}' -- node my-server.js
mcppeek --json -- node my-server.js                         # machine-readable
mcppeek --record s.jsonl --call search --args '{"q":"x"}' -- node my-server.js
mcppeek --replay s.jsonl -- node my-server.js               # same results as before?
```

| Option | Description |
| --- | --- |
| `-- <command> [args...]` | Launch this command as a stdio MCP server and inspect it |
| `--url <endpoint>` | Inspect a Streamable HTTP MCP endpoint instead |
| `--header "Name: value"` | Extra HTTP header for `--url`, e.g. `Authorization` (repeatable) |
| `--call <tool>` | Call this tool and print the result, instead of listing |
| `--args <json>` | JSON object of arguments for `--call` (default: `{}`) |
| `--lint-only` | Print only the lint findings |
| `--timeout <ms>` | Per-request timeout (default: 20000) |
| `--legacy` | Skip `server/discover`; use the initialize handshake straight away |
| `--record <file>` | Write every JSON-RPC message sent and received to `file` (JSON lines) |
| `--replay <file>` | Make the `tools/call` requests of a recording again and report changed results |
| `--json` | Output JSON instead of text |
| `--no-color` | Disable ANSI colors |

The exit code is `1` when linting finds an error (for example a tool with no
input schema), so `mcppeek --lint-only` fits a CI check on your own server.
With `--call`, the exit code is `2` when the tool result reports `isError`.

### Stateless servers (2026-07-28)

The 2026-07-28 revision removed the `initialize` handshake and the protocol
session: every request carries the protocol version and client details in
`_meta`, and a server reports itself through `server/discover`. mcppeek first
sends `server/discover` with `2026-07-28`, as the specification recommends for
clients that support both eras. A result listing `supportedVersions` means a
stateless server: no handshake follows, every request carries the `_meta`, and
over HTTP every request also carries `MCP-Protocol-Version` and `Mcp-Method`
(and no `Mcp-Session-Id`). A server that answers with "unsupported protocol
version" (`-32022`) is reported with the versions it supports. Any other error,
or no answer within `--timeout`, means an older server, which gets the
initialize handshake; the inspection then notes that it does not answer
`server/discover`. A stdio server that stays silent on methods it does not know
costs one `--timeout` before that; `--legacy` skips the probe.

### Recording and replaying tool calls

`--record s.jsonl` writes every JSON-RPC message of the run, one JSON object per
line (`{ at, dir: "send" | "receive", message }`), to a file readable only by
you. `--replay s.jsonl` reads a recording, makes each recorded `tools/call`
again with the same arguments on the server you point it at, and compares the
new result with the recorded one (object keys in any order, `_meta` ignored):
`same`, or `CHANGED` with the first place that differs, such as
`result.content[0].text`. The exit code is `1` when any result changed, so a
recording made against a known-good build becomes a regression check. A
recording holds whatever the tools returned (and any arguments you gave them);
keep it as private as that data. HTTP headers, such as `Authorization`, are
not recorded.

## What it does

- Runs the MCP initialize handshake and reports the server name/version, the
  negotiated protocol version, and the advertised capabilities.
- Lists every tool with a compact signature (`name(required, optional?)`) and
  description, every resource and resource template, and every prompt with its
  arguments — following pagination cursors so nothing is truncated.
- Lints tools and prompts: missing or too-short descriptions, an `inputSchema`
  that is not a JSON Schema object, `required` entries with no matching property,
  properties without a type or description, unusual names, and duplicate tool
  names.
- With `--call`, invokes a single tool and renders its content blocks (text,
  resources, structured content).

## Transports

- **stdio** — mcppeek launches your command, exchanges newline-delimited
  JSON-RPC over its stdin/stdout, and shuts the subprocess down cleanly. This is
  the default and the most common way to run a local MCP server.
- **Streamable HTTP** (`--url`) — mcppeek POSTs JSON-RPC to the endpoint and
  reads either a JSON or an SSE response, carrying the `Mcp-Session-Id` across
  requests of an initialize-era server (the stateless revision has none). Auth-gated endpoints work with repeated `--header` flags, which are
  sent on every request.

## Programmatic API

```ts
import { McpClient, StdioTransport, inspect } from "@printemps-tokyo/mcppeek";

const client = new McpClient(new StdioTransport({ command: "node", args: ["server.js"] }));
const info = await inspect(client);
console.log(info.tools.map((t) => t.name), info.issues);
await client.close();
```

The JSON-RPC framing, SSE parsing, and schema linting are pure functions;
`StdioTransport` and `HttpTransport` hold the IO.

## License

[MIT](./LICENSE) (c) printemps.tokyo
