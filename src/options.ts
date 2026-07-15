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

/** True when a tools/call result carries the MCP `isError: true` marker. */
export function toolResultIsError(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { isError?: unknown }).isError === true;
}
