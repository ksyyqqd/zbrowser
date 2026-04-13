import type { Skill, SkillStep, ExecutionMode } from './skill';

/**
 * Step execution result
 */
export interface StepResult {
  step: SkillStep;
  success: boolean;
  result?: unknown;
  error?: string;
  duration?: number; // Execution time in milliseconds
}

/**
 * Skill execution result
 */
export interface SkillExecutionResult {
  success: boolean;
  output: unknown;
  steps: StepResult[];
  error?: string;
  totalDuration?: number;
  executionMode: ExecutionMode;
}

/**
 * Execution options
 */
export interface ExecutionOptions {
  timeout?: number;
  executionMode?: ExecutionMode;
  onStepStart?: (step: SkillStep, index: number) => void;
  onStepComplete?: (step: SkillStep, result: StepResult, index: number) => void;
  onError?: (step: SkillStep, error: Error, index: number) => void;
}

/**
 * Execution context - provides access to action execution
 */
export interface ExecutionContext {
  // Execute an action with given parameters
  executeAction: (actionName: string, params: Record<string, unknown>) => Promise<ActionResult>;
  // Emit event to the agent context
  emitEvent?: (actor: string, state: string, details: string) => Promise<void>;
}

/**
 * Action result interface (compatible with Nanobrowser ActionResult)
 */
export interface ActionResult {
  isDone?: boolean;
  success?: boolean;
  extractedContent?: string | null;
  error?: string | null;
  includeInMemory?: boolean;
}

/**
 * Import result
 */
export interface ImportResult {
  imported: number;
  errors: string[];
  importedSkills: string[];
}
