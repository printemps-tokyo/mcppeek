/** A diagnostic finding from linting an MCP server's definitions. */

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  /** What the finding is about, e.g. `tool "search"` or `prompt "greet"`. */
  subject: string;
  message: string;
}

export function issue(severity: Severity, subject: string, message: string): Issue {
  return { severity, subject, message };
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
