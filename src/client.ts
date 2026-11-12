/**
 * A small MCP client over any Transport. It speaks the stateless 2026-07-28
 * protocol when the server does (found with server/discover, as the spec
 * recommends for clients that support both eras), and otherwise the
 * initialize handshake of 2025-06-18.
 */
import { makeNotification, makeRequest, unwrap, type JsonRpcResponse } from "./jsonrpc.js";
import {
  META,
  METHOD,
  PROTOCOL_VERSION,
  STATELESS_VERSION,
  UNSUPPORTED_PROTOCOL_VERSION,
  type Implementation,
  type InitializeResult,
  type Prompt,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "./mcp.js";
import type { Transport } from "./transport.js";

const CLIENT_INFO: Implementation = { name: "mcppeek", version: "0.2.0" };

export interface ConnectOptions {
  /** Skip server/discover and use the initialize handshake straight away. */
  legacy?: boolean;
}

export class McpClient {
  private nextId = 1;
  private serverCaps: InitializeResult["capabilities"] = {};
  private stateless = false;

  constructor(private readonly transport: Transport) {}

  /** The params of a request, with the per-request `_meta` in stateless mode. */
  private withMeta(params?: unknown): unknown {
    if (!this.stateless) return params;
    const base = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const meta = (base._meta && typeof base._meta === "object" ? base._meta : {}) as Record<string, unknown>;
    return {
      ...base,
      _meta: {
        ...meta,
        [META.protocolVersion]: STATELESS_VERSION,
        [META.clientInfo]: CLIENT_INFO,
        [META.clientCapabilities]: {},
      },
    };
  }

  private send(method: string, params?: unknown): Promise<JsonRpcResponse> {
    return this.transport.sendRequest(makeRequest(this.nextId++, method, this.withMeta(params)));
  }

  /** Raw request/response, throwing on JSON-RPC error. */
  private async call(method: string, params?: unknown): Promise<unknown> {
    return unwrap(await this.send(method, params));
  }

  /**
   * Connect: try server/discover with the stateless revision; a result with
   * supportedVersions means a stateless server, and no handshake follows. A
   * server that does not know server/discover (an error, a malformed
   * answer, or no answer within the timeout) gets the initialize handshake.
   * A stateless server without 2026-07-28 is an error, naming what it has.
   */
  async initialize(opts: ConnectOptions = {}): Promise<InitializeResult> {
    await this.transport.start();
    if (!opts.legacy) {
      const found = await this.discover();
      if (found) return found;
    }
    return this.handshake();
  }

  private async discover(): Promise<InitializeResult | undefined> {
    this.stateless = true;
    let response: JsonRpcResponse;
    try {
      response = await this.send(METHOD.discover);
    } catch {
      this.stateless = false;
      return undefined;
    }
    if (response.error) {
      if (response.error.code === UNSUPPORTED_PROTOCOL_VERSION) {
        const data = response.error.data as { supported?: unknown } | undefined;
        const supported = Array.isArray(data?.supported) ? data.supported.join(", ") : "unknown";
        throw new Error(
          `the server speaks the stateless protocol but not ${STATELESS_VERSION} (it supports: ${supported})`,
        );
      }
      this.stateless = false;
      return undefined;
    }
    const result = (response.result ?? {}) as {
      supportedVersions?: unknown;
      capabilities?: InitializeResult["capabilities"];
      instructions?: string;
      _meta?: Record<string, unknown>;
    };
    if (!Array.isArray(result.supportedVersions) || result.supportedVersions.length === 0) {
      this.stateless = false;
      return undefined;
    }
    this.transport.useStateless?.(STATELESS_VERSION);
    this.serverCaps = result.capabilities ?? {};
    const info = result._meta?.[META.serverInfo] as Implementation | undefined;
    return {
      protocolVersion: STATELESS_VERSION,
      capabilities: this.serverCaps,
      serverInfo: info && typeof info.name === "string" ? info : { name: "(unnamed)", version: "?" },
      instructions: result.instructions,
      stateless: true,
      supportedVersions: result.supportedVersions.map(String),
    };
  }

  private async handshake(): Promise<InitializeResult> {
    const result = (await this.call(METHOD.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })) as InitializeResult;
    this.serverCaps = result.capabilities ?? {};
    await this.transport.sendNotification(makeNotification(METHOD.initialized));
    return { ...result, stateless: false };
  }

  capabilities(): InitializeResult["capabilities"] {
    return this.serverCaps;
  }

  /** Collect every page of a list method into one array. */
  private async listAll<T>(method: string, key: string): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined;
    do {
      const page = (await this.call(method, cursor ? { cursor } : undefined)) as Record<string, unknown>;
      const chunk = page[key];
      if (Array.isArray(chunk)) items.push(...(chunk as T[]));
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
    } while (cursor);
    return items;
  }

  listTools(): Promise<Tool[]> {
    return this.listAll<Tool>(METHOD.toolsList, "tools");
  }

  listResources(): Promise<Resource[]> {
    return this.listAll<Resource>(METHOD.resourcesList, "resources");
  }

  listResourceTemplates(): Promise<ResourceTemplate[]> {
    return this.listAll<ResourceTemplate>(METHOD.resourceTemplatesList, "resourceTemplates");
  }

  listPrompts(): Promise<Prompt[]> {
    return this.listAll<Prompt>(METHOD.promptsList, "prompts");
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.call(METHOD.toolsCall, { name, arguments: args });
  }

  readResource(uri: string): Promise<unknown> {
    return this.call(METHOD.resourcesRead, { uri });
  }

  getPrompt(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.call(METHOD.promptsGet, { name, arguments: args });
  }

  close(): Promise<void> {
    return this.transport.close();
  }
}
