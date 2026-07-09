import { describe, expect, it } from "vitest";
import { McpClient } from "../src/client.js";
import { inspect } from "../src/inspect.js";
import { renderText, renderToolResult } from "../src/render.js";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from "../src/jsonrpc.js";
import type { Transport } from "../src/transport.js";

/** An in-memory MCP server that answers requests, including paginated tools. */
class MockTransport implements Transport {
  notifications: string[] = [];
  start(): Promise<void> {
    return Promise.resolve();
  }
  sendNotification(m: JsonRpcNotification): Promise<void> {
    this.notifications.push(m.method);
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  sendRequest(m: JsonRpcRequest): Promise<JsonRpcResponse> {
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id: m.id, result });
    const params = (m.params ?? {}) as { cursor?: string; name?: string };
    switch (m.method) {
      case "initialize":
        return Promise.resolve(
          ok({
            protocolVersion: "2025-06-18",
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: "mock", version: "1.0" },
          }),
        );
      case "tools/list":
        return Promise.resolve(
          params.cursor === "c2"
            ? ok({ tools: [{ name: "raw" }] }) // page 2: a tool with no schema (lint error)
            : ok({
                tools: [
                  {
                    name: "search",
                    description: "Search the KB for a query.",
                    inputSchema: { type: "object", properties: { q: { type: "string", description: "query" } }, required: ["q"] },
                  },
                ],
                nextCursor: "c2",
              }),
        );
      case "resources/list":
        return Promise.resolve(ok({ resources: [{ uri: "file:///a.txt", name: "a", mimeType: "text/plain" }] }));
      case "resources/templates/list":
        return Promise.resolve(ok({ resourceTemplates: [] }));
      case "prompts/list":
        return Promise.resolve(ok({ prompts: [{ name: "greet", arguments: [{ name: "who", required: true }] }] }));
      case "tools/call":
        return Promise.resolve(ok({ content: [{ type: "text", text: `called ${params.name}` }] }));
      default:
        return Promise.resolve({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found" } });
    }
  }
}

describe("McpClient + inspect", () => {
  it("initializes, sends the initialized notification, and paginates tools", async () => {
    const transport = new MockTransport();
    const client = new McpClient(transport);
    const ins = await inspect(client);

    expect(transport.notifications).toContain("notifications/initialized");
    expect(ins.server.name).toBe("mock");
    expect(ins.tools.map((t) => t.name)).toEqual(["search", "raw"]); // both pages
    expect(ins.resources).toHaveLength(1);
    expect(ins.prompts).toHaveLength(1);
  });

  it("lints the gathered definitions (raw tool has no schema)", async () => {
    const ins = await inspect(new McpClient(new MockTransport()));
    expect(ins.issues.some((i) => i.subject === 'tool "raw"' && i.severity === "error")).toBe(true);
    expect(ins.issues.some((i) => /argument "who" has no description/.test(i.message))).toBe(true);
  });

  it("renders text with the tool signature", async () => {
    const ins = await inspect(new McpClient(new MockTransport()));
    const out = renderText(ins, false);
    expect(out).toContain("Server: mock 1.0");
    expect(out).toContain("search(q)");
    expect(out).toContain("greet(who)");
  });

  it("calls a tool and renders its text content", async () => {
    const client = new McpClient(new MockTransport());
    await client.initialize();
    const result = await client.callTool("search", { q: "hi" });
    expect(renderToolResult(result, false)).toContain("called search");
  });
});
