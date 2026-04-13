import type { SkillStep } from '../types/skill';
import { parseTemplateVariables, hasTemplateVariables } from '../types/template';

/**
 * Template Engine - resolves template variables in skill parameters
 */
export class TemplateEngine {
  /**
   * Resolve templates in all steps
   */
  resolveTemplates(steps: SkillStep[], params: Record<string, unknown>): SkillStep[] {
    return steps.map(step => {
      const resolvedParams = this.resolveObjectTemplates(step.parameters, params) as Record<string, unknown>;
      return {
        ...step,
        parameters: resolvedParams,
        condition: step.condition
          ? {
              ...step.condition,
              expression: this.resolveStringTemplates(step.condition.expression, params),
              thenSteps: step.condition.thenSteps ? this.resolveTemplates(step.condition.thenSteps, params) : undefined,
              elseSteps: step.condition.elseSteps ? this.resolveTemplates(step.condition.elseSteps, params) : undefined,
            }
          : undefined,
      };
    });
  }

  /**
   * Resolve templates in an object (recursive)
   */
  resolveObjectTemplates(obj: unknown, params: Record<string, unknown>): Record<string, unknown> | unknown {
    if (typeof obj === 'string') {
      return this.resolveStringTemplates(obj, params);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveObjectTemplates(item, params));
    }

    if (obj && typeof obj === 'object') {
      const resolved: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        resolved[key] = this.resolveObjectTemplates(value, params) as unknown;
      }
      return resolved;
    }

    return obj;
  }

  /**
   * Resolve template variables in a string
   * Format: {{variableName}} or {{variableName.path}}
   */
  resolveStringTemplates(text: string, params: Record<string, unknown>): string {
    if (!hasTemplateVariables(text)) {
      return text;
    }

    const variables = parseTemplateVariables(text);
    let result = text;

    for (const variable of variables) {
      const value = this.getVariableValue(params, variable.name, variable.path);
      const placeholder = variable.path ? `{{${variable.name}.${variable.path}}}` : `{{${variable.name}}}`;

      // Replace placeholder with value
      if (value !== undefined) {
        result = result.replace(placeholder, String(value));
      }
    }

    return result;
  }

  /**
   * Get variable value from params, supporting nested paths
   */
  private getVariableValue(params: Record<string, unknown>, name: string, path?: string): unknown {
    const baseValue = params[name];

    if (baseValue === undefined) {
      return undefined;
    }

    if (!path) {
      return baseValue;
    }

    // Navigate nested path
    const pathParts = path.split('.');
    let current: unknown = baseValue;

    for (const part of pathParts) {
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Build a parameter object from skill parameters
   */
  buildParameterMap(
    skillParams: Array<{ name: string; default?: unknown }>,
    providedParams: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const param of skillParams) {
      if (providedParams[param.name] !== undefined) {
        result[param.name] = providedParams[param.name];
      } else if (param.default !== undefined) {
        result[param.name] = param.default;
      }
    }

    return result;
  }
}
