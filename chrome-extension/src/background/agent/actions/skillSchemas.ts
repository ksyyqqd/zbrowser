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
