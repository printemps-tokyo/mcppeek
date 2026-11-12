/** MCP data shapes (a subset of the 2025-06-18 and 2026-07-28 schemas). */

export interface Implementation {
  name: string;
  title?: string;
  version: string;
}

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
  completions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: Implementation;
  instructions?: string;
  /**
   * True when the server spoke the stateless 2026-07-28 protocol (found by
   * server/discover, no handshake, per-request _meta); false for the
   * initialize handshake.
   */
  stateless?: boolean;
  /** The versions server/discover listed, for a stateless server. */
  supportedVersions?: string[];
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, { description?: string; type?: string }>;
  required?: string[];
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
}

export interface Resource {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface Prompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: PromptArgument[];
}

/** MCP JSON-RPC method names. */
export const METHOD = {
  initialize: "initialize",
  initialized: "notifications/initialized",
  toolsList: "tools/list",
  toolsCall: "tools/call",
  resourcesList: "resources/list",
  resourceTemplatesList: "resources/templates/list",
  resourcesRead: "resources/read",
  promptsList: "prompts/list",
  promptsGet: "prompts/get",
  ping: "ping",
  discover: "server/discover",
} as const;

/** The protocol revision mcppeek offers in the legacy initialize handshake. */
export const PROTOCOL_VERSION = "2025-06-18";

/**
 * The stateless revision (2026-07-28): no initialize handshake or session;
 * every request carries the protocol version and client details in `_meta`,
 * and `server/discover` reports what the server supports.
 */
export const STATELESS_VERSION = "2026-07-28";

/** Reserved `_meta` keys of the stateless revision. */
export const META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientInfo: "io.modelcontextprotocol/clientInfo",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
} as const;

/** "Unsupported protocol version": a stateless server that lacks 2026-07-28. */
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;
