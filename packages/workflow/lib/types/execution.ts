import { z } from 'zod';
import type { Workflow, WorkflowNode } from './workflow';

/**
 * Workflow execution context
 * Provides access to browser automation and AI agents
 */
export interface WorkflowExecutionContext {
  // Execute browser automation action
  executeAction: (actionName: string, params: Record<string, unknown>) => Promise<ActionResult>;
  // Invoke AI agent with prompt (full Planner/Navigator pipeline — has page context, skills, etc.)
  invokeAI: (prompt: string, context?: Record<string, unknown>) => Promise<AIResult>;
  /**
   * Lightweight LLM invocation — pure text in / text out.
   * No page DOM context, no skill catalog, no agent identity prompts.
   * Use this for purely textual tasks like condition evaluation, summarization
   * over already-fetched variables, classification, etc.
   * Falls back to `invokeAI` if not provided by the host environment.
   */
  invokeAILight?: (prompt: string) => Promise<AIResult>;
  // Get/set workflow variables
  getVariable: (name: string) => unknown;
  setVariable: (name: string, value: unknown) => void;
  /**
   * Resolve another saved workflow by id (for subflow node).
   * Host (background) injects a function that reads from the workflow store.
   * Returning `null` is interpreted as "not found" and surfaces a node-level error.
   */
  loadWorkflowById?: (workflowId: string) => Promise<Workflow | null>;
  /**
   * Stack of workflow ids the executor is currently inside of, including the
   * top-level workflow. Used to detect subflow cycles (A → B → A).
   * Internal — populated by the executor itself when recursing.
   */
  _subflowStack?: string[];
  // Emit execution event
  emitEvent?: (event: WorkflowEvent) => Promise<void>;
  // Current execution state
  currentNodeId?: string;
  executedNodes?: WorkflowNode[];
}

/**
 * Action result - compatible with Nanobrowser ActionResult
 */
export interface ActionResult {
  isDone?: boolean;
  success?: boolean;
  extractedContent?: string | null;
  error?: string | null;
  includeInMemory?: boolean;
}

/**
 * AI result from agent invocation
 */
export interface AIResult {
  success: boolean;
  response?: string;
  decision?: Record<string, unknown>;
  error?: string;
}

/**
 * Node execution result
 */
export interface NodeResult {
  nodeId: string;
  nodeType: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number; // Execution time in ms
  nextNodeId?: string; // For condition nodes, the next node to execute
  selectedBranchId?: string; // For condition nodes, the chosen branch port id (used to gate side outputs)
}

/**
 * Workflow execution result
 */
export interface WorkflowResult {
  workflowId: string;
  success: boolean;
  results: NodeResult[];
  finalOutput?: unknown;
  error?: string;
  duration: number; // Total execution time in ms
}

/**
 * Workflow event types
 */
export type WorkflowEventType =
  | 'WORKFLOW_START'
  | 'WORKFLOW_OK'
  | 'WORKFLOW_FAIL'
  | 'WORKFLOW_CANCEL'
  | 'NODE_START'
  | 'NODE_OK'
  | 'NODE_FAIL'
  | 'BRANCH_SELECT';

/**
 * Workflow event
 */
export interface WorkflowEvent {
  type: WorkflowEventType;
  workflowId: string;
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  details?: string;
  timestamp?: number;
}

/**
 * Execution state for tracking progress
 */
export interface ExecutionState {
  workflowId: string;
  currentNodeId: string | null;
  executedNodes: WorkflowNode[];
  variables: Record<string, unknown>;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  error?: string;
}

// ============ Zod Schemas ============

export const ActionResultSchema = z.object({
  isDone: z.boolean().optional(),
  success: z.boolean().optional(),
  extractedContent: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  includeInMemory: z.boolean().optional(),
});

export const AIResultSchema = z.object({
  success: z.boolean(),
  response: z.string().optional(),
  decision: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export const NodeResultSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  duration: z.number(),
  nextNodeId: z.string().optional(),
  selectedBranchId: z.string().optional(),
});

export const WorkflowResultSchema = z.object({
  workflowId: z.string(),
  success: z.boolean(),
  results: z.array(NodeResultSchema),
  finalOutput: z.unknown().optional(),
  error: z.string().optional(),
  duration: z.number(),
});

export const WorkflowEventTypeSchema = z.enum([
  'WORKFLOW_START',
  'WORKFLOW_OK',
  'WORKFLOW_FAIL',
  'WORKFLOW_CANCEL',
  'NODE_START',
  'NODE_OK',
  'NODE_FAIL',
  'BRANCH_SELECT',
]);

export const WorkflowEventSchema = z.object({
  type: WorkflowEventTypeSchema,
  workflowId: z.string(),
  nodeId: z.string().optional(),
  nodeName: z.string().optional(),
  nodeType: z.string().optional(),
  details: z.string().optional(),
  timestamp: z.number().optional(),
});

export const ExecutionStateSchema = z.object({
  workflowId: z.string(),
  currentNodeId: z.string().nullable(),
  executedNodes: z.array(z.any()).optional(),
  variables: z.record(z.unknown()).optional(),
  status: z.enum(['running', 'paused', 'completed', 'failed', 'cancelled']),
  startTime: z.number(),
  error: z.string().optional(),
});
