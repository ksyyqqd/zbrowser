import { z } from 'zod';

/**
 * Skill category
 */
export type SkillCategory =
  | 'navigation'
  | 'data-extraction'
  | 'form-interaction'
  | 'analysis'
  | 'automation'
  | 'custom';

/**
 * Skill parameter definition
 */
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  min?: number;
  max?: number;
}

/**
 * Skill execution mode
 * - expanded: Each step emits events and is visible to LLM
 * - atomic: Skill is executed as single unit, only final result visible
 * - both: LLM can choose which mode to use
 */
export type ExecutionMode = 'expanded' | 'atomic' | 'both';

/**
 * Error handling strategy for a step
 */
export type ErrorHandling = 'continue' | 'stop' | 'retry';

/**
 * Skill step definition
 */
export interface SkillStep {
  id: string;
  action: string; // Action name to execute
  description?: string;
  parameters: Record<string, unknown>;
  condition?: StepCondition;
  onError: ErrorHandling;
  retryCount?: number;
  delay?: number; // Delay after step in milliseconds
}

/**
 * Step condition for conditional execution
 */
export interface StepCondition {
  type: 'if' | 'while';
  expression: string; // Expression to evaluate (e.g., "{{result.success}}")
  maxIterations?: number; // For while loops
  thenSteps?: SkillStep[];
  elseSteps?: SkillStep[];
}

/**
 * Skill definition
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  category: SkillCategory;
  author: string;
  tags: string[];
  parameters: SkillParameter[];
  steps: SkillStep[];
  executionMode: ExecutionMode;
  timeout?: number; // Default timeout in milliseconds
  metadata?: SkillMetadata;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Skill metadata
 */
export interface SkillMetadata {
  examples?: SkillExample[];
  documentation?: string;
  requirements?: string[];
}

/**
 * Skill usage example
 */
export interface SkillExample {
  description: string;
  parameters: Record<string, unknown>;
  expectedResult?: string;
}

/**
 * Zod schema for Skill validation
 */
export const SkillParameterSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  description: z.string(),
  required: z.boolean(),
  default: z.unknown().optional(),
  enum: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const SkillStepSchema: z.ZodType<SkillStep> = z.object({
  id: z.string(),
  action: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.unknown()),
  condition: z
    .object({
      type: z.enum(['if', 'while']),
      expression: z.string(),
      maxIterations: z.number().optional(),
      thenSteps: z.array(z.lazy(() => SkillStepSchema)).optional(),
      elseSteps: z.array(z.lazy(() => SkillStepSchema)).optional(),
    })
    .optional(),
  onError: z.enum(['continue', 'stop', 'retry']),
  retryCount: z.number().optional(),
  delay: z.number().optional(),
});

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().default('1.0.0'),
  category: z.enum(['navigation', 'data-extraction', 'form-interaction', 'analysis', 'automation', 'custom']),
  author: z.string().default('unknown'),
  tags: z.array(z.string()).default([]),
  parameters: z.array(SkillParameterSchema).default([]),
  steps: z.array(SkillStepSchema).min(1),
  executionMode: z.enum(['expanded', 'atomic', 'both']).default('both'),
  timeout: z.number().optional(),
  metadata: z
    .object({
      examples: z
        .array(
          z.object({
            description: z.string(),
            parameters: z.record(z.unknown()),
            expectedResult: z.string().optional(),
          }),
        )
        .optional(),
      documentation: z.string().optional(),
      requirements: z.array(z.string()).optional(),
    })
    .optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

/**
 * Storage record for user skills
 */
export interface UserSkillsRecord {
  skills: Record<string, Skill>;
}
