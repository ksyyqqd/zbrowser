import JSZip from 'jszip';
import { MarkdownParser } from './MarkdownParser';
import type { SkillPackage, SkillResource, SkillAsset } from '../types/skillPackage';

/**
 * Parser for Skill packages with directory structure
 *
 * Supports:
 * - ZIP file import (with SKILL.md + scripts/references/assets directories)
 * - Markdown file import (backward compatible)
 * - ZIP file export
 */
export class SkillPackageParser {
  private markdownParser: MarkdownParser;

  constructor() {
    this.markdownParser = new MarkdownParser();
  }

  /**
   * Parse a skill package from a ZIP file
   * Expected structure:
   * - SKILL.md (required)
   * - scripts/ (optional)
   * - references/ (optional)
   * - assets/ (optional)
   */
  async parseFromZip(zipBlob: Blob): Promise<SkillPackage> {
    const zip = await JSZip.loadAsync(zipBlob);

    // Find and parse SKILL.md
    const skillMdFile = zip.file('SKILL.md');
    if (!skillMdFile) {
      throw new Error('SKILL.md file is required in the skill package');
    }

    const skillMdContent = await skillMdFile.async('string');
    const skill = this.markdownParser.parse(skillMdContent);

    // Parse scripts directory
    const scripts: SkillResource[] = [];
    const scriptsFolder = zip.folder('scripts');
    if (scriptsFolder) {
      await this.parseDirectoryResources(scriptsFolder, scripts, 'scripts/');
    }

    // Parse references directory
    const references: SkillResource[] = [];
    const referencesFolder = zip.folder('references');
    if (referencesFolder) {
      await this.parseDirectoryResources(referencesFolder, references, 'references/');
    }

    // Parse assets directory
    const assets: SkillAsset[] = [];
    const assetsFolder = zip.folder('assets');
    if (assetsFolder) {
      await this.parseDirectoryAssets(assetsFolder, assets, 'assets/');
    }

    return {
      skill,
      scripts: scripts.length > 0 ? scripts : undefined,
      references: references.length > 0 ? references : undefined,
      assets: assets.length > 0 ? assets : undefined,
      packageInfo: {
        hasScripts: scripts.length > 0,
        hasReferences: references.length > 0,
        hasAssets: assets.length > 0,
        createdAt: Date.now(),
        source: 'zip',
      },
    };
  }

  /**
   * Parse multiple skill packages from a ZIP file
   * Each skill should be in its own subdirectory
   */
  async parseMultipleFromZip(zipBlob: Blob): Promise<SkillPackage[]> {
    const zip = await JSZip.loadAsync(zipBlob);
    const packages: SkillPackage[] = [];

    // Check if root has SKILL.md (single skill package)
    const rootSkillMd = zip.file('SKILL.md');
    if (rootSkillMd) {
      const pkg = await this.parseFromZip(zipBlob);
      packages.push(pkg);
      return packages;
    }

    // Check for multiple skills in subdirectories
    const skillDirs: string[] = [];
    zip.forEach((relativePath: string) => {
      // Check if path is a directory with SKILL.md
      if (relativePath.includes('SKILL.md')) {
        const dirPath = relativePath.split('/').slice(0, -1).join('/');
        if (dirPath && !skillDirs.includes(dirPath)) {
          skillDirs.push(dirPath);
        }
      }
    });

    // Parse each skill directory
    for (const dirPath of skillDirs) {
      const skillFolder = zip.folder(dirPath);
      if (skillFolder) {
        const skillMdFile = skillFolder.file('SKILL.md');
        if (skillMdFile) {
          const skillMdContent = await skillMdFile.async('string');
          const skill = this.markdownParser.parse(skillMdContent);

          // Parse resources for this skill
          const scripts: SkillResource[] = [];
          const scriptsFolder = skillFolder.folder('scripts');
          if (scriptsFolder) {
            await this.parseDirectoryResources(scriptsFolder, scripts, `${dirPath}/scripts/`);
          }

          const references: SkillResource[] = [];
          const referencesFolder = skillFolder.folder('references');
          if (referencesFolder) {
            await this.parseDirectoryResources(referencesFolder, references, `${dirPath}/references/`);
          }

          const assets: SkillAsset[] = [];
          const assetsFolder = skillFolder.folder('assets');
          if (assetsFolder) {
            await this.parseDirectoryAssets(assetsFolder, assets, `${dirPath}/assets/`);
          }

          packages.push({
            skill,
            scripts: scripts.length > 0 ? scripts : undefined,
            references: references.length > 0 ? references : undefined,
            assets: assets.length > 0 ? assets : undefined,
            packageInfo: {
              hasScripts: scripts.length > 0,
              hasReferences: references.length > 0,
              hasAssets: assets.length > 0,
              createdAt: Date.now(),
              source: 'zip',
            },
          });
        }
      }
    }

    return packages;
  }

  /**
   * Parse from Markdown text (backward compatible)
   * Creates a minimal SkillPackage without resources
   */
  parseFromMarkdown(markdown: string): SkillPackage {
    const skill = this.markdownParser.parse(markdown);
    return {
      skill,
      packageInfo: {
        hasScripts: false,
        hasReferences: false,
        hasAssets: false,
        createdAt: Date.now(),
        source: 'markdown',
      },
    };
  }

