import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'websocket' | 'stdio' | 'sse';
  url?: string; // For websocket/sse transport
  command?: string; // For stdio transport
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
 * MCP Servers storage record
 */
export interface MCPServersRecord {
  servers: Record<string, MCPServerConfig>;
}

/**
 * Default MCP server config values
 */
export const DEFAULT_MCP_SERVER_CONFIG: Partial<MCPServerConfig> = {
  enabled: true,
  autoConnect: true,
  timeout: 30000,
  retryAttempts: 3,
};

/**
 * MCP Servers Storage type with extended methods
 */
export type MCPServersStorage = BaseStorage<MCPServersRecord> & {
  addServer: (config: MCPServerConfig) => Promise<void>;
  updateServer: (id: string, updates: Partial<MCPServerConfig>) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  getServer: (id: string) => Promise<MCPServerConfig | undefined>;
  getAllServers: () => Promise<MCPServerConfig[]>;
  getEnabledServers: () => Promise<MCPServerConfig[]>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
};

// Storage key
const STORAGE_KEY = 'mcp-servers';

// Create base storage
const storage = createStorage<MCPServersRecord>(
  STORAGE_KEY,
  { servers: {} },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

/**
 * MCP Servers Store
 */
export const mcpServersStore: MCPServersStorage = {
  ...storage,

  async addServer(config: MCPServerConfig) {
    if (!config.id) {
      throw new Error('Server ID is required');
    }

    const serverConfig: MCPServerConfig = {
      ...DEFAULT_MCP_SERVER_CONFIG,
      ...config,
      createdAt: config.createdAt ?? Date.now(),
    };

    const current = await storage.get();
    await storage.set({
      servers: {
        ...current.servers,
        [serverConfig.id]: serverConfig,
      },
    });
  },

  async updateServer(id: string, updates: Partial<MCPServerConfig>) {
    const current = await storage.get();
    const existing = current.servers[id];

    if (!existing) {
      throw new Error(`Server not found: ${id}`);
    }

    const updated: MCPServerConfig = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    await storage.set({
      servers: {
        ...current.servers,
        [id]: updated,
      },
    });
  },

  async removeServer(id: string) {
    const current = await storage.get();
    const { [id]: removed, ...rest } = current.servers;
    await storage.set({ servers: rest });
  },

  async getServer(id: string) {
    const current = await storage.get();
    return current.servers[id];
  },

  async getAllServers() {
    const current = await storage.get();
    return Object.values(current.servers);
  },

  async getEnabledServers() {
    const servers = await this.getAllServers();
    return servers.filter(s => s.enabled);
  },

  async setEnabled(id: string, enabled: boolean) {
    await this.updateServer(id, { enabled });
  },
};
