/** The transport contract shared by the stdio and HTTP MCP transports. */
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from "./jsonrpc.js";

export interface Transport {
  /** Establish the connection (spawn the subprocess / open the endpoint). */
  start(): Promise<void>;
  /** Send a request and resolve with its matching response. */
  sendRequest(message: JsonRpcRequest): Promise<JsonRpcResponse>;
  /** Send a fire-and-forget notification. */
  sendNotification(message: JsonRpcNotification): Promise<void>;
  /** Tear down the connection. */
  close(): Promise<void>;
}
