import { z } from 'zod';
import type { ActionSchema } from './schemas';

/**
 * Skill Invoke Action Schema
 * Execute a predefined skill (task template)
 */
export const skillInvokeActionSchema: ActionSchema = {
  name: 'skill_invoke',
  description:
    'Invoke a predefined skill (task template) with parameters. Skills are pre-configured automation sequences that execute multiple actions in a structured way.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    skill_id: z.string().describe('The ID of the skill to invoke'),
    parameters: z.record(z.unknown()).describe('Parameters to pass to the skill'),
    execution_mode: z
      .enum(['expanded', 'atomic'])
      .optional()
      .default('atomic')
      .describe('Execution mode: expanded (each step visible) or atomic (single result)'),
  }),
};

/**
 * List Skills Action Schema
 */
export const skillListActionSchema: ActionSchema = {
  name: 'skill_list',
  description: 'List all available skills (built-in and user-defined). Use this to discover available skill templates.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    category: z.string().optional().describe('Optional: filter by skill category'),
  }),
};

/**
 * Get Skill Info Action Schema
 */
export const skillGetInfoActionSchema: ActionSchema = {
  name: 'skill_get_info',
  description: 'Get detailed information about a specific skill including parameters and steps',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    skill_id: z.string().describe('The ID of the skill to get info for'),
  }),
};

/**
 * 创建 skill。
 *
 * 与 `workflow_create` 的分工：skill 是**提示词模板**，正文就是给未来的自己读的
 * 自然语言指令，执行时仍由 AI 逐步判断，所以能适应页面变化；workflow 是固定图，
 * 步骤定死。需要现场判断的写成 skill，步骤稳定可重复的做成 workflow。
 *
 * 这里刻意只收 `name` / `description` / `parameters` / `instructions` 四项，正文是
 * 自由 Markdown 而不是结构化步骤数组 —— 让 LLM 把流程拆成机械可执行的动作序列是
 * 在浪费它的能力，而且拆错了就是坏数据。写成散文，执行时再由 AI 读懂。
 */
export const skillCreateActionSchema: ActionSchema = {
  name: 'skill_create',
  description: `Create a reusable skill (a prompt template) from what you just did or from the user's description. Use this when the user asks to remember a procedure that still needs judgement each time it runs — for a rigid, fixed sequence of browser actions prefer workflow_create instead.
Write \`instructions\` as plain numbered prose describing what to do, the way you would explain it to a colleague. Reference parameters as {{paramName}}. Do not invent a machine-readable action list.
Never modify or overwrite an existing skill with this action; it only ever adds a new one.`,
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    name: z.string().describe('Skill name, short and descriptive'),
    description: z.string().describe('One sentence on what this skill does and when to use it'),
    category: z
      .enum(['navigation', 'data-extraction', 'form-interaction', 'analysis', 'automation', 'custom'])
      .optional()
      .default('custom'),
    parameters: z
      .array(
        z.object({
          name: z.string().describe('Parameter name: letters, digits, underscore only; cannot start with a digit'),
          type: z.enum(['string', 'number', 'boolean']).default('string'),
          required: z.boolean().optional().default(true),
          description: z.string().describe('What this parameter is, so the caller knows what to pass'),
        }),
      )
      .optional()
      .default([])
      .describe('Inputs the skill needs, referenced in instructions as {{name}}'),
    instructions: z
      .string()
      .describe('The skill body: numbered natural-language steps. May interpolate {{parameters}}.'),
  }),
};
