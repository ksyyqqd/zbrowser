import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import type { Skill, SkillCategory, ExecutionMode, SkillPackage, SkillResource, SkillAsset } from '@extension/skills';

/**
 * User-defined Skill Configuration (stored in extension storage)
 */
export interface UserSkillConfig {
  id: string;
  name: string;
  description: string;
  /**
   * 技能正文（Markdown）。通用文本格式的主体，执行时注入给 LLM。
   * 旧记录没有这个字段——读取时由 normalizeSkillConfig 从 steps 补出来。
   */
  instructions?: string;
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
      type: 'if' | 'switch' | 'while';
      expression: string;
      thenSteps?: unknown[];
      elseSteps?: unknown[];
      branches?: Array<{ name: string; steps: unknown[] }>;
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
 * Stored Skill Package (extends UserSkillConfig with package resources)
 */
export interface StoredSkillPackage extends UserSkillConfig {
  scripts?: SkillResource[];
  references?: SkillResource[];
  assets?: SkillAsset[];
  packageInfo?: {
    hasScripts: boolean;
    hasReferences: boolean;
    hasAssets: boolean;
    createdAt?: number;
    /** `ai_created` = 由 AI 在对话中通过 `skill_create` 生成，用于在设置页里标出来源。 */
    source?: 'zip' | 'markdown' | 'json' | 'recording' | 'ai_created';
  };
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
 * Import result for skill packages
 */
export interface PackageImportResult extends ImportResult {
  packages: StoredSkillPackage[];
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
  // SkillPackage methods
  addSkillPackage: (package_: SkillPackage) => Promise<void>;
  getSkillPackage: (id: string) => Promise<StoredSkillPackage | undefined>;
  getSkillAssets: (id: string) => Promise<SkillAsset[]>;
  importSkillPackages: (packages: SkillPackage[]) => Promise<PackageImportResult>;
  exportSkillPackages: (ids?: string[]) => Promise<StoredSkillPackage[]>;
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
  // 通用文本格式下 steps 可以为空——正文（instructions）才是主体。
  // 两者都空才算无内容。
  const hasInstructions = !!skill.instructions?.trim();
  const hasSteps = !!skill.steps?.length;
  if (!hasInstructions && !hasSteps) return 'Skill must have instructions or at least one step';
  return null;
}

/**
 * 读取时向后兼容：旧记录没有 instructions 字段，用 steps 现渲染一份正文。
 *
 * 不在写入时做一次性迁移，是因为 steps 对录制产物仍有用（workflow 转换要读它），
 * 就地覆盖会丢定位信息；这里只补出 instructions，steps 原样保留。
 */
function normalizeSkillConfig(skill: UserSkillConfig): UserSkillConfig {
  if (skill.instructions?.trim()) return skill;
  if (!skill.steps?.length) return skill;

  const lines: string[] = [];
  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i];
    lines.push(`${i + 1}. ${step.description?.trim() || step.action}`);
    const p = step.parameters ?? {};
    const detail: string[] = [];
    for (const key of ['url', 'selector', 'xpath', 'text'] as const) {
      const v = p[key];
      if (typeof v === 'string' && v) detail.push(`${key}=${v}`);
    }
    if (detail.length) lines.push(`   （${detail.join('，')}）`);
  }

  return { ...skill, instructions: lines.join('\n') };
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
    const skill = current.skills[id];
    return skill ? normalizeSkillConfig(skill) : undefined;
  },

  async getAllSkills() {
    const current = await storage.get();
    return Object.values(current.skills).map(normalizeSkillConfig);
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
      return Object.values(current.skills).map(normalizeSkillConfig);
    }

    return ids
      .map(id => current.skills[id])
      .filter((s): s is UserSkillConfig => s !== undefined)
      .map(normalizeSkillConfig);
  },

  // SkillPackage methods

  /**
   * Add a skill package with resources
   */
  async addSkillPackage(package_: SkillPackage) {
    const storedPackage = convertPackageToStored(package_);
    const error = validateSkillConfig(storedPackage);
    if (error) {
      throw new Error(error);
    }

    const current = await storage.get();
    await storage.set({
      skills: {
        ...current.skills,
        [storedPackage.id]: storedPackage,
      },
    });
  },

  /**
   * Get a skill package with all resources
   */
  async getSkillPackage(id: string) {
    const current = await storage.get();
    const skill = current.skills[id];
    if (!skill) return undefined;
    // Return as StoredSkillPackage (may or may not have resources)
    return normalizeSkillConfig(skill) as StoredSkillPackage;
  },

  /**
   * Get assets for a specific skill
   */
  async getSkillAssets(id: string) {
    const pkg = await this.getSkillPackage(id);
    return pkg?.assets ?? [];
  },

  /**
   * Import multiple skill packages
   */
  async importSkillPackages(packages: SkillPackage[]) {
    const result: PackageImportResult = {
      imported: 0,
      errors: [],
      importedIds: [],
      packages: [],
    };

    const current = await storage.get();
    const newSkills = { ...current.skills };

    for (const package_ of packages) {
      const storedPackage = convertPackageToStored(package_);
      const error = validateSkillConfig(storedPackage);
      if (error) {
        result.errors.push(`Skill ${storedPackage.id ?? 'unknown'}: ${error}`);
        continue;
      }

      newSkills[storedPackage.id] = storedPackage;
      result.imported++;
      result.importedIds.push(storedPackage.id);
      result.packages.push(storedPackage);
    }

    await storage.set({ skills: newSkills });
    return result;
  },

  /**
   * Export skill packages with resources
   */
  async exportSkillPackages(ids?: string[]) {
    const current = await storage.get();

    if (!ids) {
      return Object.values(current.skills).map(s => normalizeSkillConfig(s) as StoredSkillPackage);
    }

    return ids
      .map(id => current.skills[id])
      .filter((s): s is StoredSkillPackage => s !== undefined)
      .map(s => normalizeSkillConfig(s) as StoredSkillPackage);
  },
};

/**
 * Convert SkillPackage to StoredSkillPackage for storage
 */
function convertPackageToStored(package_: SkillPackage): StoredSkillPackage {
  const { skill, scripts, references, assets, packageInfo } = package_;

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    version: skill.version,
    category: skill.category,
    author: skill.author ?? 'Unknown',
    tags: skill.metadata?.tags ?? [],
    parameters: skill.parameters.map(p => ({
      name: p.name,
      type: p.type,
      description: p.description,
      required: p.required,
      default: p.default,
      enum: p.enum,
    })),
    steps: skill.steps.map(s => ({
      id: s.id,
      action: s.action,
      description: s.description,
      parameters: s.parameters,
      condition: s.condition,
      onError: s.onError ?? 'continue',
      retryCount: s.retryCount,
      delay: s.delay,
    })),
    executionMode: skill.executionMode ?? 'sequential',
    timeout: skill.timeout,
    createdAt: packageInfo?.createdAt ?? Date.now(),
    scripts,
    references,
    assets,
    packageInfo: packageInfo ?? {
      hasScripts: (scripts?.length ?? 0) > 0,
      hasReferences: (references?.length ?? 0) > 0,
      hasAssets: (assets?.length ?? 0) > 0,
      source: 'zip',
    },
  };
}
