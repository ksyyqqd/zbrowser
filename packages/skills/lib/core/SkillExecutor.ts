import type { Skill, SkillStep, ExecutionMode } from '../types/skill';
import type {
  SkillExecutionResult,
  StepResult,
  ExecutionOptions,
  ExecutionContext,
  ActionResult,
} from '../types/execution';
import { TemplateEngine } from './TemplateEngine';
import { SkillRegistry } from './SkillRegistry';

/**
 * Skill Executor - executes skill steps
 */
export class SkillExecutor {
  private registry: SkillRegistry;
  private templateEngine: TemplateEngine;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
    this.templateEngine = new TemplateEngine();
  }

  /**
   * Execute a skill with parameters
   */
  async execute(
    skillId: string,
    params: Record<string, unknown>,
    context: ExecutionContext,
    options?: ExecutionOptions,
  ): Promise<SkillExecutionResult> {
    const skill = this.registry.getSkill(skillId);
    if (!skill) {
      return {
        success: false,
        output: null,
        steps: [],
        error: `Skill not found: ${skillId}`,
        executionMode: options?.executionMode ?? 'atomic',
      };
    }

    // Validate parameters
    const validation = this.registry.validateParameters(skill, params);
    if (!validation.valid) {
      return {
        success: false,
        output: null,
        steps: [],
        error: `Invalid parameters: ${validation.errors.join(', ')}`,
        executionMode: options?.executionMode ?? 'atomic',
      };
    }

    // Merge defaults into parameters
    const finalParams = this.mergeDefaults(skill, params);

    // Determine execution mode
    const executionMode = this.determineExecutionMode(skill, options);

    // Resolve templates in steps
    const resolvedSteps = this.templateEngine.resolveTemplates(skill.steps, finalParams);

    // Execute steps
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    const stepOutputs: Record<string, unknown> = {};

    try {
      for (let i = 0; i < resolvedSteps.length; i++) {
        const step = resolvedSteps[i];

        // Notify step start (for expanded mode)
        if (executionMode === 'expanded') {
          options?.onStepStart?.(step, i);
          context.emitEvent?.('skill', 'step_start', step.description ?? step.action);
        }

        const result = await this.executeStep(step, context, stepOutputs, options, i);
        stepResults.push(result);

        // Store step output for template resolution
        if (result.success && result.result !== undefined) {
          stepOutputs[step.id] = result.result;
        }

        // Notify step complete (for expanded mode)
        if (executionMode === 'expanded') {
          options?.onStepComplete?.(step, result, i);
          context.emitEvent?.('skill', result.success ? 'step_ok' : 'step_fail', step.id);
        }

        // Handle error
        if (!result.success) {
          if (step.onError === 'stop') {
            return {
              success: false,
              output: stepOutputs,
              steps: stepResults,
              error: result.error,
              totalDuration: Date.now() - startTime,
              executionMode,
            };
          }
          // Continue or retry handled in executeStep
        }

        // Apply delay if specified
        if (step.delay && step.delay > 0) {
          await new Promise(resolve => setTimeout(resolve, step.delay));
        }
      }

      return {
        success: true,
        output: stepOutputs,
        steps: stepResults,
        totalDuration: Date.now() - startTime,
        executionMode,
      };
    } catch (error) {
      return {
        success: false,
        output: stepOutputs,
        steps: stepResults,
        error: error instanceof Error ? error.message : 'Execution failed',
        totalDuration: Date.now() - startTime,
        executionMode,
      };
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: SkillStep,
    context: ExecutionContext,
    stepOutputs: Record<string, unknown>,
    options?: ExecutionOptions,
    index?: number,
  ): Promise<StepResult> {
    const startTime = Date.now();
    let retries = 0;
    const maxRetries = step.onError === 'retry' ? (step.retryCount ?? 3) : 0;

    while (retries <= maxRetries) {
      try {
        // Re-resolve templates with latest step outputs
        const resolvedParams = this.templateEngine.resolveObjectTemplates(step.parameters, stepOutputs) as Record<
          string,
          unknown
        >;

        // Execute the action
        const result = await context.executeAction(step.action, resolvedParams);

        return {
          step,
          success: result.success ?? true,
          result: result.extractedContent ?? result,
          error: result.error ?? undefined,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        retries++;

        if (retries > maxRetries) {
          options?.onError?.(step, error instanceof Error ? error : new Error('Unknown error'), index ?? 0);

          return {
            step,
            success: false,
            error: error instanceof Error ? error.message : 'Step execution failed',
            duration: Date.now() - startTime,
          };
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Should not reach here
    return {
      step,
      success: false,
      error: 'Max retries exceeded',
      duration: Date.now() - startTime,
    };
  }

  /**
   * Merge parameter defaults
   */
  private mergeDefaults(skill: Skill, params: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...params };

    for (const param of skill.parameters) {
      if (merged[param.name] === undefined && param.default !== undefined) {
        merged[param.name] = param.default;
      }
    }

    return merged;
  }

  /**
   * Determine execution mode
   */
  private determineExecutionMode(skill: Skill, options?: ExecutionOptions): ExecutionMode {
    // Use explicit option if provided
    if (options?.executionMode) {
      // Validate compatibility
      if (skill.executionMode === 'atomic' && options.executionMode === 'expanded') {
        return 'atomic'; // Skill doesn't support expanded
      }
      if (skill.executionMode === 'expanded' && options.executionMode === 'atomic') {
        return 'expanded'; // Skill doesn't support atomic
      }
      return options.executionMode;
    }

    // Default to skill's preferred mode
    if (skill.executionMode === 'both') {
      return 'atomic'; // Default to atomic for 'both'
    }
    return skill.executionMode;
  }
}
