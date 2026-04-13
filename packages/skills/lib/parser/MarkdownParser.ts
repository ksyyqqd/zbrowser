import type { Skill, SkillParameter, SkillStep, SkillCategory } from '../types/skill';

const VALID_CATEGORIES: SkillCategory[] = [
  'navigation',
  'data-extraction',
  'form-interaction',
  'analysis',
  'automation',
  'custom',
];
const VALID_PARAM_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;

/**
 * Parse a Skill from Markdown format
 *
 * Expected Markdown format:
 * ```
 * # Skill Name
 *
 * Description of the skill.
 *
 * ## Category
 * navigation
 *
 * ## Parameters
 * - `name` (type, required): Description
 * - `name2` (type): Description without required
 *
 * ## Steps
 * 1. action_name: Description | params: {"key": "value"} | onError: stop
 * 2. action_name: Description
 *
 * ## Execution Mode
 * atomic
 * ```
 */
export class MarkdownParser {
  /**
   * Parse a single skill from Markdown text
   */
  parse(markdown: string): Skill {
    const lines = markdown.split('\n');
    const skill: Partial<Skill> = {
      id: '',
      name: '',
      description: '',
      version: '1.0.0',
      category: 'custom',
      parameters: [],
      steps: [],
      executionMode: 'atomic',
    };

    let currentSection: string | null = null;
    let stepIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) {
        continue;
      }

