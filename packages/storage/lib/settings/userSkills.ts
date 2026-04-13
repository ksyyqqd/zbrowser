import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import type { Skill, SkillCategory, ExecutionMode } from '@extension/skills';

/**
 * User-defined Skill Configuration (stored in extension storage)
 */
export interface UserSkillConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  category: SkillCategory;
  author: string;
  tags: string[];
  parameters: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    required: boolean;
    default?: unknown;
    enum?: string[];
  }>;
  steps: Array<{
    id: string;
    action: string;
    description?: string;
    parameters: Record<string, unknown>;
    condition?: {
      type: 'if' | 'while';
      expression: string;
      thenSteps?: unknown[];
      elseSteps?: unknown[];
    };
    onError: 'continue' | 'stop' | 'retry';
    retryCount?: number;
    delay?: number;
  }>;
  executionMode: ExecutionMode;
  timeout?: number;
  createdAt: number;
  updatedAt?: number;
}

/**
 * User Skills storage record
 */
export interface UserSkillsRecord {
  skills: Record<string, UserSkillConfig>;
}

/**
 * Import result
 */
export interface ImportResult {
  imported: number;
  errors: string[];
  importedIds: string[];
}

/**
 * User Skills Storage type with extended methods
 */
export type UserSkillsStorage = BaseStorage<UserSkillsRecord> & {
  addSkill: (skill: UserSkillConfig) => Promise<void>;
  updateSkill: (id: string, updates: Partial<UserSkillConfig>) => Promise<void>;
  removeSkill: (id: string) => Promise<void>;
  getSkill: (id: string) => Promise<UserSkillConfig | undefined>;
  getAllSkills: () => Promise<UserSkillConfig[]>;
  importSkills: (skills: UserSkillConfig[]) => Promise<ImportResult>;
  exportSkills: (ids?: string[]) => Promise<UserSkillConfig[]>;
};

// Storage key
const STORAGE_KEY = 'user-skills';

// Create base storage
const storage = createStorage<UserSkillsRecord>(
  STORAGE_KEY,
  { skills: {} },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

/**
 * Validate a skill config
 */
function validateSkillConfig(skill: UserSkillConfig): string | null {
  if (!skill.id) return 'Skill ID is required';
  if (!skill.name) return 'Skill name is required';
  if (!skill.description) return 'Skill description is required';
  if (!skill.steps || skill.steps.length === 0) return 'Skill must have at least one step';
  return null;
}

/**
 * User Skills Store
 */
export const userSkillsStore: UserSkillsStorage = {
  ...storage,

  async addSkill(skill: UserSkillConfig) {
    const error = validateSkillConfig(skill);
    if (error) {
      throw new Error(error);
    }

    const skillConfig: UserSkillConfig = {
      ...skill,
      createdAt: skill.createdAt ?? Date.now(),
    };

    const current = await storage.get();
    await storage.set({
      skills: {
        ...current.skills,
        [skillConfig.id]: skillConfig,
      },
    });
  },

  async updateSkill(id: string, updates: Partial<UserSkillConfig>) {
    const current = await storage.get();
    const existing = current.skills[id];

    if (!existing) {
      throw new Error(`Skill not found: ${id}`);
    }

    const updated: UserSkillConfig = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    // Validate updated skill
    const error = validateSkillConfig(updated);
    if (error) {
      throw new Error(error);
    }

    await storage.set({
      skills: {
        ...current.skills,
        [id]: updated,
      },
    });
  },

  async removeSkill(id: string) {
    const current = await storage.get();
    const { [id]: removed, ...rest } = current.skills;
    await storage.set({ skills: rest });
  },

  async getSkill(id: string) {
    const current = await storage.get();
    return current.skills[id];
  },

  async getAllSkills() {
    const current = await storage.get();
    return Object.values(current.skills);
  },

  async importSkills(skills: UserSkillConfig[]) {
    const result: ImportResult = {
      imported: 0,
      errors: [],
      importedIds: [],
    };

    const current = await storage.get();
    const newSkills = { ...current.skills };

    for (const skill of skills) {
      const error = validateSkillConfig(skill);
      if (error) {
        result.errors.push(`Skill ${skill.id ?? 'unknown'}: ${error}`);
        continue;
      }

      newSkills[skill.id] = {
        ...skill,
        createdAt: skill.createdAt ?? Date.now(),
      };

      result.imported++;
      result.importedIds.push(skill.id);
    }

    await storage.set({ skills: newSkills });
    return result;
  },

  async exportSkills(ids?: string[]) {
    const current = await storage.get();

    if (!ids) {
      return Object.values(current.skills);
    }

    return ids.map(id => current.skills[id]).filter((s): s is UserSkillConfig => s !== undefined);
  },
};
