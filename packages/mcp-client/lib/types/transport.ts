import type { JSONSchema, MCPTool, ToolExecutionResult, ToolListResult } from './tool';
import type { ServerCapabilities, ServerStatus } from './server';

/**
 * Transport type configuration
 */
export interface TransportConfig {
  type: 'websocket' | 'stdio' | 'sse';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Connection event
 */
export interface ConnectionEvent {
  serverId: string;
  status: ServerStatus;
  error?: string;
  capabilities?: ServerCapabilities;
}

/**
 * Connection callback
 */
export type ConnectionCallback = (event: ConnectionEvent) => void;

/**
 * MCP Client interface
 */
export interface IMCPClient {
  // Connection management
  connect(config: TransportConfig, serverId: string): Promise<void>;
  disconnect(serverId: string): Promise<void>;
  isConnected(serverId: string): boolean;
  getStatus(serverId: string): ServerStatus;

  // Tool operations
  listTools(serverId: string): Promise<ToolListResult>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult>;

  // Event subscription
  subscribeToConnection(serverId: string, callback: ConnectionCallback): () => void;
}

/**
 * MCP Tool converted for Nanobrowser action system
 */
export interface MCPToolAction {
  tool: MCPTool;
  actionName: string; // Converted name: mcp_{serverId}_{toolName}
}
