import type { TransportConfig, ConnectionCallback, ConnectionEvent } from '../types/transport';
import type { ServerStatus, ServerCapabilities } from '../types/server';
import type { ToolExecutionResult, ToolListResult } from '../types/tool';

/**
 * Abstract base class for MCP transports
 */
export abstract class BaseTransport {
  protected serverId: string;
  protected status: ServerStatus = 'disconnected';
  protected capabilities?: ServerCapabilities;
  protected connectionCallbacks: Set<ConnectionCallback> = new Set();

  constructor(serverId: string) {
    this.serverId = serverId;
  }

  /**
   * Connect to the MCP server
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the MCP server
   */
  abstract disconnect(): Promise<void>;

  /**
   * Send a message and receive response
   */
  abstract sendMessage(method: string, params?: unknown): Promise<unknown>;

  /**
   * Get current connection status
   */
  getStatus(): ServerStatus {
    return this.status;
  }

  /**
   * Get server capabilities
   */
  getCapabilities(): ServerCapabilities | undefined {
    return this.capabilities;
  }

  /**
   * Subscribe to connection events
   */
  subscribe(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.add(callback);
    return () => this.connectionCallbacks.delete(callback);
  }

  /**
   * Emit connection event to all subscribers
   */
  protected emitEvent(event: ConnectionEvent): void {
    for (const callback of this.connectionCallbacks) {
      callback(event);
    }
  }

  /**
   * Update status and emit event
   */
  protected setStatus(status: ServerStatus, error?: string): void {
    this.status = status;
    this.emitEvent({
      serverId: this.serverId,
      status,
      error,
      capabilities: this.capabilities,
    });
  }
}

/**
 * WebSocket transport for MCP servers
 */
export class WebSocketTransport extends BaseTransport {
  private ws?: WebSocket;
  private config: TransportConfig;
  private messageQueue: Array<{
    method: string;
    params?: unknown;
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }> = [];
  private pendingRequests: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private messageId = 0;
  private initialized: boolean = false;

  constructor(serverId: string, config: TransportConfig) {
    super(serverId);
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error('WebSocket URL is required');
    }

    const url = this.config.url;
    this.setStatus('connecting');

    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
        this.cleanup();
      }, 15000);

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          // WebSocket connected, now initialize MCP protocol
          this.initializeMCP()
            .then(() => {
              clearTimeout(connectionTimeout);
              this.setStatus('connected');
              this.initialized = true;
              resolve();
            })
            .catch(error => {
              clearTimeout(connectionTimeout);
              this.setStatus('error', error instanceof Error ? error.message : 'Initialize failed');
              reject(error);
            });
        };

        this.ws.onmessage = event => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = () => {
          clearTimeout(connectionTimeout);
          this.setStatus('error', 'WebSocket error');
          reject(new Error('WebSocket error'));
        };

        this.ws.onclose = () => {
          clearTimeout(connectionTimeout);
          this.setStatus('disconnected');
          this.cleanup();
        };
      } catch (error) {
        clearTimeout(connectionTimeout);
        this.setStatus('error', error instanceof Error ? error.message : 'Connection failed');
        reject(error);
      }
    });
  }

  /**
   * Initialize MCP protocol - send initialize request and wait for response
   */
  private async initializeMCP(): Promise<void> {
    // Send initialize request
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'nanobrowser',
        version: '0.1.13',
      },
    });

    const initResult = result as { capabilities?: ServerCapabilities };
    this.capabilities = initResult.capabilities;

    // Send initialized notification (no response expected)
    this.sendNotification('notifications/initialized');
  }

  /**
   * Send a request and wait for response
   */
  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.ws) {
      throw new Error('WebSocket not connected');
    }

    const id = `msg-${++this.messageId}`;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 10000);

      this.pendingRequests.set(id, {
        resolve: v => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: e => {
          clearTimeout(timeout);
          reject(e);
        },
      });
      this.ws!.send(message);
    });
  }

  /**
   * Send a notification (no response expected)
   */
  private sendNotification(method: string, params?: unknown): void {
    if (!this.ws) {
      return;
    }
    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    this.ws.send(message);
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.cleanup();
    this.setStatus('disconnected');
  }

  async sendMessage(method: string, params?: unknown): Promise<unknown> {
    if (!this.ws || this.status !== 'connected' || !this.initialized) {
      throw new Error('Not connected to MCP server');
    }

    return this.sendRequest(method, params);
  }

  private handleMessage(data: string): void {
    try {
      const response = JSON.parse(data) as {
        jsonrpc: string;
        id?: string;
        result?: unknown;
        error?: { message: string };
      };

      if (response.id && this.pendingRequests.has(response.id)) {
        const pending = this.pendingRequests.get(response.id)!;
        this.pendingRequests.delete(response.id);

        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    } catch {
      // Ignore invalid messages
    }
  }

  private cleanup(): void {
    this.pendingRequests.clear();
    this.messageQueue = [];
  }
}

