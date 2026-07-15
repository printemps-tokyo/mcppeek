import { describe, expect, it } from "vitest";
import { makeRequest, encodeLine, parseMessage, unwrap, RpcError } from "../src/jsonrpc.js";
import { parseSseEvents } from "../src/sse.js";
import { lintTool, lintPrompt, lintAll } from "../src/lint.js";
import { parseTimeout, toolResultIsError } from "../src/options.js";
import type { Tool } from "../src/mcp.js";

describe("jsonrpc", () => {
  it("builds and frames a request as one newline-terminated line", () => {
    const line = encodeLine(makeRequest(1, "tools/list"));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.includes("\n", 0)).toBe(true);
    expect(JSON.parse(line.trim())).toEqual({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  });

  it("classifies responses, requests, notifications, and invalid input", () => {
    expect(parseMessage('{"jsonrpc":"2.0","id":1,"result":{}}').kind).toBe("response");
    expect(parseMessage('{"jsonrpc":"2.0","id":2,"method":"ping"}').kind).toBe("request");
    expect(parseMessage('{"jsonrpc":"2.0","method":"notifications/x"}').kind).toBe("notification");
    expect(parseMessage("not json").kind).toBe("invalid");
    expect(parseMessage('{"jsonrpc":"2.0"}').kind).toBe("invalid");
  });

  it("unwraps a result and throws an RpcError", () => {
    expect(unwrap({ jsonrpc: "2.0", id: 1, result: { ok: true } })).toEqual({ ok: true });
    expect(() => unwrap({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "nope" } })).toThrow(RpcError);
  });
});

describe("parseSseEvents", () => {
  it("extracts data payloads, joining multi-line data and ignoring comments", () => {
    const body = ": keep-alive\r\nevent: message\r\ndata: {\"a\":1}\r\n\r\ndata: line1\r\ndata: line2\r\n\r\n";
    expect(parseSseEvents(body)).toEqual(['{"a":1}', "line1\nline2"]);
  });
});

describe("parseTimeout", () => {
  it("returns undefined when the flag is absent and the number otherwise", () => {
    expect(parseTimeout(undefined)).toBeUndefined();
    expect(parseTimeout("5000")).toBe(5000);
  });

  it("rejects values that are not a positive number of milliseconds", () => {
    for (const bad of ["20s", "abc", "", "  ", "NaN", "-1", "0", "Infinity"]) {
      expect(() => parseTimeout(bad)).toThrow(/--timeout must be a positive number/);
    }
  });
});

describe("toolResultIsError", () => {
  it("is true only for a result object with isError: true", () => {
    expect(toolResultIsError({ isError: true, content: [] })).toBe(true);
    expect(toolResultIsError({ isError: false, content: [] })).toBe(false);
    expect(toolResultIsError({ content: [{ type: "text", text: "ok" }] })).toBe(false);
    expect(toolResultIsError({ isError: "yes" })).toBe(false);
    expect(toolResultIsError(null)).toBe(false);
    expect(toolResultIsError(undefined)).toBe(false);
  });
});

const goodTool: Tool = {
  name: "search",
  description: "Search the knowledge base for a query string.",
  inputSchema: { type: "object", properties: { q: { type: "string", description: "the query" } }, required: ["q"] },
};

describe("lintTool", () => {
  it("passes a well-formed tool", () => {
    expect(lintTool(goodTool)).toEqual([]);
  });

  it("errors on a missing or non-object input schema", () => {
    expect(lintTool({ name: "x" }).some((i) => i.severity === "error" && /inputSchema/.test(i.message))).toBe(true);
    expect(
      lintTool({ name: "x", inputSchema: { type: "string" } }).some((i) => /should be "object"/.test(i.message)),
    ).toBe(true);
  });

  it("warns on a missing description and errors on a bad required reference", () => {
    expect(lintTool({ name: "x", inputSchema: { type: "object" } }).some((i) => /no description/.test(i.message))).toBe(
      true,
    );
    const badReq: Tool = { name: "x", description: "does a thing well", inputSchema: { type: "object", properties: {}, required: ["missing"] } };
    expect(lintTool(badReq).some((i) => i.severity === "error" && /required lists "missing"/.test(i.message))).toBe(
      true,
    );
  });

  it("flags unusual tool names", () => {
    expect(lintTool({ ...goodTool, name: "has space" }).some((i) => /unusual characters/.test(i.message))).toBe(true);
  });
});

describe("lintPrompt and lintAll", () => {
  it("notes prompt args without descriptions", () => {
    const issues = lintPrompt({ name: "greet", description: "Greet a user", arguments: [{ name: "who" }] });
    expect(issues.some((i) => /argument "who" has no description/.test(i.message))).toBe(true);
  });

  it("detects duplicate tool names", () => {
    const issues = lintAll([goodTool, { ...goodTool }], []);
    expect(issues.some((i) => /duplicate tool name/.test(i.message))).toBe(true);
  });
});
