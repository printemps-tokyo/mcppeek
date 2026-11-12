/** Render an Inspection as text or JSON. Pure. */
import type { Issue } from "./issue.js";
import type { Inspection } from "./inspect.js";
import type { Tool } from "./mcp.js";

function paint(text: string, code: string, color: boolean): string {
  return color ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function severityTag(s: Issue["severity"], color: boolean): string {
  if (s === "error") return paint("error", "31", color);
  if (s === "warning") return paint("warn ", "33", color);
  return paint("info ", "36", color);
}

/** Summarize a tool's required parameters as `name, name?`. */
function paramSummary(tool: Tool): string {
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const names = Object.keys(props);
  if (names.length === 0) return "()";
  return `(${names.map((n) => (required.has(n) ? n : `${n}?`)).join(", ")})`;
}

/** Render the inspection as human-readable text. */
export function renderText(ins: Inspection, color: boolean): string {
  const lines: string[] = [];
  const head = (t: string): void => {
    lines.push(paint(t, "1", color));
  };

  const title = ins.server.title ? ` (${ins.server.title})` : "";
  lines.push(`${paint("Server:", "36", color)} ${ins.server.name} ${ins.server.version}${title}`);
  lines.push(`${paint("Protocol:", "36", color)} ${ins.protocolVersion}${ins.stateless ? " (stateless, server/discover)" : " (initialize handshake)"}`);
  const caps = Object.keys(ins.capabilities).filter((k) => ins.capabilities[k]);
  lines.push(`${paint("Capabilities:", "36", color)} ${caps.length ? caps.join(", ") : "(none)"}`);
  if (ins.instructions) lines.push(`${paint("Instructions:", "36", color)} ${ins.instructions.replace(/\s+/g, " ").trim()}`);
  lines.push("");

  head(`Tools (${ins.tools.length})`);
  for (const t of ins.tools) {
    lines.push(`  ${paint(t.name, "32", color)}${paramSummary(t)}`);
    if (t.description) lines.push(`      ${clip(t.description, 100)}`);
  }
  if (ins.tools.length === 0) lines.push("  (none)");

  lines.push("");
  head(`Resources (${ins.resources.length}${ins.resourceTemplates.length ? ` + ${ins.resourceTemplates.length} templates` : ""})`);
  for (const r of ins.resources) {
    lines.push(`  ${paint(r.uri, "32", color)}${r.name ? `  ${r.name}` : ""}${r.mimeType ? `  [${r.mimeType}]` : ""}`);
  }
  for (const r of ins.resourceTemplates) {
    lines.push(`  ${paint(r.uriTemplate, "32", color)}${r.name ? `  ${r.name}` : ""}  (template)`);
  }
  if (ins.resources.length === 0 && ins.resourceTemplates.length === 0) lines.push("  (none)");

  lines.push("");
  head(`Prompts (${ins.prompts.length})`);
  for (const p of ins.prompts) {
    const args = (p.arguments ?? []).map((a) => (a.required ? a.name : `${a.name}?`)).join(", ");
    lines.push(`  ${paint(p.name, "32", color)}(${args})`);
    if (p.description) lines.push(`      ${clip(p.description, 100)}`);
  }
  if (ins.prompts.length === 0) lines.push("  (none)");

  if (ins.issues.length > 0) {
    lines.push("");
    head(`Lint (${ins.issues.length})`);
    const order = { error: 0, warning: 1, info: 2 } as const;
    for (const i of [...ins.issues].sort((a, b) => order[a.severity] - order[b.severity])) {
      lines.push(`  ${severityTag(i.severity, color)} ${i.subject}: ${i.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function clip(s: string, width: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > width ? `${one.slice(0, width - 1)}…` : one;
}

/** Render the inspection as JSON. */
export function renderJson(ins: Inspection): string {
  return `${JSON.stringify(ins, null, 2)}\n`;
}

/** Render a tool-call result as readable text (MCP content blocks). */
export function renderToolResult(result: unknown, color: boolean): string {
  const r = result as { content?: unknown[]; isError?: boolean; structuredContent?: unknown };
  const lines: string[] = [];
  if (r.isError) lines.push(paint("[tool reported an error]", "31", color));
  for (const block of r.content ?? []) {
    const b = block as { type?: string; text?: string; uri?: string; mimeType?: string };
    if (b.type === "text") lines.push(b.text ?? "");
    else if (b.type === "resource") lines.push(`[resource ${b.uri ?? ""}]`);
    else lines.push(`[${b.type ?? "unknown"} content]`);
  }
  if (r.structuredContent !== undefined) {
    lines.push(paint("structuredContent:", "90", color));
    lines.push(JSON.stringify(r.structuredContent, null, 2));
  }
  if (lines.length === 0) return `${JSON.stringify(result, null, 2)}\n`;
  return `${lines.join("\n")}\n`;
}
