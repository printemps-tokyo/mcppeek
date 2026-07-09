/** Pure JSON-RPC 2.0 helpers for the MCP client (RFC-style request/response). */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export function makeRequest(id: number, method: string, params?: unknown): JsonRpcRequest {
  return params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params };
}

export function makeNotification(method: string, params?: unknown): JsonRpcNotification {
  return params === undefined
    ? { jsonrpc: "2.0", method }
    : { jsonrpc: "2.0", method, params };
}

/** Serialize a message as a single newline-delimited JSON line (stdio framing). */
export function encodeLine(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): string {
  return `${JSON.stringify(message)}\n`;
}

/** A parsed message classified by shape. */
export type ParsedMessage =
  | { kind: "response"; message: JsonRpcResponse }
  | { kind: "request"; message: JsonRpcRequest }
  | { kind: "notification"; message: JsonRpcNotification }
  | { kind: "invalid"; error: string };

/** Parse and classify one JSON-RPC message. */
export function parseMessage(line: string): ParsedMessage {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (err) {
    return { kind: "invalid", error: (err as Error).message };
  }
  if (typeof value !== "object" || value === null) {
    return { kind: "invalid", error: "message is not an object" };
  }
  const obj = value as Record<string, unknown>;
  const hasId = "id" in obj && obj.id !== null && obj.id !== undefined;
  if ("method" in obj && typeof obj.method === "string") {
    return hasId
      ? { kind: "request", message: obj as unknown as JsonRpcRequest }
      : { kind: "notification", message: obj as unknown as JsonRpcNotification };
  }
  if ("result" in obj || "error" in obj) {
    return { kind: "response", message: obj as unknown as JsonRpcResponse };
  }
  return { kind: "invalid", error: "not a JSON-RPC request, response, or notification" };
}

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/** Return the result of a response, or throw its error. */
export function unwrap(response: JsonRpcResponse): unknown {
  if (response.error) {
    throw new RpcError(response.error.code, response.error.message, response.error.data);
  }
  return response.result;
}

/** The JSON-RPC "method not found" code (used to detect unsupported features). */
export const METHOD_NOT_FOUND = -32601;
