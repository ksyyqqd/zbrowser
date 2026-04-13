import type { z } from 'zod';

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'websocket' | 'stdio' | 'sse';
  url?: string; // websocket or SSE URL
  command?: string; // stdio command
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  autoConnect: boolean;
  timeout: number;
  retryAttempts: number;
  createdAt: number;
  updatedAt?: number;
}

/**
 * MCP Server Status
 */
export type ServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * MCP Server State with runtime info
 */
export interface MCPServerState {
  config: MCPServerConfig;
  status: ServerStatus;
  lastConnected?: number;
  error?: string;
  capabilities?: ServerCapabilities;
}

/**
 * MCP Server Capabilities
 */
export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: {};
}

/**
 * Storage record for MCP servers
 */
export interface MCPServersRecord {
  servers: Record<string, MCPServerConfig>;
}

/**
 * Default values for MCP server config
 */
export const DEFAULT_MCP_SERVER_CONFIG: Partial<MCPServerConfig> = {
  enabled: true,
  autoConnect: true,
  timeout: 30000,
  retryAttempts: 3,
};
