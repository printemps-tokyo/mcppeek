/**
 * Public API for mcppeek.
 *
 * mcppeek inspects a Model Context Protocol server: it runs the handshake,
 * lists the server's tools, resources, and prompts, lints their schemas, and
 * can call a tool. The JSON-RPC framing, SSE parsing, and schema linting are
 * pure and unit-tested; the transports (stdio subprocess, Streamable HTTP) hold
 * the IO.
 */

export {
  makeRequest,
  makeNotification,
  encodeLine,
  parseMessage,
  unwrap,
  RpcError,
  METHOD_NOT_FOUND,
} from "./jsonrpc.js";
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, ParsedMessage } from "./jsonrpc.js";

export { parseSseEvents } from "./sse.js";
export { lintTool, lintPrompt, lintAll } from "./lint.js";
export { issue, hasErrors } from "./issue.js";
export type { Issue, Severity } from "./issue.js";

export { METHOD, PROTOCOL_VERSION } from "./mcp.js";
export type {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  InitializeResult,
  ServerCapabilities,
  Implementation,
} from "./mcp.js";

export { McpClient } from "./client.js";
export { StdioTransport } from "./transport-stdio.js";
export { HttpTransport } from "./transport-http.js";
export type { Transport } from "./transport.js";

export { parseHeaderFlags, parseTimeout, toolResultIsError } from "./options.js";

export { inspect } from "./inspect.js";
export type { Inspection } from "./inspect.js";
export { renderText, renderJson, renderToolResult } from "./render.js";
