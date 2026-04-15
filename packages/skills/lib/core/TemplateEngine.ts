import type { SkillStep, SkillAsset } from '../types';
import { parseTemplateVariables, hasTemplateVariables } from '../types/template';

/**
 * Template Engine - resolves template variables in skill parameters
 * Supports:
 * - {{variableName}} - regular parameter variables
 * - {{variableName.path}} - nested path access
 * - {{asset:filename}} - asset file content reference
 */
export class TemplateEngine {
  /**
   * Resolve templates in all steps with optional assets support
   */
  resolveTemplates(steps: SkillStep[], params: Record<string, unknown>, assets?: SkillAsset[]): SkillStep[] {
    return steps.map(step => {
      const resolvedParams = this.resolveObjectTemplates(step.parameters, params, assets) as Record<string, unknown>;
      return {
        ...step,
        parameters: resolvedParams,
        condition: step.condition
          ? {
              ...step.condition,
              expression: this.resolveStringTemplates(step.condition.expression, params, assets),
              thenSteps: step.condition.thenSteps
                ? this.resolveTemplates(step.condition.thenSteps, params, assets)
                : undefined,
              elseSteps: step.condition.elseSteps
                ? this.resolveTemplates(step.condition.elseSteps, params, assets)
                : undefined,
            }
          : undefined,
      };
    });
  }

  /**
   * Resolve templates in an object (recursive)
   */
  resolveObjectTemplates(
    obj: unknown,
    params: Record<string, unknown>,
    assets?: SkillAsset[],
  ): Record<string, unknown> | unknown {
    if (typeof obj === 'string') {
      return this.resolveStringTemplates(obj, params, assets);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveObjectTemplates(item, params, assets));
    }

    if (obj && typeof obj === 'object') {
      const resolved: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        resolved[key] = this.resolveObjectTemplates(value, params, assets) as unknown;
      }
      return resolved;
    }

    return obj;
  }

  /**
   * Resolve template variables in a string
   * Format: {{variableName}} or {{variableName.path}} or {{asset:filename}}
   */
  resolveStringTemplates(text: string, params: Record<string, unknown>, assets?: SkillAsset[]): string {
    // First resolve asset references: {{asset:filename}}
    let result = this.resolveAssetReferences(text, assets);

    if (!hasTemplateVariables(result)) {
      return result;
    }

    const variables = parseTemplateVariables(result);

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
   * Resolve asset references: {{asset:filename}}
   * Returns the content of the asset file with matching name
   */
  private resolveAssetReferences(text: string, assets?: SkillAsset[]): string {
    if (!assets || assets.length === 0) {
      return text;
    }

    // Match {{asset:filename}} pattern
    const assetPattern = /\{\{asset:([^}]+)\}\}/g;
    return text.replace(assetPattern, (match, filename) => {
      const asset = assets.find(a => a.name === filename || a.path.endsWith(filename));
      if (asset) {
        return asset.content;
      }
      // If asset not found, keep the placeholder unchanged
      return match;
    });
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
