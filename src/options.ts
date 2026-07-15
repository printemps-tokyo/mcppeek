/** Pure helpers for validating CLI flag values. */

/**
 * Parse the --timeout flag. Returns undefined when the flag was not given,
 * and throws on anything that is not a positive number of milliseconds
 * (previously a value like "20s" became NaN and disabled the timeout silently).
 */
export function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--timeout must be a positive number of milliseconds, got "${raw}"`);
  }
  return n;
}

/** RFC 7230 token characters, the only ones allowed in a header field name. */
const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Parse repeated --header flags of the form "Name: value" (curl style) into
 * a header record. Throws on a flag without a colon or with an empty name,
 * on control characters in the name or value (a stray CR/LF would otherwise
 * surface later as an opaque ERR_INVALID_CHAR from node:http), and on names
 * outside the RFC 7230 token charset. Later flags overwrite earlier ones
 * with the same name.
 */
export function parseHeaderFlags(flags: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const flag of flags) {
    const idx = flag.indexOf(":");
    const name = idx === -1 ? "" : flag.slice(0, idx).trim();
    if (name === "") {
      throw new Error(`--header must look like "Name: value", got "${flag}"`);
    }
    if (!TOKEN_RE.test(name)) {
      throw new Error(`--header name "${name}" contains characters not allowed in a header name`);
    }
    const value = flag.slice(idx + 1).trim();
    if (hasControlChar(value)) {
      throw new Error(`--header value for "${name}" contains a control character`);
    }
    headers[name] = value;
  }
  return headers;
}

/** True when a tools/call result carries the MCP `isError: true` marker. */
export function toolResultIsError(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { isError?: unknown }).isError === true;
}
