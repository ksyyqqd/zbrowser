import { useState, useEffect } from 'react';
import { Button } from '@extension/ui';
import { userSkillsStore, type UserSkillConfig } from '@extension/storage';
import type { Skill } from '@extension/skills';
import { MarkdownParser } from '@extension/skills';
import { FiCode, FiPlus, FiTrash2, FiDownload, FiUpload, FiInfo, FiPlay, FiEdit2, FiCheckCircle } from 'react-icons/fi';
import { t } from '@extension/i18n';

interface SkillSettingsProps {
  isDarkMode?: boolean;
}

export const SkillSettings = ({ isDarkMode = false }: SkillSettingsProps) => {
  const [userSkills, setUserSkills] = useState<UserSkillConfig[]>([]);
  const [builtInSkills, setBuiltInSkills] = useState<Skill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | UserSkillConfig | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importContent, setImportContent] = useState('');
  const [importFormat, setImportFormat] = useState<'markdown' | 'json'>('markdown');
  const [exportFormat, setExportFormat] = useState<'markdown' | 'json'>('markdown');

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    // Load user skills from storage
    const skills = await userSkillsStore.getAllSkills();
    setUserSkills(skills);

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

  const handleImportSkills = async () => {
    try {
      const parser = new MarkdownParser();
      let skillsArray: Skill[];

      if (importFormat === 'markdown') {
        // Parse Markdown format
        skillsArray = parser.parseMultiple(importContent);
      } else {
        // Parse JSON format
        const parsed = JSON.parse(importContent);
        skillsArray = Array.isArray(parsed) ? parsed : [parsed];
      }

      if (skillsArray.length === 0) {
        alert('No skills found in the input');
        return;
      }

      const result = await userSkillsStore.importSkills(skillsArray as UserSkillConfig[]);

      if (result.errors.length > 0) {
        alert(`Import completed with errors:\n${result.errors.join('\n')}`);
      } else {
        alert(`Successfully imported ${result.imported} skills`);
      }

      await loadSkills();
      setImportContent('');
      setIsImportModalOpen(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to parse: ${errorMsg}. Please check your input format.`);
    }
  };

  const handleExportSkills = async () => {
    const skills = await userSkillsStore.exportSkills();

    if (skills.length === 0) {
      alert('No custom skills to export');
      return;
    }

    const parser = new MarkdownParser();
    let content: string;
    let filename: string;
    let mimeType: string;

    if (exportFormat === 'markdown') {
      // Export as Markdown
      content = parser.toMarkdownMultiple(skills as Skill[]);
      filename = 'nanobrowser-skills.md';
      mimeType = 'text/markdown';
    } else {
      // Export as JSON
      content = JSON.stringify(skills, null, 2);
      filename = 'nanobrowser-skills.json';
      mimeType = 'application/json';
    }

    // Create download
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openSkillDetail = (skill: Skill | UserSkillConfig) => {
    setSelectedSkill(skill);
    setIsDetailModalOpen(true);
  };

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

  const renderSkillCard = (skill: Skill | UserSkillConfig, isBuiltIn: boolean = false) => (
    <div
      key={skill.id}
      className={`rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'} p-4`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={`font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{skill.name}</h3>
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
              onClick={() => setIsImportModalOpen(true)}
              className={`flex items-center gap-2 ${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
              <FiUpload className="h-4 w-4" />
              {t('options_skills_import')}
            </Button>
            <select
              value={exportFormat}
              onChange={e => setExportFormat(e.target.value as 'markdown' | 'json')}
              className={`rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-2 py-1 text-sm`}>
              <option value="markdown">MD</option>
              <option value="json">JSON</option>
            </select>
            <Button
              onClick={handleExportSkills}
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
          <div className="space-y-2">{builtInSkills.map(skill => renderSkillCard(skill, true))}</div>
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
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsDetailModalOpen(false)} />
          <div
            className={`relative rounded-lg border ${isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'} p-6 w-full max-w-2xl mx-4 shadow-xl max-h-[80vh] overflow-y-auto`}>
            <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {selectedSkill.name}
            </h3>

            <div className="space-y-4">
              {/* Basic Info */}
              <div>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {selectedSkill.description}
                </p>
                <div className="flex items-center gap-2 mt-2 text-xs">
                  <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {t('options_skills_id')}: {selectedSkill.id}
                  </span>
                  <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {t('options_skills_version')}: {selectedSkill.version}
                  </span>
                  <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {t('options_skills_category')}: {getCategoryLabel(selectedSkill.category)}
                  </span>
                </div>
              </div>

              {/* Parameters */}
              <div>
                <h4 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {t('options_skills_parameters')}
                </h4>
                {selectedSkill.parameters.length === 0 ? (
                  <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {t('options_skills_noParameters')}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {selectedSkill.parameters.map(param => (
                      <div
                        key={param.name}
                        className={`rounded border ${isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-gray-200 bg-gray-50'} p-2`}>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                            {param.name}
                          </span>
                          <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            ({param.type})
                          </span>
                          {param.required && (
                            <span className={`text-xs ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>
                              {t('options_skills_required')}
                            </span>
                          )}
                        </div>
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {param.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Steps */}
              <div>
                <h4 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {t('options_skills_executionSteps')}
                </h4>
                <div className="space-y-1">
                  {selectedSkill.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className={`rounded border ${isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-gray-200 bg-gray-50'} p-2`}>
                      <div className="flex items-center gap-2">
                        <span className={`font-medium text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                          {t('options_skills_steps')} {index + 1}: {step.action}
                        </span>
                        {step.description && (
                          <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            - {step.description}
                          </span>
                        )}
                      </div>
                      <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        On error: {step.onError}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Execution Mode */}
              <div className="flex items-center gap-2">
                <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {t('options_skills_executionMode')}:
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${isDarkMode ? 'bg-slate-600 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                  {selectedSkill.executionMode}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end mt-6">
              <Button
                onClick={() => setIsDetailModalOpen(false)}
                className={`${isDarkMode ? 'bg-slate-600 hover:bg-slate-500 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                {t('options_skills_close')}
              </Button>
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
              </div>

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
              <Button
                onClick={handleImportSkills}
                disabled={!importContent.trim()}
                className={`${isDarkMode ? 'bg-sky-600 hover:bg-sky-700' : 'bg-blue-600 hover:bg-blue-700'} text-white disabled:opacity-50`}>
                {t('options_skills_import')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
