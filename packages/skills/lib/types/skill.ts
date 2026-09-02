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
  type: 'if' | 'switch' | 'while';
  expression: string; // Expression to evaluate (e.g., "{{result.success}}" or AI prompt)
  maxIterations?: number; // For while loops
  thenSteps?: SkillStep[];
  elseSteps?: SkillStep[];
  branches?: Array<{ name: string; steps: SkillStep[] }>; // For switch conditions
}

/**
 * Skill definition
 *
 * 通用格式（frontmatter + 正文）里 `instructions` 是主体：它是给 LLM 直接读的
 * 自然语言指令，不是可机械执行的动作序列。`steps` 只在「录制生成」和
 * 「workflow 互转」这两条结构化链路上有意义，纯文本编写的 skill 会是空数组。
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  /**
   * 技能正文（Markdown）。执行时原样注入到任务里让 LLM 遵循。
   * 纯文本编写的 skill 只有这一份内容，没有 steps。
   */
  instructions: string;
  version: string;
  category: SkillCategory;
  author: string;
  tags: string[];
  parameters: SkillParameter[];
  /**
   * 结构化步骤。仅录制产物与 workflow 转换使用；文本编写的 skill 为 []。
   * 不要假设它非空——旧代码里 `skill.steps.map(...)` 的地方都要能接受空数组。
   */
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
  tags?: string[];
  hasScripts?: boolean;
  hasReferences?: boolean;
  hasAssets?: boolean;
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
  instructions: z.string().default(''),
  version: z.string().default('1.0.0'),
  category: z
    .enum(['navigation', 'data-extraction', 'form-interaction', 'analysis', 'automation', 'custom'])
    .default('custom'),
  author: z.string().default('unknown'),
  tags: z.array(z.string()).default([]),
  parameters: z.array(SkillParameterSchema).default([]),
  // 通用格式下 steps 可以为空（正文即全部内容），所以这里不再 .min(1)
  steps: z.array(SkillStepSchema).default([]),
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
      tags: z.array(z.string()).optional(),
      hasScripts: z.boolean().optional(),
      hasReferences: z.boolean().optional(),
      hasAssets: z.boolean().optional(),
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
