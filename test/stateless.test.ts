import { describe, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpClient } from "../src/client.js";
import { inspect } from "../src/inspect.js";
import { HttpTransport } from "../src/transport-http.js";
import { RecordingTransport, canonical, firstDifference, recordedCalls } from "../src/record.js";
import type { JsonRpcRequest, JsonRpcResponse } from "../src/jsonrpc.js";
import type { Transport } from "../src/transport.js";

const PV = "io.modelcontextprotocol/protocolVersion";

/** A 2026-07-28 server: server/discover, per-request _meta, no initialize. */
class StatelessServer implements Transport {
  seen: JsonRpcRequest[] = [];
  notifications = 0;
  constructor(
    private readonly greeting = "hello",
    private readonly versions = ["2026-07-28"],
  ) {}
  start(): Promise<void> {
    return Promise.resolve();
  }
  sendNotification(): Promise<void> {
    this.notifications++;
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  sendRequest(m: JsonRpcRequest): Promise<JsonRpcResponse> {
    this.seen.push(m);
    const meta = ((m.params ?? {}) as { _meta?: Record<string, unknown> })._meta ?? {};
    const reply = (body: Partial<JsonRpcResponse>): Promise<JsonRpcResponse> =>
      Promise.resolve({ jsonrpc: "2.0", id: m.id, ...body } as JsonRpcResponse);
    if (!this.versions.includes(meta[PV] as string)) {
      return reply({ error: { code: -32022, message: "unsupported", data: { supported: this.versions } } });
    }
    switch (m.method) {
      case "server/discover":
        return reply({
          result: {
            supportedVersions: this.versions,
            capabilities: { tools: {} },
            ttlMs: 0,
            cacheScope: "public",
            _meta: { "io.modelcontextprotocol/serverInfo": { name: "modern", version: "2.0" } },
          },
        });
      case "tools/list":
        return reply({
          result: {
            tools: [{ name: "greet", description: "Say hello", inputSchema: { type: "object", properties: {} } }],
            ttlMs: 0,
            cacheScope: "public",
          },
        });
      case "tools/call":
        return reply({ result: { content: [{ type: "text", text: this.greeting }] } });
      default:
        return reply({ error: { code: -32601, message: "method not found" } });
    }
  }
}

describe("stateless 2026-07-28 servers", () => {
  it("are found by server/discover, with _meta on every request and no handshake", async () => {
    const server = new StatelessServer();
    const ins = await inspect(new McpClient(server));
    expect(ins.stateless).toBe(true);
    expect(ins.protocolVersion).toBe("2026-07-28");
    expect(ins.server).toEqual({ name: "modern", version: "2.0" });
    expect(ins.tools.map((t) => t.name)).toEqual(["greet"]);
    expect(server.seen.map((m) => m.method)).toEqual(["server/discover", "tools/list"]);
    expect(server.seen.every((m) => (m.params as { _meta: Record<string, unknown> })._meta[PV] === "2026-07-28")).toBe(true);
    expect(server.notifications).toBe(0);
  });

  it("name the versions they support when 2026-07-28 is not one", async () => {
    const client = new McpClient(new StatelessServer("x", ["2027-01-01"]));
    await expect(client.initialize()).rejects.toThrow(/not 2026-07-28 \(it supports: 2027-01-01\)/);
  });

  it("are skipped with --legacy", async () => {
    const server = new StatelessServer();
    await expect(new McpClient(server).initialize({ legacy: true })).rejects.toThrow();
    expect(server.seen[0]?.method).toBe("initialize");
  });
});

describe("stateless HTTP", () => {
  it("sends MCP-Protocol-Version and Mcp-Method, and no session id", async () => {
    const heard: { method: string; headers: IncomingHttpHeaders }[] = [];
    const inner = new StatelessServer();
    const http = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        const m = JSON.parse(body) as JsonRpcRequest;
        heard.push({ method: m.method, headers: req.headers });
        void inner.sendRequest(m).then((r) => {
          res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "should-be-ignored" });
          res.end(JSON.stringify(r));
        });
      });
    });
    await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
    try {
      const port = (http.address() as { port: number }).port;
      const client = new McpClient(new HttpTransport({ url: `http://127.0.0.1:${port}/mcp` }));
      await client.initialize();
      await client.listTools();
      await client.listTools();
      const last = heard.at(-1)!;
      expect(last.headers["mcp-protocol-version"]).toBe("2026-07-28");
      expect(last.headers["mcp-method"]).toBe("tools/list");
      expect(last.headers["mcp-session-id"]).toBeUndefined();
    } finally {
      await new Promise((done) => http.close(done));
    }
  });
});

describe("record and replay", () => {
  it("records messages and finds a changed tool result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcppeek-rec-"));
    try {
      const file = join(dir, "session.jsonl");
      const client = new McpClient(new RecordingTransport(new StatelessServer("hello"), file));
      await client.initialize();
      await client.callTool("greet", { who: "ann" });
      const text = readFileSync(file, "utf8");
      const calls = recordedCalls(text);
      expect(calls).toEqual([{ tool: "greet", args: { who: "ann" }, result: { content: [{ type: "text", text: "hello" }] } }]);

      // The same server answers the same; a changed one differs at the text.
      const again = new McpClient(new StatelessServer("hello"));
      await again.initialize();
      expect(firstDifference({ result: calls[0]!.result }, { result: await again.callTool("greet", {}) })).toBeUndefined();
      const changed = new McpClient(new StatelessServer("bonjour"));
      await changed.initialize();
      expect(firstDifference({ result: calls[0]!.result }, { result: await changed.callTool("greet", {}) })).toBe(
        "result.content[0].text",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compares results without key order or _meta", () => {
    expect(canonical({ b: 1, a: { _meta: { t: 1 }, c: [2, { y: 1, x: 2 }] } })).toBe('{"a":{"c":[2,{"x":2,"y":1}]},"b":1}');
    expect(firstDifference([1, 2], [1, 2, 3])).toBe("(root) (length 2 -> 3)");
  });
});
