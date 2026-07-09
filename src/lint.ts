/**
 * Lint an MCP server's tool and prompt definitions. Pure. These are the quality
 * checks that decide whether an LLM can actually use the server well: a tool
 * with no description or a malformed input schema is invisible or unusable to
 * the model, even though the server "works".
 */
import { issue, type Issue } from "./issue.js";
import type { Prompt, Tool } from "./mcp.js";

const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Lint one tool definition. */
export function lintTool(tool: Tool): Issue[] {
  const issues: Issue[] = [];
  const subject = `tool "${tool.name}"`;

  if (!tool.name || tool.name.trim() === "") {
    issues.push(issue("error", subject, "tool has no name"));
  } else if (!NAME_PATTERN.test(tool.name)) {
    issues.push(issue("warning", subject, `name "${tool.name}" has unusual characters (use letters, digits, _-.).`));
  }

  if (!tool.description || tool.description.trim() === "") {
    issues.push(issue("warning", subject, "no description: the model has little to go on when choosing this tool"));
  } else if (tool.description.trim().length < 12) {
    issues.push(issue("info", subject, "very short description; a sentence helps the model pick the tool"));
  }

  const schema = tool.inputSchema;
  if (schema === undefined) {
    issues.push(issue("error", subject, "no inputSchema (MCP requires a JSON Schema object)"));
    return issues;
  }
  if (schema.type !== "object") {
    issues.push(issue("error", subject, `inputSchema.type should be "object" (got ${JSON.stringify(schema.type)})`));
  }
  const props = schema.properties ?? {};
  const propNames = Object.keys(props);
  for (const req of schema.required ?? []) {
    if (!propNames.includes(req)) {
      issues.push(issue("error", subject, `required lists "${req}", which is not in properties`));
    }
  }
  for (const [name, prop] of Object.entries(props)) {
    if (!prop || typeof prop !== "object") continue;
    if (prop.type === undefined) {
      issues.push(issue("info", subject, `property "${name}" has no type`));
    }
    if (!prop.description || prop.description.trim() === "") {
      issues.push(issue("info", subject, `property "${name}" has no description`));
    }
  }
  return issues;
}

/** Lint one prompt definition. */
export function lintPrompt(prompt: Prompt): Issue[] {
  const issues: Issue[] = [];
  const subject = `prompt "${prompt.name}"`;
  if (!prompt.name || !NAME_PATTERN.test(prompt.name)) {
    issues.push(issue("warning", subject, "prompt name is missing or has unusual characters"));
  }
  if (!prompt.description || prompt.description.trim() === "") {
    issues.push(issue("info", subject, "no description"));
  }
  for (const arg of prompt.arguments ?? []) {
    if (!arg.description || arg.description.trim() === "") {
      issues.push(issue("info", subject, `argument "${arg.name}" has no description`));
    }
  }
  return issues;
}

/** Lint all tools and prompts, flagging duplicate tool names too. */
export function lintAll(tools: Tool[], prompts: Prompt[]): Issue[] {
  const issues = [...tools.flatMap(lintTool), ...prompts.flatMap(lintPrompt)];
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) {
      issues.push(issue("error", `tool "${t.name}"`, "duplicate tool name"));
    }
    seen.add(t.name);
  }
  return issues;
}
