import { SkillRegistry, SkillExecutor, type Skill, type SkillExecutionResult } from '@extension/skills';
import { userSkillsStore } from '@extension/storage';
import { createLogger } from '../../log';

const logger = createLogger('SkillsService');

/**
 * Skills Service - manages skill registry and execution
 */
export class SkillsService {
  private registry: SkillRegistry;
  private executor: SkillExecutor;
  private initialized: boolean = false;

  constructor() {
    this.registry = new SkillRegistry();
    this.executor = new SkillExecutor(this.registry);
  }

  /**
   * Initialize the skills service - load built-in and user skills
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing Skills service...');

    try {
      // Load built-in skills
      const { builtInSkills } = await import('@extension/skills');
      for (const skill of builtInSkills) {
        this.registry.registerSkill(skill);
      }
      logger.info(`Loaded ${builtInSkills.length} built-in skills`);

      // Load user skills
      const userSkills = await userSkillsStore.getAllSkills();
      for (const skill of userSkills) {
        this.registry.registerSkill(skill as Skill);
      }
      logger.info(`Loaded ${userSkills.length} user skills`);

      this.initialized = true;
      logger.info('Skills service initialized');
    } catch (error) {
      logger.error('Failed to initialize Skills service:', error);
    }
  }

  /**
   * Get skill registry
   */
  getRegistry(): SkillRegistry {
    return this.registry;
  }

  /**
   * Execute a skill
   */
  async executeSkill(
    skillId: string,
    params: Record<string, unknown>,
    executionMode?: string,
    context?: unknown,
  ): Promise<SkillExecutionResult> {
    const skill = this.registry.getSkill(skillId);
    if (!skill) {
      return {
        success: false,
        output: null,
        steps: [],
        error: `Skill not found: ${skillId}`,
        executionMode: (executionMode as 'expanded' | 'atomic') ?? 'atomic',
      };
    }

    // Note: Actual execution requires an ExecutionContext with action execution capability
    // This is a placeholder that returns an error if no context provided
    if (!context) {
      return {
        success: false,
        output: null,
        steps: [],
        error: 'No execution context provided',
        executionMode: (executionMode as 'expanded' | 'atomic') ?? 'atomic',
      };
    }

    return this.executor.execute(skillId, params, context as Parameters<typeof this.executor.execute>[2], {
      executionMode: executionMode as 'expanded' | 'atomic',
    });
  }

  /**
   * List all skills
   */
  listSkills(category?: string): Skill[] {
    if (category) {
      return this.registry.getSkillsByCategory(category);
    }
    return this.registry.getAllSkills();
  }

  /**
   * Get skill info
   */
  getSkillInfo(skillId: string): Skill | undefined {
    return this.registry.getSkill(skillId);
  }

  /**
   * Add a user skill
   */
  async addUserSkill(skill: Skill): Promise<void> {
    this.registry.registerSkill(skill);
    await userSkillsStore.addSkill(skill as Parameters<typeof userSkillsStore.addSkill>[0]);
  }

  /**
   * Remove a user skill
   */
  async removeUserSkill(skillId: string): Promise<void> {
    this.registry.unregisterSkill(skillId);
    await userSkillsStore.removeSkill(skillId);
  }

  /**
   * Import skills
   */
  async importSkills(skills: Skill[]): Promise<{ imported: number; errors: string[] }> {
    return userSkillsStore.importSkills(skills as Parameters<typeof userSkillsStore.importSkills>[0]);
  }

  /**
   * Search skills
   */
  searchSkills(query: string): Skill[] {
    return this.registry.searchSkills(query);
  }

  /**
   * Validate skill parameters
   */
  validateParameters(skillId: string, params: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const skill = this.registry.getSkill(skillId);
    if (!skill) {
      return { valid: false, errors: [`Skill not found: ${skillId}`] };
    }
    return this.registry.validateParameters(skill, params);
  }

  /**
   * Get executor instance
   */
  getExecutor(): SkillExecutor {
    return this.executor;
  }
}