  /**
   * Parse multiple from Markdown (backward compatible)
   */
  parseMultipleFromMarkdown(markdown: string): SkillPackage[] {
    const skills = this.markdownParser.parseMultiple(markdown);
    return skills.map(skill => ({
      skill,
      packageInfo: {
        hasScripts: false,
        hasReferences: false,
        hasAssets: false,
        createdAt: Date.now(),
        source: 'markdown',
      },
    }));
  }

  /**
   * Export a SkillPackage to ZIP file
   */
  async toZip(package_: SkillPackage): Promise<Blob> {
    const zip = new JSZip();

    // Add SKILL.md
    const skillMd = this.markdownParser.toMarkdown(package_.skill);
    zip.file('SKILL.md', skillMd);

    // Add scripts directory
    if (package_.scripts && package_.scripts.length > 0) {
      const scriptsFolder = zip.folder('scripts');
      if (scriptsFolder) {
        for (const script of package_.scripts) {
          scriptsFolder.file(script.name, script.content);
        }
      }
    }

    // Add references directory
    if (package_.references && package_.references.length > 0) {
      const referencesFolder = zip.folder('references');
      if (referencesFolder) {
        for (const ref of package_.references) {
          referencesFolder.file(ref.name, ref.content);
        }
      }
    }

    // Add assets directory
    if (package_.assets && package_.assets.length > 0) {
      const assetsFolder = zip.folder('assets');
      if (assetsFolder) {
        for (const asset of package_.assets) {
          assetsFolder.file(asset.name, asset.content);
        }
      }
    }

    return zip.generateAsync({ type: 'blob' });
  }

  /**
   * Export multiple SkillPackages to ZIP file
   * Each skill is placed in its own subdirectory
   */
  async toZipMultiple(packages: SkillPackage[]): Promise<Blob> {
    const zip = new JSZip();

    for (const package_ of packages) {
      // Create a folder for each skill using its ID or name
      const folderName = package_.skill.id || this.sanitizeName(package_.skill.name);
      const skillFolder = zip.folder(folderName);
      if (skillFolder) {
        // Add SKILL.md
        const skillMd = this.markdownParser.toMarkdown(package_.skill);
        skillFolder.file('SKILL.md', skillMd);

        // Add scripts
        if (package_.scripts && package_.scripts.length > 0) {
          const scriptsFolder = skillFolder.folder('scripts');
          if (scriptsFolder) {
            for (const script of package_.scripts) {
              scriptsFolder.file(script.name, script.content);
            }
          }
        }

        // Add references
        if (package_.references && package_.references.length > 0) {
          const referencesFolder = skillFolder.folder('references');
          if (referencesFolder) {
            for (const ref of package_.references) {
              referencesFolder.file(ref.name, ref.content);
            }
          }
        }

        // Add assets
        if (package_.assets && package_.assets.length > 0) {
          const assetsFolder = skillFolder.folder('assets');
          if (assetsFolder) {
            for (const asset of package_.assets) {
              assetsFolder.file(asset.name, asset.content);
            }
          }
        }
      }
    }

    return zip.generateAsync({ type: 'blob' });
  }

  /**
   * Parse resources from a directory
   */
  private async parseDirectoryResources(folder: JSZip, resources: SkillResource[], basePath: string): Promise<void> {
    const filePromises: Promise<void>[] = [];

    folder.forEach((relativePath: string) => {
      const file = folder.file(relativePath);
      if (file && !relativePath.endsWith('/')) {
        filePromises.push(
          file.async('string').then((content: string) => {
            const name = relativePath.split('/').pop() || relativePath;
            const type = this.getFileExtension(name);
            resources.push({
              name,
              content,
              type,
              path: basePath + relativePath,
            });
          }),
        );
      }
    });

    await Promise.all(filePromises);
  }

  /**
   * Parse assets from a directory
   */
  private async parseDirectoryAssets(folder: JSZip, assets: SkillAsset[], basePath: string): Promise<void> {
    const filePromises: Promise<void>[] = [];

    folder.forEach((relativePath: string) => {
      const file = folder.file(relativePath);
      if (file && !relativePath.endsWith('/')) {
        const name = relativePath.split('/').pop() || relativePath;
        const ext = this.getFileExtension(name);

        filePromises.push(
          file.async('string').then((content: string) => {
            const assetType = this.getAssetType(ext);
            assets.push({
              name,
              content,
              type: assetType,
              path: basePath + relativePath,
            });
          }),
        );
      }
    });

    await Promise.all(filePromises);
  }

  /**
   * Get file extension
   */
  private getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
  }

  /**
   * Determine asset type from extension
   */
  private getAssetType(ext: string): 'template' | 'config' | 'image' | 'other' {
    const templateExtensions = ['txt', 'md', 'html', 'template'];
    const configExtensions = ['json', 'yaml', 'yml', 'toml', 'ini', 'env'];
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];

    if (templateExtensions.includes(ext)) return 'template';
    if (configExtensions.includes(ext)) return 'config';
    if (imageExtensions.includes(ext)) return 'image';
    return 'other';
  }

  /**
   * Sanitize name for folder creation
   */
  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }
}
