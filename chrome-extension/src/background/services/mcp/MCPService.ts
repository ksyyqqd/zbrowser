import { MCPClient, type MCPServerConfig, type MCPTool, type ToolExecutionResult } from '@extension/mcp-client';
import { mcpServersStore } from '@extension/storage';
import { createLogger } from '../../log';

const logger = createLogger('MCPService');

/**
 * MCP Service - manages MCP server connections and tool operations
 */
export class MCPService {
  private client: MCPClient;
  private initialized: boolean = false;

  constructor() {
    this.client = new MCPClient();
  }

  /**
   * Initialize the MCP service - load configs and auto-connect
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing MCP service...');

    try {
      // Load server configs
      const servers = await mcpServersStore.getEnabledServers();
      const autoConnectServers = servers.filter(s => s.autoConnect);

      logger.info(`Found ${servers.length} MCP servers, ${autoConnectServers.length} with auto-connect`);

      // Auto-connect enabled servers
      for (const server of autoConnectServers) {
        try {
          await this.connectServer(server);
          logger.info(`Connected to MCP server: ${server.name}`);
        } catch (error) {
          logger.error(`Failed to connect to ${server.name}:`, error);
        }
      }

      this.initialized = true;
      logger.info('MCP service initialized');
    } catch (error) {
      logger.error('Failed to initialize MCP service:', error);
    }
  }

  /**
   * Connect to an MCP server
   */
  async connectServer(config: MCPServerConfig): Promise<void> {
    await this.client.connect(config);
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnectServer(serverId: string): Promise<void> {
    await this.client.disconnect(serverId);
  }

  /**
   * Execute an MCP tool
   */
  async executeTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    return this.client.executeTool(serverId, toolName, args);
  }

  /**
   * List available MCP tools
   */
  async listTools(serverId?: string): Promise<MCPTool[]> {
    return this.client.listTools(serverId);
  }

  /**
   * Get cached tools (synchronous, faster)
   */
  getCachedTools(serverId?: string): MCPTool[] {
    return this.client.getCachedTools(serverId);
  }

  /**
   * Get server status
   */
  getStatus(serverId?: string): Record<string, unknown> {
    if (serverId) {
      return {
        serverId,
        status: this.client.getStatus(serverId),
        connected: this.client.isConnected(serverId),
      };
    }

    // Return status for all servers
    const servers = this.client.getConnectedServers();
    return {
      servers: servers.map(id => ({
        serverId: id,
        status: this.client.getStatus(id),
        connected: this.client.isConnected(id),
      })),
    };
  }

  /**
   * Subscribe to connection events
   */
  subscribeToConnection(serverId: string, callback: (event: unknown) => void): () => void {
    return this.client.subscribeToConnection(
      serverId,
      callback as Parameters<typeof this.client.subscribeToConnection>[1],
    );
  }

  /**
   * Get the MCP client instance
   */
  getClient(): MCPClient {
    return this.client;
  }

  /**
   * Test server connection without saving
   */
  async testConnection(config: MCPServerConfig): Promise<{ success: boolean; error?: string }> {
    logger.info('Testing connection to', config.name, config.transport, config.url);

    try {
      // Create a temporary connection test with timeout
      const testPromise = this.client.connect(config);

      // Add timeout wrapper (30 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout after 30s')), 30000);
      });

      await Promise.race([testPromise, timeoutPromise]);
      logger.info('Connection successful to', config.name);

      // Disconnect after test
      await this.client.disconnect(config.id);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection test failed';
      logger.error('Connection test failed for', config.name, ':', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Refresh tool cache for a server
   */
  async refreshTools(serverId: string): Promise<void> {
    this.client.clearToolCache(serverId);
    await this.client.listTools(serverId);
  }

  /**
   * Cleanup - disconnect all servers
   */
  async cleanup(): Promise<void> {
    const servers = this.client.getConnectedServers();
    for (const serverId of servers) {
      try {
        await this.client.disconnect(serverId);
      } catch (error) {
        logger.error(`Failed to disconnect ${serverId}:`, error);
      }
    }
    this.initialized = false;
  }
}
