import { z } from 'zod';

/**
 * Workflow node type
 */
export type WorkflowNodeType =
  | 'ai'
  | 'automation'
  | 'condition'
  | 'loop'
  | 'output'
  | 'note'
  | 'subflow'
  | 'start'
  | 'end';

/**
 * Workflow node position for visual editor
 */
export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Condition branch definition - each branch has a name and ID that maps to an output port
 */
export interface ConditionBranch {
  id: string;
  name: string;
}

/**
 * Workflow node data - contains module-specific configuration
 */
export interface NodeData {
  // Common properties
  type?: string; // Node type (ai, automation, condition, start, end)
  name?: string; // Node name
  selected?: boolean; // Runtime UI state - node is selected

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

  // Condition Module configuration - dynamic multi-branch with AI evaluation
  branches?: ConditionBranch[];
  conditionExpression?: string; // Deprecated - use prompt instead
  trueNodeId?: string; // Deprecated - use branches + edge sourcePort instead
  falseNodeId?: string; // Deprecated - use branches + edge sourcePort instead
  evaluateWithAI?: boolean;

  // Output Module configuration
  content?: string; // Output content template, supports {{variableName}} interpolation
  label?: string; // Display label for this output (e.g. "Final Report", "Summary")

  // Loop Module configuration (option A: loop-back edge)
  loopMode?: 'fixed' | 'ai_judge';
  maxIterations?: number; // Hard safety cap, also the target count in 'fixed' mode
  iterationVariable?: string; // Variable name to expose iteration index (writes <name>_iter / <name>_done)

  // Note (sticky) — display-only, never participates in execution.
  // `content` is reused from the field declared above for output/AI prompts.
  noteColor?: 'yellow' | 'blue' | 'green' | 'pink' | 'gray';
  noteWidth?: number; // Pixel width on the canvas
  noteHeight?: number; // Pixel height on the canvas

  // Subflow — invokes another saved workflow as a sub-routine.
  subflowId?: string; // Target workflow id
  /**
   * Input variable mapping. Keys are variable names INSIDE the sub-workflow,
   * values are template strings resolved in the PARENT scope (e.g. "{{topic}}").
   */
  subflowInputs?: Record<string, string>;
  /**
   * Output variable mapping. Keys are variable names INSIDE the sub-workflow,
   * values are variable names in the PARENT scope that should receive them.
   */
  subflowOutputs?: Record<string, string>;
  /** Whether the subflow is rendered expanded (inline preview) on the canvas. UI-only. */
  subflowExpanded?: boolean;
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
  sourcePort?: string; // Output port ID (branch ID for condition nodes)
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

export const ConditionBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const NodeDataSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  selected: z.boolean().optional(),
  prompt: z.string().optional(),
  outputVariable: z.string().optional(),
  contextVariables: z.array(z.string()).optional(),
  action: z.string().optional(),
  intent: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
  waitForStability: z.boolean().optional(),
  delayAfter: z.number().optional(),
  branches: z.array(ConditionBranchSchema).optional(),
  conditionExpression: z.string().optional(),
  trueNodeId: z.string().optional(),
  falseNodeId: z.string().optional(),
  evaluateWithAI: z.boolean().optional(),
  content: z.string().optional(),
  label: z.string().optional(),
  loopMode: z.enum(['fixed', 'ai_judge']).optional(),
  maxIterations: z.number().int().positive().optional(),
  iterationVariable: z.string().optional(),
  noteColor: z.enum(['yellow', 'blue', 'green', 'pink', 'gray']).optional(),
  noteWidth: z.number().int().positive().optional(),
  noteHeight: z.number().int().positive().optional(),
  subflowId: z.string().optional(),
  subflowInputs: z.record(z.string()).optional(),
  subflowOutputs: z.record(z.string()).optional(),
  subflowExpanded: z.boolean().optional(),
});

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['ai', 'automation', 'condition', 'loop', 'output', 'note', 'subflow', 'start', 'end']),
  name: z.string(),
  description: z.string().optional(),
  position: NodePositionSchema,
  data: NodeDataSchema,
});

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourcePort: z.string().optional(),
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
