/**
 * The stdio MCP transport: launch the server as a subprocess and exchange
 * newline-delimited JSON-RPC messages over its stdin/stdout (MCP 2025-06-18).
 * Messages must not contain embedded newlines, so line splitting is safe.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  encodeLine,
  makeNotification,
  parseMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./jsonrpc.js";
import type { Transport } from "./transport.js";

export interface StdioOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

export class StdioTransport implements Transport {
  private child: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = "";
  private stderrTail: string[] = [];
  private readonly pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private readonly timeoutMs: number;
  private exitError: Error | undefined;

  constructor(private readonly options: StdioOptions) {
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  async start(): Promise<void> {
    const child = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.options.env },
      cwd: this.options.cwd,
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    child.on("error", (err) => this.fail(new Error(`failed to launch "${this.options.command}": ${err.message}`)));
    child.on("exit", (code, signal) => {
      if (this.pending.size > 0) {
        this.fail(new Error(`server exited (${signal ?? `code ${code}`}) before responding${this.stderrHint()}`));
      }
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.captureStderr(chunk));
  }

  private captureStderr(chunk: string): void {
    for (const line of chunk.split("\n")) {
      if (line.trim() !== "") this.stderrTail.push(line);
    }
    if (this.stderrTail.length > 20) this.stderrTail = this.stderrTail.slice(-20);
  }

  private stderrHint(): string {
    return this.stderrTail.length > 0 ? `\n  stderr: ${this.stderrTail.slice(-3).join(" | ")}` : "";
  }

  private fail(err: Error): void {
    this.exitError = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let nl: number;
    while ((nl = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, nl).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (line === "") continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    const parsed = parseMessage(line);
    if (parsed.kind === "response") {
      const id = parsed.message.id;
      if (typeof id === "number" && this.pending.has(id)) {
        this.pending.get(id)!.resolve(parsed.message);
        this.pending.delete(id);
      }
    } else if (parsed.kind === "request") {
      // Politely answer a server ping; decline anything else we did not opt into.
      const { id, method } = parsed.message;
      const reply =
        method === "ping"
          ? { jsonrpc: "2.0" as const, id, result: {} }
          : { jsonrpc: "2.0" as const, id, error: { code: -32601, message: "method not found" } };
      this.write(reply);
    }
    // Notifications and invalid lines are ignored.
  }

  private write(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    this.child?.stdin.write(encodeLine(message));
  }

  sendRequest(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (this.exitError) return Promise.reject(this.exitError);
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new Error(`timed out after ${this.timeoutMs}ms waiting for "${message.method}"${this.stderrHint()}`));
      }, this.timeoutMs);
      this.pending.set(message.id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.write(message);
    });
  }

  sendNotification(message: JsonRpcNotification): Promise<void> {
    this.write(message);
    return Promise.resolve();
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    // Give the server a moment to exit on its own, then terminate.
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill("SIGTERM");
        resolve();
      }, 500);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

/** The notification a client sends once initialization succeeds. */
export function initializedNotification(): JsonRpcNotification {
  return makeNotification("notifications/initialized");
}
