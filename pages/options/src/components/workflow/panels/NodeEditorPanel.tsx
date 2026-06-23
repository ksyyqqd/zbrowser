import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiTrash2 } from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { WorkflowNode, WorkflowVariable } from '@extension/workflow';
import { userWorkflowsStore, type UserWorkflowConfig } from '@extension/storage';
import { newBranchId } from '../utils/ids';

interface NodeEditorPanelProps {
  node: WorkflowNode;
  onSave: (node: WorkflowNode) => void;
  isDarkMode: boolean;
  variables?: WorkflowVariable[];
  /** Optional: append a new variable to the workflow's variable list. When
   *  provided, the AI-prompt missing-variable detector can offer a
   *  one-click "create" action. */
  onAddVariable?: (v: WorkflowVariable) => void;
}

export function NodeEditorPanel({ node, onSave, isDarkMode, variables = [], onAddVariable }: NodeEditorPanelProps) {
  const [editedNode, setEditedNode] = useState(node);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

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
      case 'scroll_to_text':
        return [{ key: 'text', label: '目标文本', type: 'text', placeholder: '要滚动到的文字（区分大小写不敏感）' }];
      case 'get_dropdown_options':
        return [
          {
            key: 'selector',
            label: t('workflow_param_selector'),
            type: 'text',
            placeholder: '<select> 元素的 CSS selector',
          },
          {
            key: 'outputVariable',
            label: '输出变量名',
            type: 'text',
            placeholder: '所有选项 JSON 写入此变量',
          },
        ];
      case 'cache_content':
        return [
          { key: 'selector', label: t('workflow_param_selector'), type: 'text', placeholder: 'CSS selector（可选）' },
          { key: 'xpath', label: t('workflow_param_xpath'), type: 'text', placeholder: 'XPath（可选，selector 优先）' },
          { key: 'attribute', label: '读取属性', type: 'text', placeholder: '留空则读 innerText / value' },
          {
            key: 'outputVariable',
            label: '输出变量名',
            type: 'text',
            placeholder: '元素内容写入此变量',
          },
        ];
      default:
        return [];
    }
  };

  const handleActionChange = (newAction: string) => {
    // Switching actions used to wipe the parameters object entirely, which
    // dropped values the user might want to reuse (e.g. selector / xpath are
    // common across click / input / cache_content actions).
    //
    // New behavior: KEEP all existing values, only seed parameters that the
    // new action expects but the previous one didn't have. Fields no longer
    // relevant to the new action stay in `data.parameters` but are not
    // rendered (and not consumed by the executor) — switching back will
    // restore them automatically.
    const prevParams = (editedNode.data.parameters as Record<string, unknown> | undefined) ?? {};
    const newParams: Record<string, unknown> = { ...prevParams };
    for (const field of getActionParameters(newAction)) {
      if (!(field.key in newParams)) {
        newParams[field.key] = field.type === 'number' ? 0 : '';
      }
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

  const handleFieldChange = (
    field: string,
    value: string | number | boolean | Array<{ id: string; name: string }> | Record<string, string>,
  ) => {
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
  const hintClass = `mt-1 text-[11px] leading-snug ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`;

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
                : editedNode.type === 'output'
                  ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
                  : editedNode.type === 'loop'
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                    : editedNode.type === 'note'
                      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      : editedNode.type === 'subflow'
                        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400'
                        : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
          }`}>
          {editedNode.type === 'ai'
            ? t('workflow_nodeType_ai')
            : editedNode.type === 'automation'
              ? t('workflow_nodeType_automation')
              : editedNode.type === 'output'
                ? '输出'
                : editedNode.type === 'loop'
                  ? '循环'
                  : editedNode.type === 'note'
                    ? '备注'
                    : editedNode.type === 'subflow'
                      ? '子流程'
                      : t('workflow_nodeType_condition')}
        </span>
      </div>

      {/* AI Fields */}
      {editedNode.type === 'ai' && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>{t('workflow_aiPrompt')}</label>
            <textarea
              ref={promptRef}
              value={editedNode.data.prompt || ''}
              onChange={e => handleFieldChange('prompt', e.target.value)}
              className={inputClass}
              rows={4}
            />
            {/* Detect ${name} write-targets that haven't been declared in the
                variable list yet. The executor will still write into them at
                runtime (variables are loosely-typed), but declaring them up
                front makes them visible in the side panel, the read-token
                bar, and the storage layer. */}
            <MissingWriteTargetsHint
              prompt={(editedNode.data.prompt as string) || ''}
              variables={variables}
              onAddVariable={onAddVariable}
              isDarkMode={isDarkMode}
            />
            {variables.length > 0 && (
              <div className="mt-1.5 space-y-1">
                <div className="flex flex-wrap items-center gap-1">
                  <span className={`text-[10px] uppercase ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    读取 {'{{ }}'}:
                  </span>
                  {variables.map(v => (
                    <button
                      key={`read-${v.name}`}
                      type="button"
                      onClick={() => {
                        const token = `{{${v.name}}}`;
                        const ta = promptRef.current;
                        if (ta) {
                          const start = ta.selectionStart ?? editedNode.data.prompt?.length ?? 0;
                          const end = ta.selectionEnd ?? start;
                          const cur = editedNode.data.prompt || '';
                          const next = cur.slice(0, start) + token + cur.slice(end);
                          handleFieldChange('prompt', next);
                          requestAnimationFrame(() => {
                            ta.focus();
                            ta.selectionStart = ta.selectionEnd = start + token.length;
                          });
                        } else {
                          handleFieldChange('prompt', (editedNode.data.prompt || '') + token);
                        }
                      }}
                      title={v.description || `Insert {{${v.name}}} (read value)`}
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                        isDarkMode
                          ? 'bg-blue-900/30 text-blue-300 hover:bg-blue-900/60'
                          : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      }`}>
                      {`{{${v.name}}}`}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className={`text-[10px] uppercase ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    写入 ${'{ }'}:
                  </span>
                  {variables.map(v => (
                    <button
                      key={`write-${v.name}`}
                      type="button"
                      onClick={() => {
                        const token = `\${${v.name}}`;
                        const ta = promptRef.current;
                        if (ta) {
                          const start = ta.selectionStart ?? editedNode.data.prompt?.length ?? 0;
                          const end = ta.selectionEnd ?? start;
                          const cur = editedNode.data.prompt || '';
                          const next = cur.slice(0, start) + token + cur.slice(end);
                          handleFieldChange('prompt', next);
                          requestAnimationFrame(() => {
                            ta.focus();
                            ta.selectionStart = ta.selectionEnd = start + token.length;
                          });
                        } else {
                          handleFieldChange('prompt', (editedNode.data.prompt || '') + token);
                        }
                      }}
                      title={`AI will write its corresponding output to variable "${v.name}"`}
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                        isDarkMode
                          ? 'bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/60'
                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      }`}>
                      {`\${${v.name}}`}
                    </button>
                  ))}
                </div>
                <p className={`text-[10px] leading-tight ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  例：将今天天气写入 ${'{content1}'}，明天的写入 ${'{content2}'} → AI 会以 JSON 返回并自动赋值
                </p>
              </div>
            )}
            {variables.length === 0 && <EmptyVariablesHint isDarkMode={isDarkMode} mode="ai" />}
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
              value={(editedNode.data.parameters?.intent as string) || (editedNode.data.intent as string) || ''}
              onChange={e => handleParameterChange('intent', e.target.value)}
              className={inputClass}
              placeholder={t('workflow_intent_placeholder')}
            />
            <div className={`mt-1 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              人类可读的步骤说明，用于日志展示和 AI 润色
            </div>
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
              <option value="wait">{t('workflow_action_wait')}</option>
              <option value="open_tab">{t('workflow_action_openTab')}</option>
              <option value="close_tab">{t('workflow_action_closeTab')}</option>
              <option value="switch_tab">{t('workflow_action_switchTab')}</option>
              <option value="send_keys">{t('workflow_action_sendKeys')}</option>
              <option value="select_dropdown_option">{t('workflow_action_selectDropdown')}</option>
              <option value="scroll_to_text">滚动到文本</option>
              <option value="get_dropdown_options">读取下拉选项</option>
              <option value="cache_content">缓存元素内容</option>
              <option value="generate_image">{t('workflow_action_generateImage')}</option>
            </select>
          </div>
          {actionParamFields.length > 0 && (
            <div
              className={`space-y-2 border-t border-dashed pt-2 ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}`}>
              <div className="flex items-center justify-between">
                <label className={labelClass}>{t('workflow_parameters')}</label>
                {/* "Pick element" only makes sense when this action consumes
                    a selector or xpath. Shown once per parameter block, not
                    per field, since one pick can fill both at the same time. */}
                {actionParamFields.some(f => f.key === 'selector' || f.key === 'xpath') && (
                  <ElementPickerButton
                    isDarkMode={isDarkMode}
                    onPicked={({ selector, xpath }) => {
                      const next = { ...currentParams } as Record<string, unknown>;
                      if (actionParamFields.some(f => f.key === 'selector')) next.selector = selector;
                      if (actionParamFields.some(f => f.key === 'xpath')) next.xpath = xpath;
                      const updated = { ...editedNode, data: { ...editedNode.data, parameters: next } };
                      setEditedNode(updated);
                      onSave(updated);
                    }}
                  />
                )}
              </div>
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
              ref={promptRef}
              value={editedNode.data.prompt || ''}
              onChange={e => handleFieldChange('prompt', e.target.value)}
              className={inputClass}
              rows={3}
              placeholder={t('workflow_conditionExpression')}
            />
            {variables.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className={`text-[10px] uppercase ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  读取 {'{{ }}'}:
                </span>
                {variables.map(v => (
                  <button
                    key={`cond-read-${v.name}`}
                    type="button"
                    onClick={() => {
                      const token = `{{${v.name}}}`;
                      const ta = promptRef.current;
                      if (ta) {
                        const start = ta.selectionStart ?? editedNode.data.prompt?.length ?? 0;
                        const end = ta.selectionEnd ?? start;
                        const cur = editedNode.data.prompt || '';
                        const next = cur.slice(0, start) + token + cur.slice(end);
                        handleFieldChange('prompt', next);
                        requestAnimationFrame(() => {
                          ta.focus();
                          ta.selectionStart = ta.selectionEnd = start + token.length;
                        });
                      } else {
                        handleFieldChange('prompt', (editedNode.data.prompt || '') + token);
                      }
                    }}
                    title={v.description || `Insert {{${v.name}}} (read value)`}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                      isDarkMode
                        ? 'bg-blue-900/30 text-blue-300 hover:bg-blue-900/60'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    }`}>
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
            )}
            {variables.length === 0 && <EmptyVariablesHint isDarkMode={isDarkMode} mode="condition" />}
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
          <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {t('workflow_conditionPortsHint')}
          </p>
        </div>
      )}

      {/* Loop Fields */}
      {editedNode.type === 'loop' && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>循环模式</label>
            <select
              value={(editedNode.data.loopMode as string) || 'fixed'}
              onChange={e => handleFieldChange('loopMode', e.target.value)}
              className={inputClass}>
              <option value="fixed">固定次数</option>
              <option value="ai_judge">AI 判定（带兜底次数）</option>
            </select>
            <p className={hintClass}>
              {(editedNode.data.loopMode as string) === 'ai_judge'
                ? 'AI 每轮判断是否继续，仍受兜底次数限制以避免死循环'
                : '到达指定次数后自动退出循环'}
            </p>
          </div>

          <div>
            <label className={labelClass}>
              {(editedNode.data.loopMode as string) === 'ai_judge' ? '兜底最大次数' : '循环次数'}
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={(editedNode.data.maxIterations as number | undefined) ?? 1}
              onChange={e => handleFieldChange('maxIterations', Math.max(1, Number(e.target.value) || 1))}
              className={inputClass}
            />
            <p className={hintClass}>硬性上限，最大 1000。即使 AI 持续要求继续也会被截断</p>
          </div>

          {(editedNode.data.loopMode as string) === 'ai_judge' && (
            <div>
              <label className={labelClass}>判定 Prompt</label>
              <textarea
                value={(editedNode.data.prompt as string) || ''}
                onChange={e => handleFieldChange('prompt', e.target.value)}
                placeholder='例如：判断 {{result}} 是否已包含 3 条以上有效数据，若已足够请回复 "stop"'
                rows={4}
                className={`${inputClass} font-mono text-xs`}
              />
              <p className={hintClass}>
                可用 <code>{'{{变量名}}'}</code> 引用变量。AI 返回 <code>continue</code> 继续，
                <code>stop</code> 退出（不确定的回答默认按 stop 处理）
              </p>
            </div>
          )}

          <div>
            <label className={labelClass}>迭代变量名（可选）</label>
            <input
              type="text"
              value={(editedNode.data.iterationVariable as string) || ''}
              onChange={e => handleFieldChange('iterationVariable', e.target.value)}
              placeholder="loop"
              className={inputClass}
            />
            <p className={hintClass}>
              填写后将自动暴露 <code>{'{{<name>_iter}}'}</code>（当前轮次，0 起）、
              <code>{'{{<name>_done}}'}</code>、<code>{'{{<name>_total}}'}</code>
            </p>
          </div>

          <div
            className={`rounded-md border p-3 text-xs ${
              isDarkMode ? 'border-slate-600 bg-slate-800/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-600'
            }`}>
            <p className="mb-1 font-semibold">连线说明</p>
            <p className="mb-0.5">
              <span className="font-mono text-green-500">continue ↻</span>（绿色虚线，流动）— 判定继续时进入循环体首节点
            </p>
            <p className="mb-0.5">
              <span className="font-mono text-red-500">exit →</span>（红色实线）— 判定退出或到达上限后的下游节点
            </p>
            <p className="mt-2">
              💡 循环体内部跑完后会<b>自动回到本循环节点</b>，无需手动画回连边。
              左侧的入口连线就是普通的工作流连线（从上游节点连进来）。
            </p>
          </div>
        </div>
      )}

      {/* Note Fields */}
      {editedNode.type === 'note' && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>备注内容</label>
            <textarea
              value={(editedNode.data.content as string) || ''}
              onChange={e => handleFieldChange('content', e.target.value)}
              placeholder="可写多行说明、待办、TODO …"
              rows={6}
              className={inputClass}
            />
            <p className={hintClass}>纯展示，不参与执行，可帮助阅读复杂工作流</p>
          </div>

          <div>
            <label className={labelClass}>颜色</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {(['yellow', 'blue', 'green', 'pink', 'gray'] as const).map(c => {
                const swatch: Record<string, string> = {
                  yellow: '#facc15',
                  blue: '#60a5fa',
                  green: '#4ade80',
                  pink: '#f472b6',
                  gray: '#94a3b8',
                };
                const active = ((editedNode.data.noteColor as string) || 'yellow') === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleFieldChange('noteColor', c)}
                    className={`size-7 rounded-md border-2 transition-all ${active ? 'border-blue-500 shadow-md' : 'border-transparent opacity-70 hover:opacity-100'}`}
                    style={{ background: swatch[c] }}
                    title={c}
                  />
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>宽度 (px)</label>
              <input
                type="number"
                min={120}
                max={600}
                value={(editedNode.data.noteWidth as number | undefined) ?? 220}
                onChange={e => handleFieldChange('noteWidth', Math.max(120, Number(e.target.value) || 220))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>高度 (px)</label>
              <input
                type="number"
                min={80}
                max={600}
                value={(editedNode.data.noteHeight as number | undefined) ?? 120}
                onChange={e => handleFieldChange('noteHeight', Math.max(80, Number(e.target.value) || 120))}
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}

      {/* Subflow Fields */}
      {editedNode.type === 'subflow' && (
        <SubflowFields editedNode={editedNode} onFieldChange={handleFieldChange} isDarkMode={isDarkMode} />
      )}

      {/* Output Fields */}
      {editedNode.type === 'output' && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>显示标签</label>
            <input
              type="text"
              value={(editedNode.data.label as string) || ''}
              onChange={e => handleFieldChange('label', e.target.value)}
              placeholder="如：调研报告、汇总结论"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>输出内容</label>
            <textarea
              ref={promptRef}
              value={(editedNode.data.content as string) || ''}
              onChange={e => handleFieldChange('content', e.target.value)}
              className={inputClass}
              rows={6}
              placeholder="支持 {{变量名}} 模板插值"
            />
            {variables.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className={`text-[10px] uppercase ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  插入变量:
                </span>
                {variables.map(v => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => {
                      const token = `{{${v.name}}}`;
                      const ta = promptRef.current;
                      if (ta) {
                        const start = ta.selectionStart ?? 0;
                        const end = ta.selectionEnd ?? start;
                        const cur = (editedNode.data.content as string) || '';
                        const next = cur.slice(0, start) + token + cur.slice(end);
                        handleFieldChange('content', next);
                        requestAnimationFrame(() => {
                          ta.focus();
                          ta.selectionStart = ta.selectionEnd = start + token.length;
                        });
                      } else {
                        handleFieldChange('content', ((editedNode.data.content as string) || '') + token);
                      }
                    }}
                    title={v.description || `Insert {{${v.name}}}`}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                      isDarkMode
                        ? 'bg-blue-900/30 text-blue-300 hover:bg-blue-900/60'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    }`}>
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
            )}
            {variables.length === 0 && (
              <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                提示：先在「变量管理」面板定义变量，并在 AI 节点的 prompt 中使用 $&#123;变量名&#125; 让 AI 写入。
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Subflow Sub-component ============

interface SubflowFieldsProps {
  editedNode: WorkflowNode;
  onFieldChange: (
    field: string,
    value: string | number | boolean | Array<{ id: string; name: string }> | Record<string, string>,
  ) => void;
  isDarkMode: boolean;
}

/**
 * Subflow editor — picks a target workflow and lets the user wire input/output
 * variable mappings. Variable bindings are stored as `Record<string, string>`:
 *  - inputs:  { childVar: "parentTemplate or parentVarName" }
 *  - outputs: { childVar: "parentVarName" }
 */
function SubflowFields({ editedNode, onFieldChange, isDarkMode }: SubflowFieldsProps) {
  const [workflows, setWorkflows] = useState<UserWorkflowConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    userWorkflowsStore
      .getAllWorkflows()
      .then(list => {
        if (!cancelled) {
          setWorkflows(list);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentId = (editedNode.data.subflowId as string) || '';
  const expanded = Boolean(editedNode.data.subflowExpanded);
  const inputs = (editedNode.data.subflowInputs as Record<string, string>) || {};
  const outputs = (editedNode.data.subflowOutputs as Record<string, string>) || {};
  const target = workflows.find(w => w.id === currentId);

  const inputClass = `mt-1 w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:ring-2 focus:ring-blue-400/50 ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`;
  const labelClass = `text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`;
  const hintClass = `mt-1 text-[11px] leading-snug ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`;

  const updateMap = (field: 'subflowInputs' | 'subflowOutputs', next: Record<string, string>) => {
    onFieldChange(field, next);
  };

  const addRow = (field: 'subflowInputs' | 'subflowOutputs') => {
    const cur = field === 'subflowInputs' ? inputs : outputs;
    // Find first unused key name `var1`, `var2`, ...
    let i = 1;
    while (cur[`var${i}`] !== undefined) i++;
    updateMap(field, { ...cur, [`var${i}`]: '' });
  };

  const removeRow = (field: 'subflowInputs' | 'subflowOutputs', key: string) => {
    const cur = field === 'subflowInputs' ? { ...inputs } : { ...outputs };
    delete cur[key];
    updateMap(field, cur);
  };

  const renameKey = (field: 'subflowInputs' | 'subflowOutputs', oldKey: string, newKey: string) => {
    const cur = field === 'subflowInputs' ? inputs : outputs;
    if (oldKey === newKey || newKey === '' || cur[newKey] !== undefined) return;
    const { [oldKey]: value, ...rest } = cur;
    updateMap(field, { ...rest, [newKey]: value });
  };

  const setValue = (field: 'subflowInputs' | 'subflowOutputs', key: string, value: string) => {
    const cur = field === 'subflowInputs' ? inputs : outputs;
    updateMap(field, { ...cur, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass}>目标工作流</label>
        {loading ? (
          <p className={hintClass}>正在加载工作流列表…</p>
        ) : (
          <select value={currentId} onChange={e => onFieldChange('subflowId', e.target.value)} className={inputClass}>
            <option value="">— 选择一个工作流 —</option>
            {workflows.map(w => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        {currentId && !target && !loading && (
          <p className={`${hintClass} text-yellow-500`}>⚠ 选定的工作流不存在（可能已被删除）</p>
        )}
        {target && (
          <p className={hintClass}>
            {target.nodes.length} 节点 · {target.edges.length} 连线 · {target.variables?.length || 0} 变量
          </p>
        )}
      </div>

      <div>
        <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={expanded}
            onChange={e => onFieldChange('subflowExpanded', e.target.checked)}
            className="size-4"
          />
          画布上展开子流程预览
        </label>
        <p className={hintClass}>勾选后节点会在画布上放大并显示目标工作流的节点/连线缩略图（只读）</p>
      </div>

      <BindingTable
        title="输入映射 (父 → 子)"
        bindings={inputs}
        hint="键 = 子工作流里的变量名;值 = 父工作流的变量名或 {{模板}}"
        labelClass={labelClass}
        inputClass={inputClass}
        hintClass={hintClass}
        onAdd={() => addRow('subflowInputs')}
        onRemove={k => removeRow('subflowInputs', k)}
        onRenameKey={(oldK, newK) => renameKey('subflowInputs', oldK, newK)}
        onChangeValue={(k, v) => setValue('subflowInputs', k, v)}
        valuePlaceholder='例如 "{{topic}}" 或 "topic"'
      />

      <BindingTable
        title="输出映射 (子 → 父)"
        bindings={outputs}
        hint="键 = 子工作流写入的变量名;值 = 写回父工作流的变量名"
        labelClass={labelClass}
        inputClass={inputClass}
        hintClass={hintClass}
        onAdd={() => addRow('subflowOutputs')}
        onRemove={k => removeRow('subflowOutputs', k)}
        onRenameKey={(oldK, newK) => renameKey('subflowOutputs', oldK, newK)}
        onChangeValue={(k, v) => setValue('subflowOutputs', k, v)}
        valuePlaceholder="写到父工作流的变量名"
      />

      <div
        className={`rounded-md border p-3 text-xs ${
          isDarkMode ? 'border-slate-600 bg-slate-800/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-600'
        }`}>
        <p className="mb-1 font-semibold">隔离规则</p>
        <p className="mb-0.5">
          子工作流变量空间默认<b>完全隔离</b>，仅通过输入/输出映射穿透。
        </p>
        <p>检测到循环调用（A → B → A）会立即报错，最多支持 8 层嵌套。</p>
      </div>
    </div>
  );
}

interface BindingTableProps {
  title: string;
  bindings: Record<string, string>;
  hint: string;
  labelClass: string;
  inputClass: string;
  hintClass: string;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onRenameKey: (oldKey: string, newKey: string) => void;
  onChangeValue: (key: string, value: string) => void;
  valuePlaceholder: string;
}

function BindingTable({
  title,
  bindings,
  hint,
  labelClass,
  inputClass,
  hintClass,
  onAdd,
  onRemove,
  onRenameKey,
  onChangeValue,
  valuePlaceholder,
}: BindingTableProps) {
  const entries = Object.entries(bindings);
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className={labelClass}>{title}</label>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500 hover:bg-blue-500/20">
          + 增加
        </button>
      </div>
      {entries.length === 0 ? (
        <p className={hintClass}>{hint}</p>
      ) : (
        <div className="mt-1 space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center gap-1">
              <input
                type="text"
                defaultValue={key}
                onBlur={e => {
                  const next = e.target.value.trim();
                  if (next && next !== key) onRenameKey(key, next);
                  else if (!next) e.target.value = key;
                }}
                placeholder="变量名"
                className={`${inputClass} mt-0 flex-1 font-mono text-xs`}
              />
              <span className="text-xs text-gray-400">=</span>
              <input
                type="text"
                value={value}
                onChange={e => onChangeValue(key, e.target.value)}
                placeholder={valuePlaceholder}
                className={`${inputClass} mt-0 flex-1 font-mono text-xs`}
              />
              <button
                type="button"
                onClick={() => onRemove(key)}
                className="rounded p-1 text-red-500 hover:bg-red-500/10"
                title="删除">
                <FiTrash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <p className={hintClass}>{hint}</p>
        </div>
      )}
    </div>
  );
}

// ============ Missing-Variable Hint (AI prompt ${name}) ============

interface MissingWriteTargetsHintProps {
  prompt: string;
  variables: WorkflowVariable[];
  onAddVariable?: (v: WorkflowVariable) => void;
  isDarkMode: boolean;
}

/**
 * Scans the AI prompt for `${name}` write targets and surfaces a hint when
 * any of those names aren't declared in the workflow's variable list yet.
 * Each missing entry gets a one-click "新建" button that appends a default
 * string variable to the workflow.
 *
 * Notes:
 *  - We only consider VALID identifier names (letters/digits/underscore, not
 *    leading with a digit). This matches what the executor's regex extracts,
 *    so we won't false-positive on shell-like `$VAR` or `${...}` template
 *    leftovers in prompt examples.
 *  - Hint stays invisible while there's nothing to flag — zero noise in
 *    the common case.
 */
function MissingWriteTargetsHint({ prompt, variables, onAddVariable, isDarkMode }: MissingWriteTargetsHintProps) {
  const declared = new Set(variables.map(v => v.name));
  // Mirror the executor's `${name}` matcher (see WorkflowExecutor#extractWriteTargets)
  const re = /\$\{([a-zA-Z_][\w]*)\}/g;
  const seen = new Set<string>();
  const missing: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const name = m[1];
    if (declared.has(name) || seen.has(name)) continue;
    seen.add(name);
    missing.push(name);
  }
  if (missing.length === 0) return null;

  return (
    <div
      className={`mt-1.5 rounded-md border px-2.5 py-1.5 text-[11px] ${
        isDarkMode
          ? 'border-amber-700/50 bg-amber-900/20 text-amber-200'
          : 'border-amber-300 bg-amber-50 text-amber-800'
      }`}>
      <p className="mb-1">
        发现 <b>{missing.length}</b> 个写入变量尚未声明：
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {missing.map(name => (
          <span key={name} className="inline-flex items-center gap-1">
            <code className="rounded bg-current/10 px-1 py-px font-mono text-[10px]">{`\${${name}}`}</code>
            {onAddVariable && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`新建变量 "${name}"（类型 string）？`)) return;
                  onAddVariable({ name, type: 'string', description: 'AI 写入目标' });
                }}
                className={`rounded px-1 py-px text-[10px] underline-offset-1 hover:underline ${
                  isDarkMode ? 'text-amber-300' : 'text-amber-700'
                }`}>
                新建
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

// ============ Empty-Variables Hint ============

/**
 * Shown inside AI / Condition node editors when the workflow has no
 * variables declared yet. Explains the read / write syntax so users
 * discover the variable system from the place they need it.
 *
 * `mode` toggles whether to mention the write-target form (only relevant
 * for the AI prompt, not for condition expressions).
 */
function EmptyVariablesHint({ isDarkMode, mode }: { isDarkMode: boolean; mode: 'ai' | 'condition' }) {
  return (
    <div
      className={`mt-1.5 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug ${
        isDarkMode ? 'border-slate-600 bg-slate-700/40 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-600'
      }`}>
      <p className="mb-1 font-semibold text-current/90">变量用法提示</p>
      <p className="mb-0.5">
        读取变量值：在 prompt 中插入{' '}
        <code className="rounded bg-current/10 px-1 font-mono text-[10px]">{`{{变量名}}`}</code>
      </p>
      {mode === 'ai' && (
        <p className="mb-0.5">
          写入变量：在 prompt 中插入{' '}
          <code className="rounded bg-current/10 px-1 font-mono text-[10px]">{`\${变量名}`}</code>
          ，AI 会按 JSON 返回并自动写入
        </p>
      )}
      <p className="opacity-80">
        在右侧工具栏 <b>变量</b> 面板创建变量后，这里会出现一键插入按钮。
      </p>
    </div>
  );
}

// ============ Element Picker (selector / xpath) ============

interface ElementPickerButtonProps {
  isDarkMode: boolean;
  onPicked: (r: { selector: string; xpath: string; text?: string }) => void;
}

/**
 * Two-step "pick an element from a page" flow:
 *  1. user clicks the picker button → we list http(s) tabs in a modal
 *  2. user picks a tab → background injects an overlay into that page,
 *     waits for the user to click a target, and returns selector + xpath
 *
 * The button shows a small spinner while the picker is waiting on the
 * target page. Esc on the target page cancels and unblocks us.
 */
function ElementPickerButton({ isDarkMode, onPicked }: ElementPickerButtonProps) {
  const [picking, setPicking] = useState(false);
  const [showTabModal, setShowTabModal] = useState(false);
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);

  const openTabPicker = async () => {
    try {
      const all = await chrome.tabs.query({});
      const httpish = all.filter(t => (t.url || '').startsWith('http'));
      setTabs(httpish);
      setShowTabModal(true);
    } catch (e) {
      alert('无法读取标签页列表：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const pickFromTab = async (tabId: number) => {
    setShowTabModal(false);
    setPicking(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'pick_element_start', tabId });
      if (result?.success) {
        onPicked({ selector: result.selector || '', xpath: result.xpath || '', text: result.text });
      } else if (result?.error && result.error !== 'cancelled') {
        alert('拾取失败：' + result.error);
      }
    } finally {
      setPicking(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openTabPicker}
        disabled={picking}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
          isDarkMode
            ? 'bg-blue-900/30 text-blue-300 hover:bg-blue-900/50'
            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
        }`}
        title="选择一个浏览器标签页，然后在页面上点击目标元素以自动填充 selector / xpath">
        {picking ? '拾取中…' : '📍 拾取元素'}
      </button>

      {showTabModal &&
        createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowTabModal(false)} />
            <div
              className={`relative max-h-[70vh] w-[480px] max-w-[90vw] overflow-hidden rounded-lg border shadow-2xl ${
                isDarkMode ? 'border-slate-600 bg-slate-800 text-gray-200' : 'border-gray-200 bg-white text-gray-700'
              }`}>
              <div
                className={`flex items-center justify-between border-b px-4 py-2 ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
                <span className="text-sm font-semibold">选择要拾取元素的标签页</span>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-200"
                  onClick={() => setShowTabModal(false)}>
                  ✕
                </button>
              </div>
              <ul className="max-h-[60vh] overflow-y-auto">
                {tabs.length === 0 && (
                  <li className="px-4 py-8 text-center text-xs opacity-60">没有可用的网页标签页</li>
                )}
                {tabs.map(tab => (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => tab.id !== undefined && pickFromTab(tab.id)}
                      className={`flex w-full items-start gap-2 px-4 py-2 text-left text-xs transition-colors ${
                        isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
                      }`}>
                      {tab.favIconUrl ? (
                        <img src={tab.favIconUrl} alt="" className="mt-0.5 size-4 shrink-0 rounded-sm" />
                      ) : (
                        <span className="mt-0.5 inline-block size-4 shrink-0 rounded-sm bg-current/10" />
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{tab.title || '(无标题)'}</span>
                        <span className="truncate text-[10px] opacity-60">{tab.url}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
