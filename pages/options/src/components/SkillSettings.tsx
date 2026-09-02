import { useState, useEffect, useRef } from 'react';
import { Button } from '@extension/ui';
import { userSkillsStore, type StoredSkillPackage } from '@extension/storage';
import type { Skill, SkillPackage } from '@extension/skills';
import { MarkdownParser, SkillPackageParser } from '@extension/skills';
import JSZip from 'jszip';
import {
  FiCode,
  FiTrash2,
  FiDownload,
  FiUpload,
  FiInfo,
  FiFile,
  FiFolder,
  FiPackage,
  FiX,
  FiEdit2,
  FiSave,
  FiCheckSquare,
  FiSquare,
  FiType,
  FiPlus,
} from 'react-icons/fi';
import { t } from '@extension/i18n';

interface SkillSettingsProps {
  isDarkMode?: boolean;
}

export const SkillSettings = ({ isDarkMode = false }: SkillSettingsProps) => {
  const [userSkills, setUserSkills] = useState<StoredSkillPackage[]>([]);
  const [builtInSkills, setBuiltInSkills] = useState<Skill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<StoredSkillPackage | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importContent, setImportContent] = useState('');
  const [importFormat, setImportFormat] = useState<'markdown' | 'json' | 'zip'>('markdown');
  const [exportFormat, setExportFormat] = useState<'markdown' | 'json' | 'zip'>('markdown');
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string; type: string } | null>(null);

  // Editing states —— 只保留文本编辑。
  // 原先还有一套结构化 UI 编辑器（逐个字段编 parameters / steps），已移除：
  // steps 那套执行路径本来就没接通，通用格式下正文才是主体，两套编辑器并存
  // 只会让同一份数据有两个真相来源。
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');

  // 新建：复用同一套文本格式，只是初始内容是模板而非现有 skill
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createContent, setCreateContent] = useState('');

  // 改名：名字藏在 frontmatter 里，只想改个名却要看懂 YAML 门槛太高，单独开一个入口
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Export selection states
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editTextAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    // Load user skill packages from storage
    const packages = await userSkillsStore.exportSkillPackages();
    setUserSkills(packages);

    // Load built-in skills
    try {
      const { builtInSkills } = await import('@extension/skills');
      setBuiltInSkills(builtInSkills);
    } catch {
      console.warn('Failed to load built-in skills');
    }
  };

  const handleDeleteSkill = async (id: string) => {
    await userSkillsStore.removeSkill(id);
    await loadSkills();
  };

  const NEW_SKILL_TEMPLATE = `---
name: 新技能
description: 一句话说明这个技能做什么
category: custom
parameters:
  - name: keyword
    type: string
    required: true
    description: 要搜索的关键词
---

1. 打开 https://example.com
2. 把 {{keyword}} 填进搜索框并提交
3. 读出第一条结果并回复
`;

  const openCreateModal = () => {
    setCreateContent(NEW_SKILL_TEMPLATE);
    setIsCreateModalOpen(true);
  };

  const handleCreateSkill = async () => {
    try {
      const parser = new MarkdownParser();
      const parsed = parser.parse(createContent);

      // parse 出的 id 由名字 slug 化而来，同名会直接覆盖已有 skill（importSkillPackages
      // 是按 id 覆盖写入的）。新建语义上永远是"多一条"，所以撞了就换一个带后缀的 id。
      const existingIds = new Set(userSkills.map(s => s.id));
      let id = parsed.id;
      if (existingIds.has(id)) {
        id = `${parsed.id}-${Date.now().toString(36)}`;
      }

      const result = await userSkillsStore.importSkillPackages([
        {
          skill: { ...parsed, id },
          packageInfo: {
            hasScripts: false,
            hasReferences: false,
            hasAssets: false,
            createdAt: Date.now(),
            source: 'markdown',
          },
        },
      ]);

      if (result.errors.length > 0) {
        alert(`新建失败：\n${result.errors.join('\n')}`);
        return;
      }

      await loadSkills();
      setIsCreateModalOpen(false);
      setCreateContent('');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(`新建失败: ${errorMsg}`);
    }
  };

  const startRename = (skill: StoredSkillPackage) => {
    setRenamingId(skill.id);
    setRenameValue(skill.name);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    // 空名字过不了 validateSkillConfig，与其抛错不如当成取消
    if (!name) {
      setRenamingId(null);
      return;
    }

    try {
      // 只改 name，不动 id —— id 是 workflow 转换、skill_invoke 的引用键，
      // 跟着名字变会让已有引用全部失效。
      await userSkillsStore.updateSkill(renamingId, { name });
      await loadSkills();
      if (selectedSkill?.id === renamingId) {
        const updated = await userSkillsStore.getSkillPackage(renamingId);
        if (updated) setSelectedSkill(updated);
      }
    } catch (error) {
      alert(`改名失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRenamingId(null);
    }
  };

  const handleImportSkills = async () => {
    try {
      const parser = new MarkdownParser();
      let skillsArray: Skill[];

      if (importFormat === 'markdown') {
        // Parse Markdown format
        skillsArray = parser.parseMultiple(importContent);
      } else if (importFormat === 'json') {
        // JSON 直接反序列化，绕过了 parser，所以旧导出文件里可能没有 instructions。
        // 补一份（从 steps 渲染），否则导入后正文是空的、执行时啥也注入不到。
        const parsed = JSON.parse(importContent);
        const raw: Skill[] = Array.isArray(parsed) ? parsed : [parsed];
        skillsArray = raw.map(s =>
          s.instructions?.trim() ? s : { ...s, instructions: parser.parse(parser.toMarkdown(s)).instructions },
        );
      } else {
        // ZIP format is handled separately
        return;
      }

      if (skillsArray.length === 0) {
        alert('No skills found in the input');
        return;
      }

      // Convert Skill[] to SkillPackage[] format
      const packages: SkillPackage[] = skillsArray.map(skill => ({
        skill,
        packageInfo: {
          hasScripts: false,
          hasReferences: false,
          hasAssets: false,
          createdAt: Date.now(),
          source: importFormat === 'markdown' ? 'markdown' : 'json',
        },
      }));

      const result = await userSkillsStore.importSkillPackages(packages);

      if (result.errors.length > 0) {
        alert(`Import completed with errors:\n${result.errors.join('\n')}`);
      } else {
        alert(t('options_skills_importSuccess', [String(result.imported)]));
      }

      await loadSkills();
      setImportContent('');
      setIsImportModalOpen(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(t('options_skills_importError', [errorMsg]));
    }
  };

  const handleZipImport = async (file: File) => {
    try {
      const parser = new SkillPackageParser();
      const packages = await parser.parseMultipleFromZip(file);

      if (packages.length === 0) {
        alert(t('options_skills_importError', ['No skills found in ZIP']));
        return;
      }

      const result = await userSkillsStore.importSkillPackages(packages);

      if (result.errors.length > 0) {
        alert(t('options_skills_importError', [result.errors.join('\n')]));
      } else {
        alert(t('options_skills_importSuccess', [String(result.imported)]));
      }

      await loadSkills();
      setIsImportModalOpen(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(t('options_skills_importError', [errorMsg]));
    }
  };

  // Toggle selection for export
  const toggleExportSelection = (id: string) => {
    setSelectedForExport(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Select all for export
  const selectAllForExport = () => {
    setSelectedForExport(new Set(userSkills.map(s => s.id)));
  };

  // Deselect all for export
  const deselectAllForExport = () => {
    setSelectedForExport(new Set());
  };

  // Open export modal
  const openExportModal = () => {
    if (userSkills.length === 0) {
      alert('No custom skills to export');
      return;
    }
    // Select all by default
    setSelectedForExport(new Set(userSkills.map(s => s.id)));
    setIsExportModalOpen(true);
  };

  // Perform export with selected skills
  const performExport = async () => {
    if (selectedForExport.size === 0) {
      alert('请至少选择一个 Skill 导出');
      return;
    }

    // Get selected packages
    const selectedIds = Array.from(selectedForExport);
    const packages = await userSkillsStore.exportSkillPackages(selectedIds);

    if (packages.length === 0) {
      alert('No selected skills found');
      return;
    }

    try {
      const zip = new JSZip();
      const parser = new MarkdownParser();
      const packageParser = new SkillPackageParser();

      // Create a folder for the export
      const exportFolder = zip.folder('nanobrowser-skills');

      // Track used names to handle duplicates
      const usedNames = new Map<string, number>();

      for (const pkg of packages) {
        const skill = convertPackageToSkill(pkg);
        // Sanitize filename - keep Chinese and other valid characters
        // Only remove truly problematic characters for file systems
        let safeName = skill.name
          .replace(/[/\\:*?"<>|]/g, '_') // Remove invalid filesystem chars
          .replace(/\s+/g, '_') // Replace spaces with underscore
          .slice(0, 50);

        // Handle duplicate names - add suffix if name already exists
        if (usedNames.has(safeName)) {
          const count = usedNames.get(safeName)! + 1;
          usedNames.set(safeName, count);
          safeName = `${safeName}_${count}`;
        } else {
          usedNames.set(safeName, 1);
        }

        if (exportFormat === 'markdown') {
          // Each skill as a separate Markdown file
          const mdContent = parser.toMarkdown(skill);
          exportFolder?.file(`${safeName}.md`, mdContent);
        } else if (exportFormat === 'json') {
          // Each skill as a separate JSON file
          const jsonContent = JSON.stringify(skill, null, 2);
          exportFolder?.file(`${safeName}.json`, jsonContent);
        } else {
          // ZIP format: each skill as a separate folder with SKILL.md
          const skillFolder = exportFolder?.folder(safeName);
          const mdContent = parser.toMarkdown(skill);
          skillFolder?.file('SKILL.md', mdContent);

          // Add scripts/references/assets if exist
          if (pkg.scripts && pkg.scripts.length > 0) {
            const scriptsFolder = skillFolder?.folder('scripts');
            for (const script of pkg.scripts) {
              scriptsFolder?.file(script.name, script.content);
            }
          }
          if (pkg.references && pkg.references.length > 0) {
            const refsFolder = skillFolder?.folder('references');
            for (const ref of pkg.references) {
              refsFolder?.file(ref.name, ref.content);
            }
          }
          if (pkg.assets && pkg.assets.length > 0) {
            const assetsFolder = skillFolder?.folder('assets');
            for (const asset of pkg.assets) {
              assetsFolder?.file(asset.name, asset.content);
            }
          }
        }
      }

      // Generate and download ZIP
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nanobrowser-skills-${exportFormat}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      setIsExportModalOpen(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(`导出失败: ${errorMsg}`);
    }
  };

  const convertPackageToSkill = (pkg: StoredSkillPackage): Skill => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    instructions: pkg.instructions ?? '',
    version: pkg.version,
    category: pkg.category,
    author: pkg.author,
    tags: pkg.tags,
    parameters: pkg.parameters.map(p => ({
      name: p.name,
      type: p.type as 'string' | 'number' | 'boolean' | 'array' | 'object',
      description: p.description,
      required: p.required,
      default: p.default,
      enum: p.enum,
    })),
    steps: pkg.steps.map(s => ({
      id: s.id,
      action: s.action,
      description: s.description,
      parameters: s.parameters,
      condition: s.condition as import('@extension/skills').StepCondition | undefined,
      onError: s.onError,
      retryCount: s.retryCount,
      delay: s.delay,
    })),
    executionMode: pkg.executionMode,
    timeout: pkg.timeout,
  });

  const openSkillDetail = (skill: StoredSkillPackage) => {
    setSelectedSkill(skill);
    setIsDetailModalOpen(true);
    setIsEditing(false);
    setEditContent('');
  };

  // Start editing a skill（通用文本格式：frontmatter + 正文）
  const startEditing = () => {
    if (!selectedSkill) return;

    const parser = new MarkdownParser();
    const skillObj = convertPackageToSkill(selectedSkill);
    setEditContent(parser.toMarkdown(skillObj));
    setIsEditing(true);
  };

  // Cancel editing
  const cancelEditing = () => {
    setIsEditing(false);
    setEditContent('');
  };

  // Save edited skill
  const saveEditedSkill = async () => {
    if (!selectedSkill) return;

    try {
      const parser = new MarkdownParser();
      const parsedSkill = parser.parse(editContent);

      const skillUpdates: Partial<StoredSkillPackage> = {
        name: parsedSkill.name,
        description: parsedSkill.description,
        instructions: parsedSkill.instructions,
        version: parsedSkill.version || selectedSkill.version,
        category: parsedSkill.category,
        author: parsedSkill.author ?? selectedSkill.author,
        tags: parsedSkill.tags || [],
        parameters: parsedSkill.parameters.map(p => ({
          name: p.name,
          type: p.type as 'string' | 'number' | 'boolean' | 'array' | 'object',
          description: p.description,
          required: p.required,
          default: p.default,
          enum: p.enum,
        })),
        // 文本格式解析不出 steps。保留原有 steps —— 录制产物的精确 locator 在里面，
        // 用户只是改了正文措辞，不该把定位数据抹掉；workflow 转换也还要读它。
        steps: parsedSkill.steps.length > 0 ? parsedSkill.steps : selectedSkill.steps,
        executionMode: parsedSkill.executionMode ?? 'both',
        timeout: parsedSkill.timeout,
      };

      // Update the skill in storage
      await userSkillsStore.updateSkill(selectedSkill.id, skillUpdates);

      // Refresh skills list
      await loadSkills();

      // Update selected skill
      const updated = await userSkillsStore.getSkillPackage(selectedSkill.id);
      if (updated) {
        setSelectedSkill(updated);
      }

      setIsEditing(false);
      setEditContent('');
      alert(t('options_skills_saveSuccess') || 'Skill saved successfully');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(t('options_skills_saveError', [errorMsg]) || `Save failed: ${errorMsg}`);
    }
  };

  const convertBuiltInToPackage = (skill: Skill): StoredSkillPackage => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    category: skill.category,
    author: skill.author ?? 'Built-in',
    tags: skill.tags,
    parameters: skill.parameters.map(p => ({
      name: p.name,
      type: p.type as 'string' | 'number' | 'boolean' | 'array' | 'object',
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
    executionMode: skill.executionMode ?? 'both',
    timeout: skill.timeout,
    createdAt: Date.now(),
  });

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'navigation':
        return t('options_skills_categoryNavigation');
      case 'data-extraction':
        return t('options_skills_categoryDataExtraction');
      case 'form-interaction':
        return t('options_skills_categoryFormInteraction');
      case 'analysis':
        return t('options_skills_categoryAnalysis');
      case 'automation':
        return t('options_skills_categoryAutomation');
      case 'custom':
        return t('options_skills_categoryCustom');
      default:
        return category;
    }
  };

  const renderSkillCard = (skill: StoredSkillPackage, isBuiltIn: boolean = false) => (
    <div
      key={skill.id}
      className={`rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'} p-4`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {renamingId === skill.id ? (
              <input
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                autoFocus
                maxLength={60}
                className={`rounded border px-2 py-0.5 text-sm font-medium ${
                  isDarkMode ? 'border-slate-500 bg-slate-800 text-gray-200' : 'border-gray-300 bg-white text-gray-800'
                }`}
              />
            ) : (
              <h3 className={`font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{skill.name}</h3>
            )}
            {isBuiltIn ? (
              <span
                className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${isDarkMode ? 'bg-blue-900 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                {t('options_skills_builtin')}
              </span>
            ) : (
              <span
                className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${isDarkMode ? 'bg-purple-900 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
                {t('options_skills_custom')}
              </span>
            )}
            {/* Package info badges */}
            {!isBuiltIn && skill.packageInfo && (
              <>
                {skill.packageInfo.hasScripts && (
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs ${isDarkMode ? 'bg-amber-900/50 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>
                    <FiFile className="h-3 w-3 mr-1" />
                    {t('options_skills_scriptsSection')}
                  </span>
                )}
                {skill.packageInfo.hasAssets && (
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs ${isDarkMode ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-100 text-emerald-700'}`}>
                    <FiFolder className="h-3 w-3 mr-1" />
                    {t('options_skills_assetsSection')}
                  </span>
                )}
              </>
            )}
          </div>
          <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} mb-1`}>{skill.description}</p>
          <div className="flex items-center gap-2 text-xs">
            <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {t('options_skills_category')}: {getCategoryLabel(skill.category)}
            </span>
            <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {t('options_skills_steps')}: {skill.steps.length}
            </span>
            <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {t('options_skills_parameters')}: {skill.parameters.length}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => openSkillDetail(skill)}
            className={`p-2 rounded-md ${isDarkMode ? 'hover:bg-slate-600 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'}`}
            title={t('options_skills_viewDetails')}>
            <FiInfo className="h-4 w-4" />
          </button>
          {!isBuiltIn && (
            <button
              onClick={() => startRename(skill)}
              className={`p-2 rounded-md ${isDarkMode ? 'hover:bg-slate-600 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'}`}
              title="重命名">
              <FiType className="h-4 w-4" />
            </button>
          )}
          {!isBuiltIn && (
            <button
              onClick={() => {
                openSkillDetail(skill);
                setTimeout(startEditing, 100);
              }}
              className={`p-2 rounded-md ${isDarkMode ? 'hover:bg-slate-600 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'}`}
              title="编辑 Skill">
              <FiEdit2 className="h-4 w-4" />
            </button>
          )}
          {!isBuiltIn && (
            <button
              onClick={() => handleDeleteSkill(skill.id)}
              className={`p-2 rounded-md ${isDarkMode ? 'hover:bg-red-900/50 text-gray-400 hover:text-red-300' : 'hover:bg-red-50 text-gray-500 hover:text-red-600'}`}
              title={t('options_skills_deleteSkill')}>
              <FiTrash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const renderFileList = (
    title: string,
    files: StoredSkillPackage['scripts'] | StoredSkillPackage['references'] | StoredSkillPackage['assets'],
    emptyMessage: string,
  ) => (
    <div>
      <h4 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>{title}</h4>
      {!files || files.length === 0 ? (
        <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{emptyMessage}</p>
      ) : (
        <div className="space-y-1">
          {files.map(file => (
            <div
              key={file.name}
              className={`rounded border ${isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-gray-200 bg-gray-50'} p-2 flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <FiFile className={`h-4 w-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                <span className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>{file.name}</span>
                <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>({file.type})</span>
              </div>
              <button
                onClick={() => setViewingFile({ name: file.name, content: file.content, type: file.type })}
                className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-600'}`}>
                {t('options_skills_viewFile')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section className="space-y-6">
      {/* Header Section */}
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {t('options_skills_header')}
          </h2>
          <div className="flex items-center gap-2">
            <Button
              onClick={openCreateModal}
              className={`flex items-center gap-2 ${isDarkMode ? 'bg-sky-600 hover:bg-sky-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
              <FiPlus className="h-4 w-4" />
              新建
            </Button>
            <Button
              onClick={() => setIsImportModalOpen(true)}
              className={`flex items-center gap-2 ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
              <FiUpload className="h-4 w-4" />
              {t('options_skills_import')}
            </Button>
            <select
              value={exportFormat}
              onChange={e => setExportFormat(e.target.value as 'markdown' | 'json' | 'zip')}
              className={`rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-2 py-1 text-sm`}>
              <option value="markdown">MD</option>
              <option value="json">JSON</option>
              <option value="zip">ZIP</option>
            </select>
            <Button
              onClick={openExportModal}
              disabled={userSkills.length === 0}
              className={`flex items-center gap-2 ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'} disabled:opacity-50`}>
              <FiDownload className="h-4 w-4" />
              {t('options_skills_export')}
            </Button>
          </div>
        </div>

        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} mb-4`}>
          {t('options_skills_description')}
        </p>

        {/* Built-in Skills Section */}
        <div className="mb-4">
          <h3 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            {t('options_skills_builtin')} ({builtInSkills.length})
          </h3>
          <div className="space-y-2">
            {builtInSkills.map(skill => renderSkillCard(convertBuiltInToPackage(skill), true))}
          </div>
        </div>

        {/* User Skills Section */}
        <div>
          <h3 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            {t('options_skills_custom')} ({userSkills.length})
          </h3>
          {userSkills.length === 0 ? (
            <div
              className={`rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'} p-6 text-center`}>
              <FiCode className={`mx-auto h-10 w-10 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} mb-3`} />
              <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_skills_noCustom')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">{userSkills.map(skill => renderSkillCard(skill, false))}</div>
          )}
        </div>
      </div>

      {/* Skill Detail Modal */}
      {isDetailModalOpen && selectedSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              if (isEditing) {
                cancelEditing();
              }
              setIsDetailModalOpen(false);
            }}
          />
          <div
            className={`relative rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'} p-6 w-full max-w-3xl mx-4 shadow-xl max-h-[85vh] overflow-y-auto`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {selectedSkill.name}
                </h3>
                {selectedSkill.packageInfo?.source === 'recording' && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
                      isDarkMode ? 'bg-green-900 text-green-300' : 'bg-green-100 text-green-700'
                    }`}>
                    录制
                  </span>
                )}
              </div>

              {/* 编辑入口 —— 只有文本编辑一种 */}
              {!isEditing && !!selectedSkill.packageInfo && (
                <button
                  onClick={startEditing}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm ${
                    isDarkMode ? 'bg-sky-600 hover:bg-sky-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                  title="编辑">
                  <FiCode className="h-4 w-4" />
                  编辑
                </button>
              )}

              {isEditing && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={cancelEditing}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm ${
                      isDarkMode
                        ? 'bg-slate-600 hover:bg-slate-500 text-gray-200'
                        : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                    }`}>
                    取消
                  </button>
                  <button
                    onClick={saveEditedSkill}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm ${
                      isDarkMode
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}>
                    <FiSave className="h-4 w-4" />
                    保存
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  if (isEditing) cancelEditing();
                  setIsDetailModalOpen(false);
                }}
                className={`p-1 rounded ${isDarkMode ? 'hover:bg-slate-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}>
                <FiX className="h-5 w-5" />
              </button>
            </div>

            {/* 文本编辑 —— 通用格式：frontmatter + 正文 */}
            {isEditing && (
              <div className="space-y-4">
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  编辑 Skill 定义：顶部 <code>---</code> 之间是元信息，下方正文就是给 AI 的指令
                </p>
                <textarea
                  ref={editTextAreaRef}
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={24}
                  className={`w-full rounded-md border px-3 py-2 text-sm font-mono ${
                    isDarkMode
                      ? 'border-slate-600 bg-slate-900 text-gray-200'
                      : 'border-gray-300 bg-gray-50 text-gray-700'
                  }`}
                  spellCheck={false}
                />
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  元信息支持 name / description / category / version / parameters；正文用自然语言写清步骤，
                  <code>{'{{参数名}}'}</code> 会在执行时替换成实际取值
                </p>
              </div>
            )}

            {/* 查看模式（只读；改内容走上面的文本编辑） */}
            {!isEditing && (
              <div className="space-y-4">
                {/* 基本信息 */}
                <div>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {selectedSkill.description}
                  </p>
                  <div className="mt-2 flex items-center gap-4 text-xs">
                    <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>ID: {selectedSkill.id}</span>
                    <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      版本: {selectedSkill.version}
                    </span>
                    <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      分类: {getCategoryLabel(selectedSkill.category)}
                    </span>
                  </div>
                </div>

                {/* 参数 */}
                <div>
                  <h4 className={`mb-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    参数 ({selectedSkill.parameters.length})
                  </h4>
                  {selectedSkill.parameters.length === 0 ? (
                    <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>无参数</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedSkill.parameters.map(param => (
                        <div
                          key={param.name}
                          className={`rounded border p-2 ${
                            isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-gray-200 bg-gray-50'
                          }`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                              {param.name}
                            </span>
                            <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                              ({param.type})
                            </span>
                            {param.required && (
                              <span className={`text-xs ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>必填</span>
                            )}
                          </div>
                          {param.description && (
                            <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              {param.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 技能正文 —— 通用格式下这才是执行时真正注入给 AI 的内容 */}
                <div>
                  <h4 className={`mb-2 text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    技能正文
                  </h4>
                  {selectedSkill.instructions?.trim() ? (
                    <pre
                      className={`max-h-72 overflow-auto whitespace-pre-wrap rounded border p-3 text-xs ${
                        isDarkMode
                          ? 'border-slate-600 bg-slate-900 text-gray-300'
                          : 'border-gray-200 bg-gray-50 text-gray-600'
                      }`}>
                      {selectedSkill.instructions}
                    </pre>
                  ) : (
                    <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      暂无正文，点「编辑」补充
                    </p>
                  )}
                </div>

                {/* 录制的定位数据 —— 只读，供排查用；正文才是执行依据 */}
                {selectedSkill.steps.length > 0 && (
                  <details>
                    <summary
                      className={`cursor-pointer text-sm font-medium ${
                        isDarkMode ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                      录制的定位数据（{selectedSkill.steps.length} 条）
                    </summary>
                    <div className="mt-2 space-y-1">
                      {selectedSkill.steps.map((step, index) => (
                        <div
                          key={step.id + index}
                          className={`rounded border p-2 text-xs ${
                            isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-gray-200 bg-gray-50'
                          }`}>
                          <span className={`font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                            #{index + 1}: {step.action}
                          </span>
                          {step.description && (
                            <span className={`ml-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              - {step.description}
                            </span>
                          )}
                          <p className={`break-all ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            {JSON.stringify(step.parameters)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Package resources */}
                {renderFileList(
                  t('options_skills_scriptsSection'),
                  selectedSkill.scripts,
                  t('options_skills_noScripts'),
                )}
                {renderFileList(
                  t('options_skills_referencesSection'),
                  selectedSkill.references,
                  t('options_skills_noReferences'),
                )}
                {renderFileList(t('options_skills_assetsSection'), selectedSkill.assets, t('options_skills_noAssets'))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Modal —— 和编辑共用同一套文本格式，避免出现第二种 skill 写法 */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsCreateModalOpen(false)} />
          <div
            className={`relative rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'} p-6 w-full max-w-3xl mx-4 shadow-xl max-h-[85vh] overflow-y-auto`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>新建 Skill</h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className={`p-1 rounded ${isDarkMode ? 'hover:bg-slate-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}>
                <FiX className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                顶部 <code>---</code> 之间是元信息，下方正文就是给 AI 的指令
              </p>
              <textarea
                value={createContent}
                onChange={e => setCreateContent(e.target.value)}
                rows={22}
                spellCheck={false}
                className={`w-full rounded-md border px-3 py-2 text-sm font-mono ${
                  isDarkMode
                    ? 'border-slate-600 bg-slate-900 text-gray-200'
                    : 'border-gray-300 bg-gray-50 text-gray-700'
                }`}
              />
              <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                元信息支持 name / description / category / version / parameters；
                <code>{'{{参数名}}'}</code> 会在执行时替换成实际取值
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  onClick={() => setIsCreateModalOpen(false)}
                  className={`${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                  取消
                </Button>
                <Button
                  onClick={handleCreateSkill}
                  disabled={!createContent.trim()}
                  className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
                  <FiSave className="mr-1 inline h-4 w-4" />
                  创建
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsImportModalOpen(false)} />
          <div
            className={`relative rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'} p-6 w-full max-w-lg mx-4 shadow-xl`}>
            <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {t('options_skills_importModalTitle')}
            </h3>

            <div className="space-y-4">
              {/* Format selector */}
              <div className="flex items-center gap-4">
                <label className={`flex items-center gap-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input
                    type="radio"
                    name="importFormat"
                    checked={importFormat === 'markdown'}
                    onChange={() => setImportFormat('markdown')}
                    className="rounded"
                  />
                  <span className="text-sm">Markdown</span>
                </label>
                <label className={`flex items-center gap-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input
                    type="radio"
                    name="importFormat"
                    checked={importFormat === 'json'}
                    onChange={() => setImportFormat('json')}
                    className="rounded"
                  />
                  <span className="text-sm">JSON</span>
                </label>
                <label className={`flex items-center gap-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <input
                    type="radio"
                    name="importFormat"
                    checked={importFormat === 'zip'}
                    onChange={() => setImportFormat('zip')}
                    className="rounded"
                  />
                  <span className="text-sm flex items-center gap-1">
                    <FiPackage className="h-4 w-4" />
                    ZIP
                  </span>
                </label>
              </div>

              {importFormat === 'zip' ? (
                <div className="space-y-3">
                  <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {t('options_skills_importZipDescription')}
                  </p>
                  <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {t('options_skills_importZipNote')}
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleZipImport(file);
                      }
                    }}
                    className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm`}
                  />
                </div>
              ) : (
                <>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {importFormat === 'markdown'
                      ? '粘贴 Markdown 格式的技能文档。多个技能使用 --- 分隔。'
                      : t('options_skills_importDescription')}
                  </p>

                  <textarea
                    value={importContent}
                    onChange={e => setImportContent(e.target.value)}
                    placeholder={
                      importFormat === 'markdown'
                        ? `# My Custom Skill

## Description
A custom skill template for automation.

## Category
custom

## Parameters
- \`url\` (string, required): URL to navigate to
- \`query\` (string): Search query text

## Steps
1. go_to_url: Navigate to {{url}} | params: {"url": "{{url}}"} | onError: stop
2. input_text: Enter search query | onError: continue
3. send_keys: Press Enter to search | params: {"keys": "Enter"} | onError: stop
4. done: Complete the task | onError: stop

## Execution Mode
atomic

---

# Another Skill
...`
                        : `[
  {
    "id": "my-skill",
    "name": "My Custom Skill",
    "description": "A custom skill template",
    "category": "custom",
    "parameters": [],
    "steps": [{ "id": "step1", "action": "done", "parameters": {}, "onError": "stop" }],
    "executionMode": "atomic"
  }
]`
                    }
                    rows={12}
                    className={`w-full rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2 text-sm font-mono`}
                  />

                  <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {importFormat === 'markdown'
                      ? 'Markdown 格式更易读写。使用 # 作为技能名称，## 作为章节标题。'
                      : t('options_skills_importNote')}
                  </p>
                </>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 mt-6">
              <Button
                onClick={() => {
                  setIsImportModalOpen(false);
                  setImportContent('');
                }}
                className={`${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                {t('options_mcp_cancel')}
              </Button>
              {importFormat !== 'zip' && (
                <Button
                  onClick={handleImportSkills}
                  disabled={!importContent.trim()}
                  className={`${isDarkMode ? 'bg-sky-600 hover:bg-sky-700' : 'bg-blue-600 hover:bg-blue-700'} text-white disabled:opacity-50`}>
                  {t('options_skills_import')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* File Viewer Modal */}
      {viewingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setViewingFile(null)} />
          <div
            className={`relative rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'} p-6 w-full max-w-2xl mx-4 shadow-xl max-h-[80vh] overflow-y-auto`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                {viewingFile.name}
              </h3>
              <button
                onClick={() => setViewingFile(null)}
                className={`p-1 rounded ${isDarkMode ? 'hover:bg-slate-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}>
                <FiX className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-2">
              <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {t('options_skills_fileContent')} ({viewingFile.type})
              </span>
            </div>

            <pre
              className={`rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-900 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-700'} p-4 text-sm font-mono overflow-x-auto max-h-[60vh]`}>
              {viewingFile.content}
            </pre>

            <div className="flex justify-end mt-6">
              <Button
                onClick={() => setViewingFile(null)}
                className={`${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                {t('options_skills_close')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Export Selection Modal */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsExportModalOpen(false)} />
          <div
            className={`relative rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'} p-6 w-full max-w-lg mx-4 shadow-xl max-h-[70vh] overflow-hidden flex flex-col`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>导出 Skill</h3>
              <button
                onClick={() => setIsExportModalOpen(false)}
                className={`p-1 rounded ${isDarkMode ? 'hover:bg-slate-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}>
                <FiX className="h-5 w-5" />
              </button>
            </div>

            {/* Format selector */}
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>导出格式:</span>
              <label
                className={`flex items-center gap-2 cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <input
                  type="radio"
                  name="exportFormat"
                  checked={exportFormat === 'markdown'}
                  onChange={() => setExportFormat('markdown')}
                  className="rounded"
                />
                <span className="text-sm">Markdown (每个 Skill 一个 .md 文件)</span>
              </label>
              <label
                className={`flex items-center gap-2 cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <input
                  type="radio"
                  name="exportFormat"
                  checked={exportFormat === 'json'}
                  onChange={() => setExportFormat('json')}
                  className="rounded"
                />
                <span className="text-sm">JSON (每个 Skill 一个 .json 文件)</span>
              </label>
              <label
                className={`flex items-center gap-2 cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <input
                  type="radio"
                  name="exportFormat"
                  checked={exportFormat === 'zip'}
                  onChange={() => setExportFormat('zip')}
                  className="rounded"
                />
                <span className="text-sm">完整包 (每个 Skill 一个目录，含资源文件)</span>
              </label>
              <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                (所有格式都会打包为 ZIP)
              </span>
            </div>

            {/* Selection header */}
            <div className="flex items-center justify-between mb-2 px-1">
              <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                已选择 {selectedForExport.size} / {userSkills.length} 个 Skill
              </span>
              <div className="flex gap-2">
                <button
                  onClick={selectAllForExport}
                  className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-600'}`}>
                  全选
                </button>
                <button
                  onClick={deselectAllForExport}
                  className={`text-xs px-2 py-1 rounded ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-600'}`}>
                  全不选
                </button>
              </div>
            </div>

            {/* Skill list with checkboxes */}
            <div className="flex-1 overflow-y-auto space-y-2 px-1">
              {userSkills.map(skill => (
                <div
                  key={skill.id}
                  onClick={() => toggleExportSelection(skill.id)}
                  className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                    selectedForExport.has(skill.id)
                      ? isDarkMode
                        ? 'border-sky-500 bg-sky-900/30'
                        : 'border-blue-500 bg-blue-50'
                      : isDarkMode
                        ? 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
                        : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}>
                  <div className="flex items-center gap-3">
                    {selectedForExport.has(skill.id) ? (
                      <FiCheckSquare className={`h-5 w-5 ${isDarkMode ? 'text-sky-400' : 'text-blue-600'}`} />
                    ) : (
                      <FiSquare className={`h-5 w-5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                          {skill.name}
                        </span>
                        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          ({skill.steps.length} 步骤)
                        </span>
                      </div>
                      <p className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {skill.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal Actions */}
            <div
              className={`flex justify-end gap-2 mt-4 pt-4 border-t ${isDarkMode ? 'border-slate-600' : 'border-gray-200'}`}>
              <Button
                onClick={() => setIsExportModalOpen(false)}
                className={`${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                取消
              </Button>
              <Button
                onClick={performExport}
                disabled={selectedForExport.size === 0}
                className={`flex items-center gap-2 ${
                  isDarkMode ? 'bg-sky-600 hover:bg-sky-700' : 'bg-blue-600 hover:bg-blue-700'
                } text-white disabled:opacity-50`}>
                <FiDownload className="h-4 w-4" />
                导出 ({selectedForExport.size})
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
