/**
 * Minimal Server-Sent Events parsing (WHATWG event-stream), pure. The Streamable
 * HTTP transport may answer a POST with `text/event-stream`; we only need the
 * `data` payloads, which carry the JSON-RPC messages.
 */

/** Extract each event's concatenated `data:` payload from an SSE body. */
export function parseSseEvents(body: string): string[] {
  const events: string[] = [];
  let data: string[] = [];
  const flush = (): void => {
    if (data.length > 0) {
      events.push(data.join("\n"));
      data = [];
    }
  };
  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    if (rawLine === "") {
      flush();
      continue;
    }
    if (rawLine.startsWith(":")) continue; // comment
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
  }
  flush();
  return events;
}
