import { z } from 'zod';
import type { ActionSchema } from './schemas';

/**
 * MCP Tool Action Schema
 * Execute an MCP tool from a connected server
 */
export const mcpToolActionSchema: ActionSchema = {
  name: 'mcp_tool',
  description:
    'Execute an MCP (Model Context Protocol) tool from a connected MCP server. MCP tools provide access to external capabilities like filesystem, database, web search, etc.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    server_id: z.string().describe('The ID of the connected MCP server'),
    tool_name: z.string().describe('The name of the MCP tool to execute'),
    arguments: z.record(z.unknown()).describe('Arguments to pass to the MCP tool'),
  }),
};

/**
 * List MCP Tools Action Schema
 * List available tools from MCP servers
 */
export const mcpListToolsActionSchema: ActionSchema = {
  name: 'mcp_list_tools',
  description: 'List all available MCP tools from connected MCP servers. Use this to discover available capabilities.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    server_id: z.string().optional().describe('Optional: filter by specific server ID'),
  }),
};

/**
 * Get MCP Server Status Action Schema
 */
export const mcpGetStatusActionSchema: ActionSchema = {
  name: 'mcp_get_status',
  description: 'Get the connection status of MCP servers',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    server_id: z.string().optional().describe('Optional: specific server ID to check'),
  }),
};
