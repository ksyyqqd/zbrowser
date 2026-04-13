import type { z } from 'zod';

/**
 * MCP Tool definition from server
 */
export interface MCPTool {
  serverId: string;
  name: string;
  description: string;
  inputSchema: JSONSchema; // Original MCP schema
  zodSchema?: z.ZodType; // Converted Zod schema (computed)
}

/**
 * JSON Schema definition (MCP format)
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: (string | number)[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  additionalProperties?: boolean | JSONSchema;
  $ref?: string;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  success: boolean;
  content: unknown;
  isError: boolean;
  error?: string;
}

/**
 * Tool call request
 */
export interface ToolCallRequest {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool list from server
 */
export interface ToolListResult {
  tools: Array<{
    name: string;
    description: string;
    inputSchema: JSONSchema;
  }>;
}
