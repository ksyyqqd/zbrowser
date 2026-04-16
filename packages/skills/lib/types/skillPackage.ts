import { z } from 'zod';
import type { Skill } from './skill';

/**
 * Skill resource file (scripts, references)
 */
export interface SkillResource {
  name: string;
  content: string;
  type: string; // File extension (e.g., 'js', 'md', 'txt')
  path: string; // Relative path within the skill package
}

/**
 * Skill asset file (templates, configs, etc.)
 */
export interface SkillAsset {
  name: string;
  content: string;
  type: 'template' | 'config' | 'image' | 'other';
  path: string;
}

/**
 * Complete skill package with resources
 */
export interface SkillPackage {
  skill: Skill;
  scripts?: SkillResource[];
  references?: SkillResource[];
  assets?: SkillAsset[];
  // Metadata about package structure
  packageInfo?: {
    hasScripts: boolean;
    hasReferences: boolean;
    hasAssets: boolean;
    createdAt?: number;
    source?: 'zip' | 'markdown' | 'json' | 'recording';
  };
}

/**
 * Zod schema for SkillResource
 */
export const SkillResourceSchema = z.object({
  name: z.string(),
  content: z.string(),
  type: z.string(),
  path: z.string(),
});

/**
 * Zod schema for SkillAsset
 */
export const SkillAssetSchema = z.object({
  name: z.string(),
  content: z.string(),
  type: z.enum(['template', 'config', 'image', 'other']),
  path: z.string(),
});

/**
 * Zod schema for SkillPackage
 */
export const SkillPackageSchema = z.object({
  skill: z.any(), // Skill schema is defined in skill.ts
  scripts: z.array(SkillResourceSchema).optional(),
  references: z.array(SkillResourceSchema).optional(),
  assets: z.array(SkillAssetSchema).optional(),
  packageInfo: z
    .object({
      hasScripts: z.boolean().default(false),
      hasReferences: z.boolean().default(false),
      hasAssets: z.boolean().default(false),
      createdAt: z.number().optional(),
      source: z.enum(['zip', 'markdown', 'json', 'recording']).optional(),
    })
    .optional(),
});

/**
 * Storage record for skill packages
 */
export interface SkillPackageRecord {
  packages: Record<string, SkillPackage>;
}
