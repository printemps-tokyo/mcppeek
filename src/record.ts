/**
 * Recording an MCP session and replaying its tool calls.
 *
 * --record writes every JSON-RPC message mcppeek sends or receives as one
 * JSON line ({ at, dir, message }). --replay reads such a file, makes each
 * recorded tools/call again on the server at hand, and compares the new
 * result with the recorded one, so a server change that alters a tool's
 * output shows up. A recording holds whatever the tools returned: keep it
 * as private as that data.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from "./jsonrpc.js";
import type { Transport } from "./transport.js";

export interface RecordLine {
  at: string;
  dir: "send" | "receive";
  message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;
}

/** A transport that writes every message to `file` (JSON lines), then passes it on. */
export class RecordingTransport implements Transport {
  constructor(
    private readonly inner: Transport,
    private readonly file: string,
  ) {
    writeFileSync(file, "", { mode: 0o600 });
  }

  private log(dir: RecordLine["dir"], message: RecordLine["message"]): void {
    const line: RecordLine = { at: new Date().toISOString(), dir, message };
    appendFileSync(this.file, JSON.stringify(line) + "\n");
  }

  start(): Promise<void> {
    return this.inner.start();
  }

  async sendRequest(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    this.log("send", message);
    const response = await this.inner.sendRequest(message);
    this.log("receive", response);
    return response;
  }

  async sendNotification(message: JsonRpcNotification): Promise<void> {
    this.log("send", message);
    await this.inner.sendNotification(message);
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  useStateless(version: string): void {
    this.inner.useStateless?.(version);
  }
}

/** One recorded tools/call: what was asked and what came back. */
export interface RecordedCall {
  tool: string;
  args: Record<string, unknown>;
  /** The recorded result, or undefined when the call failed. */
  result?: unknown;
  error?: { code: number; message: string };
}

/** The tools/call exchanges in a recording, in order. */
export function recordedCalls(text: string): RecordedCall[] {
  const requests = new Map<string | number, { tool: string; args: Record<string, unknown> }>();
  const calls: RecordedCall[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let rec: RecordLine;
    try {
      rec = JSON.parse(line) as RecordLine;
    } catch {
      throw new Error(`recording line ${i + 1} is not JSON`);
    }
    const m = rec.message as Partial<JsonRpcRequest & JsonRpcResponse>;
    if (rec.dir === "send" && m.method === "tools/call" && m.id !== undefined) {
      const p = (m.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof p.name !== "string") continue;
      const args = p.arguments && typeof p.arguments === "object" ? (p.arguments as Record<string, unknown>) : {};
      requests.set(m.id, { tool: p.name, args });
    } else if (rec.dir === "receive" && m.id !== undefined && requests.has(m.id)) {
      const req = requests.get(m.id)!;
      requests.delete(m.id);
      calls.push({ ...req, ...(m.error ? { error: m.error } : { result: m.result }) });
    }
  }
  return calls;
}

/** JSON with object keys sorted and `_meta` left out, for comparing results. */
export function canonical(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as object)
          .filter((k) => k !== "_meta")
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

/** The first place where two values differ, as a path like `content[0].text`; undefined when equal. */
export function firstDifference(a: unknown, b: unknown, path = ""): string | undefined {
  if (canonical(a) === canonical(b)) return undefined;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path || "(root)"} (length ${a.length} -> ${b.length})`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== "_meta").sort();
    for (const k of keys) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      if (d) return d;
    }
  }
  return path || "(root)";
}