/**
 * Stdio transport via Chrome Native Messaging
 */
export class StdioTransport extends BaseTransport {
  private config: TransportConfig;
  private nativePort?: chrome.runtime.Port;
  private pendingRequests: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();

  constructor(serverId: string, config: TransportConfig) {
    super(serverId);
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.command) {
      throw new Error('Command is required for stdio transport');
    }

    this.setStatus('connecting');

    try {
      // Connect to native messaging host
      this.nativePort = chrome.runtime.connectNative('com.nanobrowser.mcp_host');

      this.nativePort.onMessage.addListener(message => {
        this.handleNativeMessage(message);
      });

      this.nativePort.onDisconnect.addListener(() => {
        this.setStatus('disconnected');
        this.nativePort = undefined;
      });

      // Send start command to native host
      this.sendToNative({
        type: 'start',
        command: this.config.command,
        args: this.config.args ?? [],
        env: this.config.env ?? {},
      });

      // Wait for ready signal
      await this.waitForReady();

      this.setStatus('connected');
    } catch (error) {
      this.setStatus('error', error instanceof Error ? error.message : 'Native messaging failed');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.nativePort) {
      this.sendToNative({ type: 'stop' });
      this.nativePort.disconnect();
      this.nativePort = undefined;
    }
    this.setStatus('disconnected');
  }

  async sendMessage(method: string, params?: unknown): Promise<unknown> {
    if (!this.nativePort || this.status !== 'connected') {
      throw new Error('Not connected to MCP server');
    }

    const id = `msg-${Date.now()}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.sendToNative({
        type: 'mcp_message',
        id,
        method,
        params,
      });
    });
  }

  private sendToNative(message: unknown): void {
    if (this.nativePort) {
      this.nativePort.postMessage(message);
    }
  }

  private handleNativeMessage(message: {
    type: string;
    id?: string;
    result?: unknown;
    error?: string;
    capabilities?: ServerCapabilities;
  }): void {
    if (message.type === 'ready') {
      this.capabilities = message.capabilities;
    } else if (message.type === 'mcp_response' && message.id) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.type === 'error') {
      this.setStatus('error', message.error ?? 'Native host error');
    }
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Native host timeout'));
      }, 10000);

      const unsubscribe = this.subscribe(event => {
        if (event.status === 'connected') {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        } else if (event.status === 'error') {
          clearTimeout(timeout);
          unsubscribe();
          reject(new Error(event.error ?? 'Connection failed'));
        }
      });
    });
  }
}

/**
 * Factory function to create appropriate transport
 */
export function createTransport(serverId: string, config: TransportConfig): BaseTransport {
  if (config.type === 'websocket') {
    return new WebSocketTransport(serverId, config);
  } else if (config.type === 'stdio') {
    return new StdioTransport(serverId, config);
  } else if (config.type === 'sse') {
    return new SSETransport(serverId, config);
  }
  throw new Error(`Unsupported transport type: ${config.type}`);
}

/**
 * SSE (Server-Sent Events) transport for MCP servers
 *
 * SSE transport uses HTTP POST for sending requests and EventSource for receiving responses.
 * This is commonly used by MCP servers like mcp-remote and many cloud-hosted MCP services.
 */
export class SSETransport extends BaseTransport {
  private config: TransportConfig;
  private eventSource?: EventSource;
  private pendingRequests: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private messageId = 0;
  private initialized: boolean = false;
  private endpoint: string;

  constructor(serverId: string, config: TransportConfig) {
    super(serverId);
    this.config = config;
    // Extract endpoint from URL (remove /sse path if present)
    this.endpoint = this.normalizeEndpoint(config.url || '');
  }

  /**
   * Normalize the endpoint URL
   * SSE servers typically have /sse endpoint for EventSource
   * and the same base URL for POST requests
   */
  private normalizeEndpoint(url: string): string {
    // Remove trailing /sse if present
    return url.replace(/\/sse$/, '').replace(/\/sse\/$/, '');
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error('SSE URL is required');
    }

    this.setStatus('connecting');

    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        reject(new Error('SSE connection timeout'));
        this.cleanup();
      }, 15000);

      try {
        // Create EventSource for receiving messages
        // SSE endpoint typically ends with /sse
        const sseUrl = this.endpoint + '/sse';
        this.eventSource = new EventSource(sseUrl);

        this.eventSource.onopen = () => {
          // SSE connected, now initialize MCP protocol
          this.initializeMCP()
            .then(() => {
              clearTimeout(connectionTimeout);
              this.setStatus('connected');
              this.initialized = true;
              resolve();
            })
            .catch(error => {
              clearTimeout(connectionTimeout);
              this.setStatus('error', error instanceof Error ? error.message : 'Initialize failed');
              reject(error);
            });
        };

        this.eventSource.onmessage = event => {
          this.handleMessage(event.data);
        };

        this.eventSource.onerror = () => {
          clearTimeout(connectionTimeout);
          if (this.status === 'connecting') {
            this.setStatus('error', 'SSE connection failed');
            reject(new Error('SSE connection failed'));
          } else {
            this.setStatus('error', 'SSE connection lost');
          }
        };
      } catch (error) {
        clearTimeout(connectionTimeout);
        this.setStatus('error', error instanceof Error ? error.message : 'Connection failed');
        reject(error);
      }
    });
  }

  /**
   * Initialize MCP protocol - send initialize request via HTTP POST
   */
  private async initializeMCP(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'nanobrowser',
        version: '0.1.13',
      },
    });

    const initResult = result as { capabilities?: ServerCapabilities };
    this.capabilities = initResult.capabilities;

    // Send initialized notification
    await this.sendNotification('notifications/initialized');
  }

  /**
   * Send a request via HTTP POST and wait for response via SSE
   */
  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id = `msg-${++this.messageId}`;
    const message = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000); // 30 second timeout for requests

      this.pendingRequests.set(id, {
        resolve: v => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: e => {
          clearTimeout(timeout);
          reject(e);
        },
      });

      // Send POST request to the MCP endpoint
      fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }).catch(error => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error(`HTTP request failed: ${error.message}`));
      });
    });
  }

  /**
   * Send a notification via HTTP POST (no response expected)
   */
  private async sendNotification(method: string, params?: unknown): Promise<void> {
    const message = { jsonrpc: '2.0', method, params };

    await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
  }

  async disconnect(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    this.cleanup();
    this.setStatus('disconnected');
  }

  async sendMessage(method: string, params?: unknown): Promise<unknown> {
    if (!this.eventSource || this.status !== 'connected' || !this.initialized) {
      throw new Error('Not connected to MCP server');
    }

    return this.sendRequest(method, params);
  }

  private handleMessage(data: string): void {
    try {
      const response = JSON.parse(data) as {
        jsonrpc: string;
        id?: string;
        result?: unknown;
        error?: { message: string };
      };

      if (response.id && this.pendingRequests.has(response.id)) {
        const pending = this.pendingRequests.get(response.id)!;
        this.pendingRequests.delete(response.id);

        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    } catch {
      // Ignore invalid messages
    }
  }

  private cleanup(): void {
    this.pendingRequests.clear();
    this.initialized = false;
  }
}
