/** MCP data shapes (a subset of [MS-agnostic] the 2025-06-18 schema). */

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
} as const;

/** The protocol revision this client speaks. */
export const PROTOCOL_VERSION = "2025-06-18";
