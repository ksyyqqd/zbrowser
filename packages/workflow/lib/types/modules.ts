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
 * Evaluates conditions and routes to different branches
 */
export interface ConditionModuleConfig {
  conditionExpression: string; // Expression to evaluate
  trueNodeId: string; // Node ID for true branch
  falseNodeId: string; // Node ID for false branch
  evaluateWithAI: boolean; // true: AI evaluation, false: simple expression
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

export const ConditionModuleConfigSchema = z.object({
  conditionExpression: z.string().min(1),
  trueNodeId: z.string(),
  falseNodeId: z.string(),
  evaluateWithAI: z.boolean(),
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
