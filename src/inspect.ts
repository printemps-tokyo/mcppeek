/** Drive a client through initialize + listing, then lint the definitions. */
import { McpClient, type ConnectOptions } from "./client.js";
import { RpcError, METHOD_NOT_FOUND } from "./jsonrpc.js";
import { lintAll } from "./lint.js";
import { issue, type Issue } from "./issue.js";
import {
  PROTOCOL_VERSION,
  STATELESS_VERSION,
  type Implementation,
  type Prompt,
  type Resource,
  type ResourceTemplate,
  type ServerCapabilities,
  type Tool,
} from "./mcp.js";

export interface Inspection {
  server: Implementation;
  protocolVersion: string;
  /** True for the stateless 2026-07-28 protocol, false for initialize. */
  stateless: boolean;
  instructions?: string;
  capabilities: ServerCapabilities;
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  prompts: Prompt[];
  issues: Issue[];
}

/** Run a list call, treating "method not found" as an empty, unsupported list. */
async function optional<T>(label: string, fn: () => Promise<T[]>, issues: Issue[]): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RpcError && err.code === METHOD_NOT_FOUND) return [];
    issues.push(issue("warning", label, `list failed: ${(err as Error).message}`));
    return [];
  }
}

/** Initialize the server and gather everything it advertises. */
export async function inspect(client: McpClient, opts: ConnectOptions = {}): Promise<Inspection> {
  const init = await client.initialize(opts);
  const caps = init.capabilities ?? {};
  const issues: Issue[] = [];

  if (!init.stateless && init.protocolVersion !== PROTOCOL_VERSION) {
    issues.push(
      issue("info", "server", `speaks protocol ${init.protocolVersion} (mcppeek offered ${PROTOCOL_VERSION})`),
    );
  }
  if (!init.stateless && !opts.legacy) {
    issues.push(
      issue(
        "info",
        "server",
        `uses the initialize handshake; it does not answer server/discover of the stateless ${STATELESS_VERSION} revision`,
      ),
    );
  }

  const tools = caps.tools ? await optional("tools", () => client.listTools(), issues) : [];
  const resources = caps.resources ? await optional("resources", () => client.listResources(), issues) : [];
  const resourceTemplates = caps.resources
    ? await optional("resourceTemplates", () => client.listResourceTemplates(), issues)
    : [];
  const prompts = caps.prompts ? await optional("prompts", () => client.listPrompts(), issues) : [];

  if (!caps.tools && !caps.resources && !caps.prompts) {
    issues.push(issue("warning", "server", "advertises no tools, resources, or prompts capability"));
  }

  issues.push(...lintAll(tools, prompts));

  return {
    server: init.serverInfo,
    protocolVersion: init.protocolVersion,
    stateless: init.stateless === true,
    instructions: init.instructions,
    capabilities: caps,
    tools,
    resources,
    resourceTemplates,
    prompts,
    issues,
  };
}
