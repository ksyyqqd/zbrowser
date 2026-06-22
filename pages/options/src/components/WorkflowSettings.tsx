/**
 * Workflow Settings Component
 * Manages workflows in the Options page - list, create, edit, import, export, execute
 */

import { useState, useEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { FiPlus, FiEdit2, FiTrash2, FiDownload, FiUpload, FiPlay, FiShare2, FiCode } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { userWorkflowsStore, type UserWorkflowConfig } from '@extension/storage';
import { userSkillsStore, type UserSkillConfig } from '@extension/storage';
import {
  convertSkillToWorkflow,
  convertWorkflowToSkill,
  parseWorkflow,
  serializeWorkflows,
  validateWorkflowStructure,
} from '@extension/workflow';
import type { Workflow } from '@extension/workflow';
import type { Skill } from '@extension/skills';
import { useWorkflowExecution } from '../hooks/useWorkflowExecution';

// Lazy-load the heavy WorkflowEditor (React Flow + dagre); only fetched when the editor is opened
const WorkflowEditor = lazy(() => import('./WorkflowEditor'));

interface WorkflowSettingsProps {
  isDarkMode?: boolean;
}

export default function WorkflowSettings({ isDarkMode = false }: WorkflowSettingsProps) {
  const [workflows, setWorkflows] = useState<UserWorkflowConfig[]>([]);
  const [skills, setSkills] = useState<UserSkillConfig[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<UserWorkflowConfig | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const { state: executionState, reset: resetExecution } = useWorkflowExecution();
  const [importContent, setImportContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Load workflows on mount
  useEffect(() => {
    loadWorkflows();
    loadSkills();
  }, []);

  // Auto-open workflow editor if redirected from recording save-as-workflow.
  // Triggered via URL `?tab=workflows&editWorkflow=<id>` from side-panel save flow.
  useEffect(() => {
    const checkAutoOpen = async () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('editWorkflow');
      if (!id) return;
      // Clean URL to avoid re-triggering on subsequent renders / refresh
      params.delete('editWorkflow');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
      window.history.replaceState(null, '', newUrl);

      // Wait for workflow store to be queryable
      try {
        const stored = await userWorkflowsStore.getAllWorkflows();
        const target = stored.find(w => w.id === id);
        if (target) {
          setSelectedWorkflow(target);
          resetExecution();
          setIsEditorOpen(true);
        }
      } catch {
        /* ignore */
      }
    };
    checkAutoOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadWorkflows = async () => {
    try {
      const storedWorkflows = await userWorkflowsStore.getAllWorkflows();
      setWorkflows(storedWorkflows);
    } catch (e) {
      console.error('[WorkflowSettings] Failed to load workflows:', e);
      setWorkflows([]);
    }
  };

  const loadSkills = async () => {
    try {
      const storedSkills = await userSkillsStore.getAllSkills();
      setSkills(storedSkills);
    } catch (e) {
      console.error('[WorkflowSettings] Failed to load skills:', e);
      setSkills([]);
    }
  };

  // Filter and sort workflows (most recently edited first)
  const filteredWorkflows = workflows
    .filter(w => {
      const matchesSearch =
        !searchQuery ||
        w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        w.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  // Create new workflow
  const handleCreateWorkflow = () => {
    setSelectedWorkflow(null);
    resetExecution();
    setIsEditorOpen(true);
  };

  // Edit existing workflow
  const handleEditWorkflow = (workflow: UserWorkflowConfig) => {
    setSelectedWorkflow(workflow);
    resetExecution();
    setIsEditorOpen(true);
  };

  // Save workflow from editor
  const handleSaveWorkflow = async (workflow: Workflow) => {
    try {
      const config: UserWorkflowConfig = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        nodes: workflow.nodes,
        edges: workflow.edges,
        variables: workflow.variables,
        executionConfig: workflow.executionConfig,
        createdAt: workflow.createdAt ?? Date.now(),
        updatedAt: workflow.updatedAt ?? Date.now(),
      };

      if (selectedWorkflow) {
        await userWorkflowsStore.updateWorkflow(selectedWorkflow.id, config);
      } else {
        await userWorkflowsStore.addWorkflow(config);
        // For new workflows we now have an id — adopt it so subsequent saves
        // update instead of inserting duplicates.
        setSelectedWorkflow({ ...config });
      }

      await loadWorkflows();
      // Do NOT close the editor here — saving keeps the user editing.
      // The editor's ✕ button is the only way to close.
    } catch (e) {
      console.error('[WorkflowSettings] Failed to save workflow:', e);
      alert(t('workflow_saveError'));
    }
  };

  // Delete workflow
  const handleDeleteWorkflow = async (workflow: UserWorkflowConfig) => {
    if (!window.confirm(t('workflow_deleteConfirm', [workflow.name]))) return;

    try {
      await userWorkflowsStore.removeWorkflow(workflow.id);
      await loadWorkflows();
    } catch (e) {
      console.error('[WorkflowSettings] Failed to delete workflow:', e);
    }
  };

  // Import workflows from JSON
  const handleImportWorkflows = async () => {
    try {
      const parsed = JSON.parse(importContent);
      const workflowArray = Array.isArray(parsed) ? parsed : [parsed];

      const validWorkflows: UserWorkflowConfig[] = [];
      for (const w of workflowArray) {
        const result = parseWorkflow(w);
        const validation = validateWorkflowStructure(result);
        if (validation.valid) {
          validWorkflows.push({
            id: result.id,
            name: result.name,
            description: result.description,
            version: result.version,
            nodes: result.nodes,
            edges: result.edges,
            variables: result.variables,
            executionConfig: result.executionConfig,
            createdAt: result.createdAt ?? Date.now(),
            updatedAt: result.updatedAt ?? Date.now(),
          });
        } else {
          alert(`Invalid workflow: ${validation.errors.join(', ')}`);
        }
      }

      if (validWorkflows.length > 0) {
        await userWorkflowsStore.importWorkflows(validWorkflows);
        await loadWorkflows();
        setIsImportModalOpen(false);
        setImportContent('');
      }
    } catch (e) {
      console.error('[WorkflowSettings] Failed to import:', e);
      alert(t('workflow_importError'));
    }
  };

  // Export workflows
  const handleExportWorkflows = (workflowIds?: string[]) => {
    const toExport = workflowIds ? workflows.filter(w => workflowIds.includes(w.id)) : filteredWorkflows;

    const json = serializeWorkflows(
      toExport.map(w => ({
        id: w.id,
        name: w.name,
        description: w.description,
        version: w.version,
        nodes: w.nodes,
        edges: w.edges,
        variables: w.variables,
        executionConfig: w.executionConfig,
        createdAt: w.createdAt ?? Date.now(),
        updatedAt: w.updatedAt ?? Date.now(),
      })),
    );

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflows-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setIsExportModalOpen(false);
  };

  // Convert Skill to Workflow
  const handleConvertSkillToWorkflow = async (skill: UserSkillConfig) => {
    try {
      const skillFull = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        category: skill.category,
        author: skill.author,
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
          condition: s.condition
            ? {
                type: s.condition.type,
                expression: s.condition.expression,
                thenSteps: s.condition.thenSteps as Skill['steps'] | undefined,
                elseSteps: s.condition.elseSteps as Skill['steps'] | undefined,
              }
            : undefined,
          onError: s.onError,
          retryCount: s.retryCount,
          delay: s.delay,
        })),
        executionMode: skill.executionMode,
        timeout: skill.timeout,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      } as unknown as Skill;

      const workflow = convertSkillToWorkflow(skillFull);

      const config: UserWorkflowConfig = {
        id: `converted-${workflow.id}`,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        nodes: workflow.nodes,
        edges: workflow.edges,
        variables: workflow.variables,
        executionConfig: workflow.executionConfig,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await userWorkflowsStore.addWorkflow(config);
      await loadWorkflows();
      setIsConvertModalOpen(false);
    } catch (e) {
      console.error('[WorkflowSettings] Failed to convert skill:', e);
      alert(t('workflow_convertError'));
    }
  };

  // Convert Workflow to Skill
  const handleConvertWorkflowToSkill = async (workflow: UserWorkflowConfig) => {
    try {
      const workflowFull: Workflow = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        nodes: workflow.nodes,
        edges: workflow.edges,
        variables: workflow.variables,
        executionConfig: workflow.executionConfig,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
      };

      const skill = convertWorkflowToSkill(workflowFull);

      const skillConfig: UserSkillConfig = {
        id: `converted-${skill.id}`,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        category: skill.category,
        author: 'workflow-converter',
        tags: [],
        parameters: skill.parameters,
        steps: skill.steps,
        executionMode: skill.executionMode || 'expanded',
        createdAt: Date.now(),
      };

      await userSkillsStore.addSkill(skillConfig);
      await loadSkills();
      alert(t('workflow_convertSuccess'));
    } catch (e) {
      console.error('[WorkflowSettings] Failed to convert workflow:', e);
      alert(t('workflow_convertError'));
    }
  };

  // Execute workflow - sends message to background service
  const handleExecuteWorkflow = async (workflow: UserWorkflowConfig) => {
    try {
      // Reset execution visualization state before starting a new run
      resetExecution();
      // Get the current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        console.error('[WorkflowSettings] No active tab found');
        return;
      }

      console.log('[WorkflowSettings] Starting workflow execution:', workflow.name);

      // Send execute_workflow message to background
      // The workflow will execute on the target page with overlay showing progress
      const response = await chrome.runtime.sendMessage({
        type: 'execute_workflow',
        tabId: tab.id,
        workflowId: workflow.id,
        taskId: `workflow-task-${Date.now()}`,
        params: {},
      });

      console.log('[WorkflowSettings] Workflow response:', response);
      // No alert - the overlay on the target page shows the result
    } catch (error) {
      console.error('[WorkflowSettings] Failed to execute workflow:', error);
    }
  };

  /**
   * Execute workflow directly from within the editor.
   * Saves the workflow silently (without closing the editor), then triggers execution.
   */
  const handleExecuteFromEditor = async (workflow: Workflow) => {
    try {
      // Save without closing editor
      const config: UserWorkflowConfig = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description || '',
        version: workflow.version || '1.0.0',
        nodes: workflow.nodes,
        edges: workflow.edges,
        variables: workflow.variables || [],
        executionConfig: workflow.executionConfig || { onError: 'stop' as const },
        createdAt: workflow.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };

      if (selectedWorkflow) {
        await userWorkflowsStore.updateWorkflow(selectedWorkflow.id, config);
      } else {
        await userWorkflowsStore.addWorkflow(config);
        // Track as selected so subsequent saves update rather than re-create
        setSelectedWorkflow(config);
      }
      await loadWorkflows();

      // Small delay to ensure storage write completes before background reads it
      await new Promise(resolve => setTimeout(resolve, 100));
      await handleExecuteWorkflow(config);
    } catch (error) {
      console.error('[WorkflowSettings] Failed to execute from editor:', error);
    }
  };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div
        className={`rounded-lg border p-6 text-left shadow-sm ${
          isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'
        }`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {t('options_workflow_header')}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreateWorkflow}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-500">
              <FiPlus className="size-4" />
              {t('workflow_create')}
            </button>
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${
                isDarkMode
                  ? 'bg-slate-600 text-gray-200 hover:bg-slate-500'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}>
              <FiUpload className="size-4" />
              {t('workflow_import')}
            </button>
            <button
              type="button"
              onClick={() => setIsConvertModalOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${
                isDarkMode
                  ? 'bg-slate-600 text-gray-200 hover:bg-slate-500'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}>
              <FiShare2 className="size-4" />
              {t('workflow_convertFromSkill')}
            </button>
          </div>
        </div>

        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {t('options_workflow_description')}
        </p>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('workflow_searchPlaceholder')}
          className={`px-3 py-2 rounded-md border text-sm w-64 ${
            isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
          }`}
        />
        <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {filteredWorkflows.length} / {workflows.length} workflows
        </span>
      </div>

      {/* Workflow List */}
      <div className="space-y-2">
        {filteredWorkflows.length === 0 ? (
          <div
            className={`rounded-lg border p-6 text-center ${
              isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-50'
            }`}>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {searchQuery ? t('workflow_notFound') : t('workflow_empty')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredWorkflows.map(workflow => (
              <div
                key={workflow.id}
                className={`group flex flex-col rounded-xl border p-4 transition-shadow hover:shadow-md ${
                  isDarkMode
                    ? 'border-slate-700 bg-slate-800 hover:border-slate-600'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}>
                <div className="mb-2 flex items-start justify-between">
                  <h3
                    className={`line-clamp-1 font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}
                    title={workflow.name}>
                    {workflow.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleDeleteWorkflow(workflow)}
                    className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-red-500/20 group-hover:opacity-100"
                    title={t('workflow_delete')}>
                    <FiTrash2 className="size-3.5 text-red-500" />
                  </button>
                </div>
                <p
                  className={`mb-3 h-10 text-sm line-clamp-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
                  title={workflow.description}>
                  {workflow.description || '暂无描述'}
                </p>
                <div
                  className="flex items-center gap-1 border-t pt-3"
                  style={{ borderColor: isDarkMode ? '#334155' : '#e5e7eb' }}>
                  <span className={`mr-auto text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {workflow.nodes.length} 节点
                  </span>
                  <button
                    type="button"
                    onClick={() => handleExecuteWorkflow(workflow)}
                    className="rounded-md p-1.5 hover:bg-green-500/20"
                    title={t('workflow_execute')}>
                    <FiPlay className="size-3.5 text-green-500" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEditWorkflow(workflow)}
                    className={`rounded-md p-1.5 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}
                    title={t('workflow_edit')}>
                    <FiEdit2 className={`size-3.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportWorkflows([workflow.id])}
                    className={`rounded-md p-1.5 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}
                    title="导出为 JSON">
                    <FiDownload className={`size-3.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConvertWorkflowToSkill(workflow)}
                    className={`rounded-md p-1.5 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}
                    title={t('workflow_convertToSkill')}>
                    <FiCode className={`size-3.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                  </button>
                  <span className={`ml-auto text-xs ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    {workflow.updatedAt
                      ? new Date(workflow.updatedAt).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workflow Editor Modal — portaled to document.body to escape Options page layout constraints */}
      {isEditorOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => setIsEditorOpen(false)} />
            <div className={`relative size-full overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-white'}`}>
              <Suspense
                fallback={
                  <div
                    className={`flex h-full items-center justify-center text-sm ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                    Loading editor...
                  </div>
                }>
                <WorkflowEditor
                  workflow={
                    selectedWorkflow
                      ? {
                          id: selectedWorkflow.id,
                          name: selectedWorkflow.name,
                          description: selectedWorkflow.description,
                          version: selectedWorkflow.version,
                          nodes: selectedWorkflow.nodes,
                          edges: selectedWorkflow.edges,
                          variables: selectedWorkflow.variables,
                          executionConfig: selectedWorkflow.executionConfig,
                          createdAt: selectedWorkflow.createdAt,
                          updatedAt: selectedWorkflow.updatedAt,
                        }
                      : undefined
                  }
                  onSave={handleSaveWorkflow}
                  onCancel={() => setIsEditorOpen(false)}
                  isDarkMode={isDarkMode}
                  executionState={executionState}
                  onExecute={handleExecuteFromEditor}
                />
              </Suspense>
            </div>
          </div>,
          document.body,
        )}

      {/* Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsImportModalOpen(false)} />
          <div
            className={`relative rounded-lg border p-6 w-full max-w-lg mx-4 shadow-xl ${
              isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'
            }`}>
            <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {t('workflow_importModalTitle')}
            </h3>
            <p className={`text-sm mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('workflow_importDescription')}
            </p>
            <textarea
              value={importContent}
              onChange={e => setImportContent(e.target.value)}
              placeholder={t('workflow_importPlaceholder')}
              className={`w-full px-3 py-2 rounded-md border text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}
              rows={10}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className={`px-4 py-1.5 rounded-md text-sm ${
                  isDarkMode ? 'bg-slate-600 text-gray-200' : 'bg-gray-200 text-gray-700'
                }`}>
                {t('workflow_cancel')}
              </button>
              <button
                type="button"
                onClick={handleImportWorkflows}
                className="px-4 py-1.5 rounded-md text-sm bg-blue-600 text-white">
                {t('workflow_import')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convert from Skill Modal */}
      {isConvertModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsConvertModalOpen(false)} />
          <div
            className={`relative rounded-lg border p-6 w-full max-w-lg mx-4 shadow-xl ${
              isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'
            }`}>
            <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {t('workflow_convertModalTitle')}
            </h3>
            <p className={`text-sm mb-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('workflow_convertModalDescription')}
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {skills.length === 0 ? (
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('workflow_noSkillsToConvert')}
                </p>
              ) : (
                skills.map(skill => (
                  <div
                    key={skill.id}
                    className={`flex items-center justify-between p-3 rounded-md ${
                      isDarkMode ? 'bg-slate-700' : 'bg-gray-100'
                    }`}>
                    <div>
                      <span className={`font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                        {skill.name}
                      </span>
                      <span className={`text-xs ml-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {skill.steps.length} steps
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleConvertSkillToWorkflow(skill)}
                      className="px-3 py-1 rounded-md text-sm bg-blue-600 text-white">
                      {t('workflow_convert')}
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setIsConvertModalOpen(false)}
                className={`px-4 py-1.5 rounded-md text-sm ${
                  isDarkMode ? 'bg-slate-600 text-gray-200' : 'bg-gray-200 text-gray-700'
                }`}>
                {t('workflow_close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
