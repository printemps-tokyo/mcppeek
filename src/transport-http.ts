/**
 * The Streamable HTTP MCP transport (2025-06-18): each client message is an
 * HTTP POST to the MCP endpoint. The server answers a request with either one
 * `application/json` object or a `text/event-stream` (SSE) that carries the
 * response. A session id from the initialize response is echoed on later posts.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { parseMessage, type JsonRpcNotification, type JsonRpcRequest, type JsonRpcResponse } from "./jsonrpc.js";
import { parseSseEvents } from "./sse.js";
import { PROTOCOL_VERSION } from "./mcp.js";
import type { Transport } from "./transport.js";

export interface HttpOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  contentType: string;
  body: string;
  sessionId?: string;
}

export class HttpTransport implements Transport {
  private sessionId: string | undefined;
  private negotiatedVersion: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpOptions) {
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  private post(payload: string): Promise<RawResponse> {
    const url = new URL(this.options.url);
    const isHttps = url.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "content-length": String(Buffer.byteLength(payload)),
      ...this.options.headers,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.negotiatedVersion) headers["mcp-protocol-version"] = this.negotiatedVersion;

    return new Promise<RawResponse>((resolve, reject) => {
      const req = requestFn(
        url,
        { method: "POST", headers, timeout: this.timeoutMs },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              contentType: String(res.headers["content-type"] ?? ""),
              body: Buffer.concat(chunks).toString("utf8"),
              sessionId: res.headers["mcp-session-id"] as string | undefined,
            }),
          );
        },
      );
      req.on("error", (err) => reject(new Error(`HTTP request failed: ${err.message}`)));
      req.on("timeout", () => req.destroy(new Error(`timed out after ${this.timeoutMs}ms`)));
      req.write(payload);
      req.end();
    });
  }

  async sendRequest(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    const res = await this.post(JSON.stringify(message));
    if (res.sessionId) this.sessionId = res.sessionId;
    if (res.status >= 400) {
      throw new Error(`server returned HTTP ${res.status}${res.body ? `: ${res.body.slice(0, 200)}` : ""}`);
    }

    const payloads = res.contentType.includes("text/event-stream")
      ? parseSseEvents(res.body)
      : res.body.trim() === ""
        ? []
        : [res.body];

    for (const payload of payloads) {
      const parsed = parseMessage(payload);
      if (parsed.kind === "response" && parsed.message.id === message.id) {
        if (message.method === "initialize" && parsed.message.result) {
          const version = (parsed.message.result as { protocolVersion?: string }).protocolVersion;
          if (version) this.negotiatedVersion = version;
        }
        return parsed.message;
      }
    }
    throw new Error(`no JSON-RPC response for "${message.method}" in the HTTP reply`);
  }

  async sendNotification(message: JsonRpcNotification): Promise<void> {
    const res = await this.post(JSON.stringify(message));
    if (res.sessionId) this.sessionId = res.sessionId;
    if (res.status >= 400) {
      throw new Error(`server returned HTTP ${res.status} for ${message.method}`);
    }
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    // Best-effort DELETE to end the session; ignore failures.
    try {
      const url = new URL(this.options.url);
      const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
      await new Promise<void>((resolve) => {
        const req = requestFn(
          url,
          {
            method: "DELETE",
            headers: {
              ...this.options.headers,
              "mcp-session-id": this.sessionId!,
              "mcp-protocol-version": this.negotiatedVersion ?? PROTOCOL_VERSION,
            },
            timeout: 2000,
          },
          (res) => {
            res.on("data", () => {});
            res.on("end", () => resolve());
          },
        );
        req.on("error", () => resolve());
        req.on("timeout", () => {
          req.destroy();
          resolve();
        });
        req.end();
      });
    } catch {
      /* ignore */
    }
  }
}
