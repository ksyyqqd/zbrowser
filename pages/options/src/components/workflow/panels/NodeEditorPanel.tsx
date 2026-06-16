import { useEffect, useState } from 'react';
import { FiTrash2 } from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { WorkflowNode } from '@extension/workflow';
import { newBranchId } from '../utils/ids';

interface NodeEditorPanelProps {
  node: WorkflowNode;
  onSave: (node: WorkflowNode) => void;
  isDarkMode: boolean;
}

export function NodeEditorPanel({ node, onSave, isDarkMode }: NodeEditorPanelProps) {
  const [editedNode, setEditedNode] = useState(node);

  useEffect(() => {
    setEditedNode(node);
  }, [node]);

  const getActionParameters = (
    action: string,
  ): { key: string; label: string; type: 'text' | 'number' | 'textarea'; placeholder?: string }[] => {
    switch (action) {
      case 'go_to_url':
        return [{ key: 'url', label: t('workflow_param_url'), type: 'text', placeholder: 'https://example.com' }];
      case 'click_element':
        return [
          { key: 'selector', label: t('workflow_param_selector'), type: 'text', placeholder: 'css selector or xpath' },
          { key: 'xpath', label: t('workflow_param_xpath'), type: 'text', placeholder: 'XPath expression' },
        ];
      case 'input_text':
        return [
          { key: 'selector', label: t('workflow_param_selector'), type: 'text', placeholder: 'css selector or xpath' },
          { key: 'xpath', label: t('workflow_param_xpath'), type: 'text', placeholder: 'XPath expression' },
          { key: 'text', label: t('workflow_param_text'), type: 'text', placeholder: 'Text to input' },
        ];
      case 'send_keys':
        return [
          { key: 'keys', label: t('workflow_param_keys'), type: 'text', placeholder: 'Enter, Tab, Escape, etc.' },
        ];
      case 'scroll_to_percent':
        return [{ key: 'yPercent', label: t('workflow_param_yPercent'), type: 'number', placeholder: '0-100' }];
      case 'scroll_to_text':
        return [{ key: 'text', label: t('workflow_param_scrollText'), type: 'text', placeholder: 'Text to scroll to' }];
      case 'select_dropdown_option':
        return [
          {
            key: 'selector',
            label: t('workflow_param_selector'),
            type: 'text',
            placeholder: 'css selector for dropdown',
          },
          { key: 'text', label: t('workflow_param_optionText'), type: 'text', placeholder: 'Option text to select' },
        ];
      case 'wait':
        return [{ key: 'duration', label: t('workflow_param_duration'), type: 'number', placeholder: 'milliseconds' }];
      case 'open_tab':
        return [
          { key: 'url', label: t('workflow_param_url'), type: 'text', placeholder: 'https://example.com (optional)' },
        ];
      case 'switch_tab':
        return [
          { key: 'tabIndex', label: t('workflow_param_tabIndex'), type: 'number', placeholder: 'Tab index (0-based)' },
        ];
      case 'generate_image':
        return [
          { key: 'prompt', label: t('workflow_param_prompt'), type: 'textarea', placeholder: 'Describe the image...' },
          { key: 'model', label: t('workflow_param_model'), type: 'text', placeholder: 'gpt-image-2 (optional)' },
          { key: 'size', label: t('workflow_param_size'), type: 'text', placeholder: '1024x1024 (optional)' },
          {
            key: 'quality',
            label: t('workflow_param_quality'),
            type: 'text',
            placeholder: 'standard/high/low (optional)',
          },
          {
            key: 'outputVariable',
            label: t('workflow_param_outputVariable'),
            type: 'text',
            placeholder: 'Variable name',
          },
        ];
      default:
        return [];
    }
  };

  const handleActionChange = (newAction: string) => {
    const newParams: Record<string, unknown> = {};
    for (const field of getActionParameters(newAction)) {
      newParams[field.key] = field.type === 'number' ? 0 : '';
    }
    const updated = { ...editedNode, data: { ...editedNode.data, action: newAction, parameters: newParams } };
    setEditedNode(updated);
    onSave(updated);
  };

  const handleParameterChange = (key: string, value: string | number) => {
    const currentParams = editedNode.data.parameters || {};
    const updated = { ...editedNode, data: { ...editedNode.data, parameters: { ...currentParams, [key]: value } } };
    setEditedNode(updated);
    onSave(updated);
  };

  const handleFieldChange = (field: string, value: string | boolean | Array<{ id: string; name: string }>) => {
    const updated = { ...editedNode, data: { ...editedNode.data, [field]: value } };
    setEditedNode(updated);
    onSave(updated);
  };

  const handleNameChange = (value: string) => {
    const updated = { ...editedNode, name: value };
    setEditedNode(updated);
    onSave(updated);
  };

  const currentAction = editedNode.data.action || 'wait';
  const currentParams = editedNode.data.parameters || {};
  const actionParamFields = getActionParameters(currentAction);
  const inputClass = `mt-1 w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:ring-2 focus:ring-blue-400/50 ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`;
  const labelClass = `text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`;

  return (
    <div className="space-y-4 p-4">
      {/* Node Name */}
      <div>
        <label className={labelClass}>{t('workflow_nodeName')}</label>
        <input
          type="text"
          value={editedNode.name}
          onChange={e => handleNameChange(e.target.value)}
          className={inputClass}
        />
      </div>

      {/* Node Type Badge */}
      <div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
            editedNode.type === 'ai'
              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
              : editedNode.type === 'automation'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
          }`}>
          {editedNode.type === 'ai'
            ? t('workflow_nodeType_ai')
            : editedNode.type === 'automation'
              ? t('workflow_nodeType_automation')
              : t('workflow_nodeType_condition')}
        </span>
      </div>

      {/* AI Fields */}
      {editedNode.type === 'ai' && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>{t('workflow_aiPrompt')}</label>
            <textarea
              value={editedNode.data.prompt || ''}
              onChange={e => handleFieldChange('prompt', e.target.value)}
              className={inputClass}
              rows={4}
            />
          </div>
          <div>
            <label className={labelClass}>{t('workflow_outputVariable')}</label>
            <input
              type="text"
              value={editedNode.data.outputVariable || ''}
              onChange={e => handleFieldChange('outputVariable', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {/* Automation Fields */}
      {editedNode.type === 'automation' && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>{t('workflow_intent')}</label>
            <input
              type="text"
              value={editedNode.data.intent || ''}
              onChange={e => handleFieldChange('intent', e.target.value)}
              className={inputClass}
              placeholder={t('workflow_intent_placeholder')}
            />
          </div>
          <div>
            <label className={labelClass}>{t('workflow_action')}</label>
            <select value={currentAction} onChange={e => handleActionChange(e.target.value)} className={inputClass}>
              <option value="click_element">{t('workflow_action_clickElement')}</option>
              <option value="input_text">{t('workflow_action_inputText')}</option>
              <option value="go_to_url">{t('workflow_action_goToUrl')}</option>
              <option value="go_back">{t('workflow_action_goBack')}</option>
              <option value="go_forward">{t('workflow_action_goForward')}</option>
              <option value="scroll_to_percent">{t('workflow_action_scroll')}</option>
              <option value="scroll_to_top">{t('workflow_action_scrollTop')}</option>
              <option value="scroll_to_bottom">{t('workflow_action_scrollBottom')}</option>
              <option value="scroll_to_text">{t('workflow_action_scrollText')}</option>
              <option value="wait">{t('workflow_action_wait')}</option>
              <option value="open_tab">{t('workflow_action_openTab')}</option>
              <option value="close_tab">{t('workflow_action_closeTab')}</option>
              <option value="switch_tab">{t('workflow_action_switchTab')}</option>
              <option value="send_keys">{t('workflow_action_sendKeys')}</option>
              <option value="select_dropdown_option">{t('workflow_action_selectDropdown')}</option>
              <option value="get_dropdown_options">{t('workflow_action_getDropdownOptions')}</option>
              <option value="cache_content">{t('workflow_action_cacheContent')}</option>
              <option value="generate_image">{t('workflow_action_generateImage')}</option>
            </select>
          </div>
          {actionParamFields.length > 0 && (
            <div
              className={`space-y-2 border-t border-dashed pt-2 ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}`}>
              <label className={labelClass}>{t('workflow_parameters')}</label>
              {actionParamFields.map(field => (
                <div key={field.key}>
                  <label className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>{field.label}</label>
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={
                      field.type === 'number'
                        ? (currentParams[field.key] as number) || 0
                        : (currentParams[field.key] as string) || ''
                    }
                    onChange={e =>
                      handleParameterChange(
                        field.key,
                        field.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value,
                      )
                    }
                    className={`mt-0.5 w-full rounded-lg border px-3 py-1.5 text-sm transition-colors focus:ring-2 focus:ring-blue-400/50 ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
                    placeholder={field.placeholder}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Condition Fields */}
      {editedNode.type === 'condition' && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>{t('workflow_aiPrompt')}</label>
            <textarea
              value={editedNode.data.prompt || ''}
              onChange={e => handleFieldChange('prompt', e.target.value)}
              className={inputClass}
              rows={3}
              placeholder={t('workflow_conditionExpression')}
            />
          </div>
          <div>
            <label className={labelClass}>{t('workflow_branches')}</label>
            <div className="mt-1 space-y-1.5">
              {(editedNode.data.branches || []).map((branch, index) => (
                <div key={branch.id} className="flex items-center gap-1.5">
                  <span
                    className={`flex size-5 items-center justify-center rounded text-xs font-semibold ${isDarkMode ? 'bg-orange-900/30 text-orange-400' : 'bg-orange-100 text-orange-700'}`}>
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    value={branch.name}
                    onChange={e => {
                      const newBranches = [...(editedNode.data.branches || [])];
                      newBranches[index] = { ...newBranches[index], name: e.target.value };
                      handleFieldChange('branches', newBranches);
                    }}
                    className={`flex-1 rounded-md border px-2 py-1 text-sm transition-colors focus:ring-2 focus:ring-blue-400/50 ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
                    placeholder={t('workflow_branchNamePlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const nb = [...(editedNode.data.branches || [])];
                      nb.splice(index, 1);
                      handleFieldChange('branches', nb);
                    }}
                    className="rounded-md p-1 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
                    title={t('workflow_removeBranch')}>
                    <FiTrash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const nb = [...(editedNode.data.branches || [])];
                  nb.push({ id: newBranchId(), name: '' });
                  handleFieldChange('branches', nb);
                }}
                className={`mt-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${isDarkMode ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                + {t('workflow_addBranch')}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={editedNode.data.evaluateWithAI ?? true}
              onChange={e => handleFieldChange('evaluateWithAI', e.target.checked)}
              className="rounded"
            />
            <label className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('workflow_evaluateWithAI')}
            </label>
          </div>
          <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {t('workflow_conditionPortsHint')}
          </p>
        </div>
      )}
    </div>
  );
}
