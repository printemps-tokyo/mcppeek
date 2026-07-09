/** A small MCP client: initialize, then list/call over any Transport. */
import { makeNotification, makeRequest, unwrap, type JsonRpcResponse } from "./jsonrpc.js";
import {
  METHOD,
  PROTOCOL_VERSION,
  type Implementation,
  type InitializeResult,
  type Prompt,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "./mcp.js";
import type { Transport } from "./transport.js";

const CLIENT_INFO: Implementation = { name: "mcppeek", version: "0.1.0" };

export class McpClient {
  private nextId = 1;
  private serverCaps: InitializeResult["capabilities"] = {};

  constructor(private readonly transport: Transport) {}

  /** Raw request/response, throwing on JSON-RPC error. */
  private async call(method: string, params?: unknown): Promise<unknown> {
    const response: JsonRpcResponse = await this.transport.sendRequest(makeRequest(this.nextId++, method, params));
    return unwrap(response);
  }

  /** Run the handshake and return the server's initialize result. */
  async initialize(): Promise<InitializeResult> {
    await this.transport.start();
    const result = (await this.call(METHOD.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })) as InitializeResult;
    this.serverCaps = result.capabilities ?? {};
    await this.transport.sendNotification(makeNotification(METHOD.initialized));
    return result;
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