      // Parse headings
      if (line.startsWith('# ')) {
        // Skill name
        skill.name = line.substring(2).trim();
        // Generate ID from name if not set
        if (!skill.id) {
          skill.id = this.generateId(skill.name);
        }
      } else if (line.startsWith('## ')) {
        // Section header
        currentSection = line.substring(3).trim().toLowerCase();
      } else if (line.startsWith('### ')) {
        // Subsection - ignore for now
        currentSection = null;
      } else {
        // Parse content based on current section
        switch (currentSection) {
          case 'description':
            if (skill.description) {
              skill.description += '\n' + line;
            } else {
              skill.description = line;
            }
            break;

          case 'id':
            skill.id = line;
            break;

          case 'version':
            skill.version = line;
            break;

          case 'category':
            const categoryValue = line.toLowerCase();
            skill.category = VALID_CATEGORIES.includes(categoryValue as SkillCategory)
              ? (categoryValue as SkillCategory)
              : 'custom';
            break;

          case 'parameters':
            if (line.startsWith('- ') || line.startsWith('* ')) {
              const param = this.parseParameterLine(line);
              if (param) {
                skill.parameters!.push(param);
              }
            }
            break;

          case 'steps':
            if (line.match(/^\d+\./)) {
              const step = this.parseStepLine(line, stepIndex);
              if (step) {
                skill.steps!.push(step);
                stepIndex++;
              }
            }
            break;

          case 'execution mode':
            if (line === 'atomic' || line === 'expanded') {
              skill.executionMode = line;
            }
            break;
        }
      }
    }

    // Validate required fields
    if (!skill.name) {
      throw new Error('Skill name is required');
    }
    if (!skill.description) {
      skill.description = skill.name;
    }

    return skill as Skill;
  }

  /**
   * Parse multiple skills from a Markdown document
   * Skills are separated by `---` horizontal rules
   */
  parseMultiple(markdown: string): Skill[] {
    const sections = markdown.split(/^---\s*$/m);
    const skills: Skill[] = [];

    for (const section of sections) {
      const trimmed = section.trim();
      if (trimmed && trimmed.startsWith('#')) {
        try {
          const skill = this.parse(trimmed);
          skills.push(skill);
        } catch (error) {
          console.warn('Failed to parse skill:', error);
        }
      }
    }

    return skills;
  }

  /**
   * Parse a parameter line
   * Format: `- `name` (type, required): description`
   */
  private parseParameterLine(line: string): SkillParameter | null {
    // Remove bullet prefix
    const content = line.replace(/^[-*]\s*/, '');

    // Parse format: `name` (type, required): description
    const nameMatch = content.match(/^`([^`]+)`/);
    if (!nameMatch) {
      return null;
    }

    const name = nameMatch[1];
    const rest = content.substring(nameMatch[0].length).trim();

    // Parse type and required
    let type: 'string' | 'number' | 'boolean' | 'object' | 'array' = 'string';
    let required = false;
    let description = '';

    const typeMatch = rest.match(/^\(([^)]+)\)/);
    if (typeMatch) {
      const typeContent = typeMatch[1];
      const parts = typeContent.split(',').map(p => p.trim());
      const rawType = parts[0] || 'string';
      type = VALID_PARAM_TYPES.includes(rawType as (typeof VALID_PARAM_TYPES)[number])
        ? (rawType as (typeof VALID_PARAM_TYPES)[number])
        : 'string';
      required = parts.includes('required');
      description = rest.substring(typeMatch[0].length).trim();
    } else {
      description = rest;
    }

    // Remove leading colon from description if present
    if (description.startsWith(':')) {
      description = description.substring(1).trim();
    }

    return {
      name,
      type,
      description,
      required,
    };
  }

  /**
   * Parse a step line
   * Format: `1. action_name: Description | params: {"key": "value"} | onError: stop`
   */
  private parseStepLine(line: string, index: number): SkillStep | null {
    // Remove step number prefix
    const content = line.replace(/^\d+\.\s*/, '');

    // Split by | to get action, description, params, onError
    const parts = content.split('|').map(p => p.trim());

    // Parse action (first part)
    const firstPart = parts[0];
    const colonIndex = firstPart.indexOf(':');
    let action: string;
    let description: string;

    if (colonIndex > 0) {
      action = firstPart.substring(0, colonIndex).trim();
      description = firstPart.substring(colonIndex + 1).trim();
    } else {
      action = firstPart.trim();
      description = '';
    }

    // Parse additional parts
    let parameters: Record<string, unknown> = {};
    let onError: 'stop' | 'continue' | 'retry' = 'stop';

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('params:') || part.startsWith('parameters:')) {
        const paramsStr = part.replace(/^params?:/, '').trim();
        try {
          parameters = JSON.parse(paramsStr);
        } catch {
          // Try parsing simple key=value format
          const kvMatch = paramsStr.match(/^(\w+)=(.+)$/);
          if (kvMatch) {
            parameters = { [kvMatch[1]]: kvMatch[2] };
          }
        }
      } else if (part.startsWith('onError:') || part.startsWith('onerror:')) {
        const errorValue = part
          .replace(/^onError:/i, '')
          .trim()
          .toLowerCase();
        if (errorValue === 'continue' || errorValue === 'retry') {
          onError = errorValue;
        }
      }
    }

    return {
      id: `step-${index + 1}`,
      action,
      description,
      parameters,
      onError,
    };
  }

  /**
   * Generate a skill ID from name
   */
  private generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }

  /**
   * Convert a Skill to Markdown format
   */
  toMarkdown(skill: Skill): string {
    const lines: string[] = [];

    // Name
    lines.push(`# ${skill.name}`);
    lines.push('');

    // ID (optional, in a separate section)
    if (skill.id) {
      lines.push('## ID');
      lines.push(skill.id);
      lines.push('');
    }

    // Version (optional)
    if (skill.version) {
      lines.push('## Version');
      lines.push(skill.version);
      lines.push('');
    }

    // Description
    lines.push('## Description');
    lines.push(skill.description);
    lines.push('');

    // Category
    lines.push('## Category');
    lines.push(skill.category);
    lines.push('');

    // Parameters
    if (skill.parameters.length > 0) {
      lines.push('## Parameters');
      for (const param of skill.parameters) {
        const typeStr = param.required ? `${param.type}, required` : param.type;
        lines.push(`- \`${param.name}\` (${typeStr}): ${param.description}`);
      }
      lines.push('');
    }

    // Steps
    if (skill.steps.length > 0) {
      lines.push('## Steps');
      for (let i = 0; i < skill.steps.length; i++) {
        const step = skill.steps[i];
        const parts: string[] = [];

        // Action and description
        if (step.description) {
          parts.push(`${step.action}: ${step.description}`);
        } else {
          parts.push(step.action);
        }

        // Parameters
        if (Object.keys(step.parameters).length > 0) {
          parts.push(`params: ${JSON.stringify(step.parameters)}`);
        }

        // onError
        parts.push(`onError: ${step.onError}`);

        lines.push(`${i + 1}. ${parts.join(' | ')}`);
      }
      lines.push('');
    }

    // Execution Mode
    lines.push('## Execution Mode');
    lines.push(skill.executionMode);

    return lines.join('\n');
  }

  /**
   * Convert multiple skills to Markdown
   */
  toMarkdownMultiple(skills: Skill[]): string {
    return skills.map(skill => this.toMarkdown(skill)).join('\n\n---\n\n');
  }
}
