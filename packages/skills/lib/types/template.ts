/**
 * Template variable in skill parameters
 * Format: {{variableName}}
 */
export interface TemplateVariable {
  name: string;
  path?: string; // For nested access: {{result.data.field}}
}

/**
 * Parse template variables from a string
 */
export function parseTemplateVariables(text: string): TemplateVariable[] {
  const regex = /\{\{(\w+(?:\.\w+)*)\}\}/g;
  const variables: TemplateVariable[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const fullPath = match[1];
    const parts = fullPath.split('.');
    variables.push({
      name: parts[0],
      path: parts.length > 1 ? parts.slice(1).join('.') : undefined,
    });
  }

  return variables;
}

/**
 * Check if a string contains template variables
 */
export function hasTemplateVariables(text: string): boolean {
  return /\{\{(\w+(?:\.\w+)*)\}\}/.test(text);
}
