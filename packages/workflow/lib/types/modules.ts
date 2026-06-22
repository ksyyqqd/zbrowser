import { z } from 'zod';

/**
 * AI Module configuration
 * Executes AI agent with custom prompt
 * Model configuration is handled by the session mechanism, not here
 */
export interface AIModuleConfig {
  prompt: string;
  outputVariable?: string; // Variable name to store AI response
  contextVariables?: string[]; // Variables to include in AI context
}

/**
 * Automation action types
 */
export type AutomationAction =
  | 'click_element'
  | 'input_text'
  | 'scroll_to_percent'
  | 'scroll_to_top'
  | 'scroll_to_bottom'
  | 'scroll_to_text'
  | 'go_to_url'
  | 'go_back'
  | 'go_forward'
  | 'open_tab'
  | 'close_tab'
  | 'switch_tab'
  | 'send_keys'
  | 'get_dropdown_options'
  | 'select_dropdown_option'
  | 'wait'
  | 'cache_content';

/**
 * Automation Module configuration
 * Executes browser automation actions
 */
export interface AutomationModuleConfig {
  action: AutomationAction;
  parameters: Record<string, unknown>;
  waitForStability?: boolean; // Wait for page stability after action
  delayAfter?: number; // Delay in ms after action execution
  intent?: string; // Description of action purpose
}

/**
 * Condition Module configuration
 * Evaluates conditions via AI prompt and routes to different named branches
 */
export interface ConditionModuleConfig {
  prompt: string; // AI prompt to evaluate and decide which branch to take
  branches: Array<{ id: string; name: string }>; // Dynamic branch definitions, each maps to an output port
  evaluateWithAI: boolean; // true: AI evaluation (recommended), false: simple expression (legacy)
  // Legacy fields kept for backward compatibility
  conditionExpression?: string; // Deprecated: use prompt instead
  trueNodeId?: string; // Deprecated: use branches + edge sourcePort instead
  falseNodeId?: string; // Deprecated: use branches + edge sourcePort instead
}

/**
 * Simple expression operators
 */
export type ExpressionOperator =
  | '==='
  | '!=='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'includes'
  | 'startsWith'
  | 'endsWith'
  | 'matches';

/**
 * Simple condition expression structure
 */
export interface SimpleExpression {
  left: string; // Variable path e.g. "{{result.success}}"
  operator: ExpressionOperator;
  right: string | number | boolean; // Value to compare
}

// ============ Zod Schemas ============

export const AIModuleConfigSchema = z.object({
  prompt: z.string().min(1),
  outputVariable: z.string().optional(),
  contextVariables: z.array(z.string()).optional(),
});

export const AutomationActionSchema = z.enum([
  'click_element',
  'input_text',
  'scroll_to_percent',
  'scroll_to_top',
  'scroll_to_bottom',
  'scroll_to_text',
  'go_to_url',
  'go_back',
  'go_forward',
  'open_tab',
  'close_tab',
  'switch_tab',
  'send_keys',
  'get_dropdown_options',
  'select_dropdown_option',
  'wait',
  'cache_content',
]);

export const AutomationModuleConfigSchema = z.object({
  action: AutomationActionSchema,
  parameters: z.record(z.unknown()),
  waitForStability: z.boolean().optional(),
  delayAfter: z.number().optional(),
  intent: z.string().optional(),
});

const ConditionBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const ConditionModuleConfigSchema = z.object({
  prompt: z.string().min(1),
  branches: z.array(ConditionBranchSchema).min(1),
  evaluateWithAI: z.boolean(),
  conditionExpression: z.string().optional(),
  trueNodeId: z.string().optional(),
  falseNodeId: z.string().optional(),
});

/**
 * Loop Module configuration (option A: loop-back edge)
 *
 * Has two named output ports: `continue` and `exit`.
 * Each tick the executor evaluates the loop predicate and routes accordingly:
 *  - `continue` should be wired (loop-back edge) to the start of the loop body
 *  - `exit` should be wired to whatever runs after the loop completes
 *
 * `maxIterations` is a HARD ceiling — even ai_judge mode is bounded to avoid
 * runaway loops when the AI keeps voting `continue`.
 */
export interface LoopModuleConfig {
  mode: 'fixed' | 'ai_judge';
  /** Total iterations (fixed mode) and hard safety cap (ai_judge mode). Required. */
  maxIterations: number;
  /** Variable prefix that exposes `<name>_iter` (0-based index) and `<name>_done` (boolean) to the workflow. */
  iterationVariable?: string;
  /** AI prompt for ai_judge mode. Should return "continue" or "stop". */
  prompt?: string;
}

export const LoopModuleConfigSchema = z.object({
  mode: z.enum(['fixed', 'ai_judge']),
  maxIterations: z.number().int().positive(),
  iterationVariable: z.string().optional(),
  prompt: z.string().optional(),
});

export const ExpressionOperatorSchema = z.enum([
  '===',
  '!==',
  '>',
  '<',
  '>=',
  '<=',
  'includes',
  'startsWith',
  'endsWith',
  'matches',
]);

export const SimpleExpressionSchema = z.object({
  left: z.string(),
  operator: ExpressionOperatorSchema,
  right: z.union([z.string(), z.number(), z.boolean()]),
});
