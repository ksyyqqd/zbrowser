import { z } from 'zod';

/**
 * Workflow node type
 */
export type WorkflowNodeType = 'ai' | 'automation' | 'condition' | 'start' | 'end';

/**
 * Workflow node position for visual editor
 */
export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Workflow node data - contains module-specific configuration
 */
export interface NodeData {
  // Common properties
  type?: string; // Node type (ai, automation, condition, start, end)
  name?: string; // Node name

  // AI Module configuration (simplified - model handled by session)
  prompt?: string;
  outputVariable?: string;
  contextVariables?: string[];

  // Automation Module configuration
  action?: string;
  intent?: string; // Description of action purpose
  parameters?: Record<string, unknown>;
  waitForStability?: boolean;
  delayAfter?: number;

  // Condition Module configuration
  conditionExpression?: string;
  trueNodeId?: string;
  falseNodeId?: string;
  evaluateWithAI?: boolean;
}

/**
 * Workflow node definition
 */
export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  description?: string;
  position: NodePosition;
  data: NodeData;
}

/**
 * Workflow edge definition - connects nodes
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string; // For conditional edges (true/false branches)
  marker?: 'block' | 'classic' | 'none'; // Arrow marker type
}

/**
 * Workflow variable definition
 */
export interface WorkflowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: unknown;
}

/**
 * Workflow execution configuration
 */
export interface WorkflowExecutionConfig {
  timeout?: number;
  maxRetries?: number;
  onError: 'stop' | 'continue' | 'retry';
}

/**
 * Workflow definition - main workflow structure
 */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: WorkflowVariable[];
  executionConfig: WorkflowExecutionConfig;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Workflow storage record
 */
export interface WorkflowRecord {
  workflows: Record<string, Workflow>;
}

// ============ Zod Schemas ============

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const NodeDataSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  prompt: z.string().optional(),
  outputVariable: z.string().optional(),
  contextVariables: z.array(z.string()).optional(),
  action: z.string().optional(),
  intent: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
  waitForStability: z.boolean().optional(),
  delayAfter: z.number().optional(),
  conditionExpression: z.string().optional(),
  trueNodeId: z.string().optional(),
  falseNodeId: z.string().optional(),
  evaluateWithAI: z.boolean().optional(),
});

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['ai', 'automation', 'condition', 'start', 'end']),
  name: z.string(),
  description: z.string().optional(),
  position: NodePositionSchema,
  data: NodeDataSchema,
});

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  condition: z.string().optional(),
});

export const WorkflowVariableSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

export const WorkflowExecutionConfigSchema = z.object({
  timeout: z.number().optional(),
  maxRetries: z.number().optional(),
  onError: z.enum(['stop', 'continue', 'retry']),
});

export const WorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(), // Allow empty description
  version: z.string().default('1.0.0'),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  variables: z.array(WorkflowVariableSchema).default([]),
  executionConfig: WorkflowExecutionConfigSchema.default({
    onError: 'stop',
  }),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
