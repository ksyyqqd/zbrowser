import type { Skill, SkillParameter } from '../types/skill';
import { SkillSchema } from '../types/skill';

/**
 * Skill Registry - manages skill storage and lookup
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  /**
   * Register a skill
   */
  registerSkill(skill: Skill): void {
    // Validate skill
    const validated = SkillSchema.parse(skill);
    this.skills.set(validated.id, validated);
  }

  /**
   * Unregister a skill
   */
  unregisterSkill(id: string): void {
    this.skills.delete(id);
  }

  /**
   * Get a skill by ID
   */
  getSkill(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * Check if a skill exists
   */
  hasSkill(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * Get all registered skills
   */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skills by category
   */
  getSkillsByCategory(category: string): Skill[] {
    return this.getAllSkills().filter(s => s.category === category);
  }

  /**
   * Search skills by name or description
   */
  searchSkills(query: string): Skill[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllSkills().filter(
      s =>
        s.name.toLowerCase().includes(lowerQuery) ||
        s.description.toLowerCase().includes(lowerQuery) ||
        s.tags.some(t => t.toLowerCase().includes(lowerQuery)),
    );
  }

  /**
   * Validate skill parameters
   */
  validateParameters(skill: Skill, params: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const param of skill.parameters) {
      const value = params[param.name];

      // Check required
      if (param.required && (value === undefined || value === null)) {
        errors.push(`Parameter '${param.name}' is required`);
        continue;
      }

      // Skip validation if value not provided and has default
      if (value === undefined && param.default !== undefined) {
        continue;
      }

      // Type validation
      if (value !== undefined && value !== null) {
        const typeError = validateType(param, value);
        if (typeError) {
          errors.push(typeError);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Clear all registered skills
   */
  clear(): void {
    this.skills.clear();
  }

  /**
   * Get count of registered skills
   */
  get count(): number {
    return this.skills.size;
  }
}

/**
 * Validate parameter type
 */
function validateType(param: SkillParameter, value: unknown): string | null {
  const actualType = getValueType(value);

  if (param.type !== actualType) {
    // Allow number for integer parameters
    if (param.type === 'number' && actualType === 'number') {
      // Type matches
    } else {
      return `Parameter '${param.name}' must be of type ${param.type}, got ${actualType}`;
    }
  }

  // Enum validation
  if (param.enum && !param.enum.includes(String(value))) {
    return `Parameter '${param.name}' must be one of: ${param.enum.join(', ')}`;
  }

  // Min/max validation for numbers
  if (param.type === 'number' && typeof value === 'number') {
    if (param.min !== undefined && value < param.min) {
      return `Parameter '${param.name}' must be at least ${param.min}`;
    }
    if (param.max !== undefined && value > param.max) {
      return `Parameter '${param.name}' must be at most ${param.max}`;
    }
  }

  return null;
}

/**
 * Get the type of a value
 */
function getValueType(value: unknown): string {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'unknown';
}
