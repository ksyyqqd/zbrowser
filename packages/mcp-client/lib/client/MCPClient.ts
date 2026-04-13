import type { MCPServerConfig, ServerStatus, ServerCapabilities } from '../types/server';
import type { MCPTool, ToolExecutionResult, ToolListResult } from '../types/tool';
import type { TransportConfig, ConnectionCallback, ConnectionEvent } from '../types/transport';
import { createTransport, BaseTransport } from '../transport';
import { convertJSONSchemaToZod } from '../utils/schemaConverter';

/**
 * MCP Client - Main class for managing MCP server connections and tool operations
 */
export class MCPClient {
  private transports: Map<string, BaseTransport> = new Map();
  private serverConfigs: Map<string, MCPServerConfig> = new Map();
  private toolCache: Map<string, MCPTool[]> = new Map();
  private connectionCallbacks: Map<string, Set<ConnectionCallback>> = new Map();

  /**
   * Connect to an MCP server
   */
  async connect(config: MCPServerConfig): Promise<void> {
    const transportConfig: TransportConfig = {
      type: config.transport,
      url: config.url,
      command: config.command,
      args: config.args,
      env: config.env,
    };

    const transport = createTransport(config.id, transportConfig);

    // Subscribe to transport events
    transport.subscribe(event => {
      this.handleConnectionEvent(event);
    });

    this.transports.set(config.id, transport);
    this.serverConfigs.set(config.id, config);

    try {
      await transport.connect();

      // Discover tools after connection
      await this.discoverTools(config.id);
    } catch (error) {
      // Clean up on failure
      this.transports.delete(config.id);
      this.serverConfigs.delete(config.id);
      throw error;
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverId: string): Promise<void> {
    const transport = this.transports.get(serverId);
    if (transport) {
      await transport.disconnect();
      this.transports.delete(serverId);
      this.serverConfigs.delete(serverId);
      this.toolCache.delete(serverId);
    }
  }

  /**
   * Check if connected to a server
   */
  isConnected(serverId: string): boolean {
    const transport = this.transports.get(serverId);
    return transport?.getStatus() === 'connected';
  }

  /**
   * Get server status
   */
  getStatus(serverId: string): ServerStatus {
    const transport = this.transports.get(serverId);
    return transport?.getStatus() ?? 'disconnected';
  }

  /**
   * Get server capabilities
   */
  getCapabilities(serverId: string): ServerCapabilities | undefined {
    const transport = this.transports.get(serverId);
    return transport?.getCapabilities();
  }

  /**
   * Subscribe to connection events for a server
   */
  subscribeToConnection(serverId: string, callback: ConnectionCallback): () => void {
    if (!this.connectionCallbacks.has(serverId)) {
      this.connectionCallbacks.set(serverId, new Set());
    }
    this.connectionCallbacks.get(serverId)!.add(callback);

    return () => {
      this.connectionCallbacks.get(serverId)?.delete(callback);
    };
  }

  /**
   * List tools from a specific server or all connected servers
   */
  async listTools(serverId?: string): Promise<MCPTool[]> {
    if (serverId) {
      return this.listToolsFromServer(serverId);
    }

    // Get tools from all connected servers
    const allTools: MCPTool[] = [];
    for (const id of this.transports.keys()) {
      const tools = await this.listToolsFromServer(id);
      allTools.push(...tools);
    }
    return allTools;
  }

  /**
   * List tools from a specific server
   */
  private async listToolsFromServer(serverId: string): Promise<MCPTool[]> {
    // Check cache first
    if (this.toolCache.has(serverId)) {
      return this.toolCache.get(serverId)!;
    }

    const transport = this.transports.get(serverId);
    if (!transport || transport.getStatus() !== 'connected') {
      return [];
    }

    try {
      const result = (await transport.sendMessage('tools/list')) as ToolListResult;
      const tools: MCPTool[] = (result?.tools ?? []).map(tool => ({
        serverId,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        zodSchema: convertJSONSchemaToZod(tool.inputSchema),
      }));

      // Cache the tools
      this.toolCache.set(serverId, tools);
      return tools;
    } catch (error) {
      console.error(`Failed to list tools from ${serverId}:`, error);
      return [];
    }
  }

  /**
   * Discover and cache tools from a server
   */
  private async discoverTools(serverId: string): Promise<void> {
    await this.listToolsFromServer(serverId);
  }

  /**
   * Execute a tool on an MCP server
   */
  async executeTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const transport = this.transports.get(serverId);
    if (!transport || transport.getStatus() !== 'connected') {
      return {
        success: false,
        content: null,
        isError: true,
        error: `Not connected to server ${serverId}`,
      };
    }

    try {
      const result = await transport.sendMessage('tools/call', {
        name: toolName,
        arguments: args,
      });

      // Parse the result
      const callResult = result as { content?: Array<{ type: string; text?: string; data?: unknown }> };
      let content: unknown = null;

      if (callResult.content && callResult.content.length > 0) {
        // Extract text or data from content
        const textContent = callResult.content.find(c => c.type === 'text');
        if (textContent?.text) {
          content = textContent.text;
        } else {
          content = callResult.content;
        }
      }

      return {
        success: true,
        content,
        isError: false,
      };
    } catch (error) {
      return {
        success: false,
        content: null,
        isError: true,
        error: error instanceof Error ? error.message : 'Tool execution failed',
      };
    }
  }

  /**
   * Get cached tools (synchronous)
   */
  getCachedTools(serverId?: string): MCPTool[] {
    if (serverId) {
      return this.toolCache.get(serverId) ?? [];
    }

    const allTools: MCPTool[] = [];
    for (const tools of this.toolCache.values()) {
      allTools.push(...tools);
    }
    return allTools;
  }

  /**
   * Clear tool cache for a server
   */
  clearToolCache(serverId: string): void {
    this.toolCache.delete(serverId);
  }

  /**
   * Get all connected server IDs
   */
  getConnectedServers(): string[] {
    return Array.from(this.transports.keys()).filter(id => this.isConnected(id));
  }

  /**
   * Handle connection event from transport
   */
  private handleConnectionEvent(event: ConnectionEvent): void {
    const callbacks = this.connectionCallbacks.get(event.serverId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(event);
      }
    }

    // Clear tool cache on disconnect
    if (event.status === 'disconnected' || event.status === 'error') {
      this.toolCache.delete(event.serverId);
    }
  }
}
