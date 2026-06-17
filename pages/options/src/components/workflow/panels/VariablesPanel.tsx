/**
 * VariablesPanel
 *
 * Right-side panel that lets the user manage workflow-level variables
 * (`Workflow.variables`). Each variable has a name, type, optional default
 * value and description. Variables can later be referenced via `{{name}}`
 * in AI prompts and Automation parameters, or set as outputs of AI nodes.
 */
import { useEffect, useState } from 'react';
import { FiTrash2, FiPlus } from 'react-icons/fi';
import type { WorkflowVariable } from '@extension/workflow';

interface VariablesPanelProps {
  variables: WorkflowVariable[];
  onChange: (variables: WorkflowVariable[]) => void;
  isDarkMode: boolean;
}

const VARIABLE_TYPES: WorkflowVariable['type'][] = ['string', 'number', 'boolean', 'array', 'object'];

function newBlankVariable(): WorkflowVariable {
  return { name: '', type: 'string', description: '', required: false, default: undefined };
}

function parseDefaultValue(raw: string, type: WorkflowVariable['type']): unknown {
  if (raw === '') return undefined;
  switch (type) {
    case 'number': {
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n;
    }
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'array':
    case 'object':
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}

function stringifyDefault(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function VariablesPanel({ variables, onChange, isDarkMode }: VariablesPanelProps) {
  const [items, setItems] = useState<WorkflowVariable[]>(variables);

  useEffect(() => {
    setItems(variables);
  }, [variables]);

  const update = (next: WorkflowVariable[]) => {
    setItems(next);
    onChange(next);
  };

  const updateAt = (idx: number, patch: Partial<WorkflowVariable>) => {
    const next = items.map((v, i) => (i === idx ? { ...v, ...patch } : v));
    update(next);
  };

  const removeAt = (idx: number) => {
    update(items.filter((_, i) => i !== idx));
  };

  const addNew = () => {
    update([...items, newBlankVariable()]);
  };

  const inputClass = `mt-1 w-full rounded-md border px-2 py-1 text-sm transition-colors focus:ring-2 focus:ring-blue-400/50 ${
    isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
  }`;
  const labelClass = `text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`;

  return (
    <div className="space-y-3 p-4">
      <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        定义工作流变量。在 AI prompt 或自动化参数中用 <code className="font-mono">{'{{name}}'}</code> 引用。
      </p>

      {items.length === 0 && (
        <div
          className={`rounded-md border border-dashed px-3 py-6 text-center text-xs ${
            isDarkMode ? 'border-slate-600 text-gray-500' : 'border-gray-300 text-gray-400'
          }`}>
          暂无变量，点击下方按钮添加
        </div>
      )}

      {items.map((v, idx) => (
        <div
          key={idx}
          className={`space-y-2 rounded-md border p-2.5 ${
            isDarkMode ? 'border-slate-600 bg-slate-700/40' : 'border-gray-200 bg-gray-50'
          }`}>
          <div className="flex items-center gap-2">
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded text-xs font-semibold ${
                isDarkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'
              }`}>
              {idx + 1}
            </span>
            <input
              type="text"
              value={v.name}
              onChange={e => updateAt(idx, { name: e.target.value })}
              placeholder="variable_name"
              className={`flex-1 rounded-md border px-2 py-1 font-mono text-sm focus:ring-2 focus:ring-blue-400/50 ${
                isDarkMode ? 'border-slate-600 bg-slate-800 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}
            />
            <button
              type="button"
              onClick={() => removeAt(idx)}
              className="rounded-md p-1 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
              title="删除变量">
              <FiTrash2 className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>类型</label>
              <select
                value={v.type}
                onChange={e => updateAt(idx, { type: e.target.value as WorkflowVariable['type'] })}
                className={inputClass}>
                {VARIABLE_TYPES.map(tp => (
                  <option key={tp} value={tp}>
                    {tp}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>默认值</label>
              <input
                type="text"
                value={stringifyDefault(v.default)}
                onChange={e => updateAt(idx, { default: parseDefaultValue(e.target.value, v.type) })}
                placeholder={v.type === 'string' ? '' : v.type === 'boolean' ? 'true / false' : v.type}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>描述</label>
            <input
              type="text"
              value={v.description || ''}
              onChange={e => updateAt(idx, { description: e.target.value })}
              placeholder="（可选）这个变量代表什么？"
              className={inputClass}
            />
          </div>
          <label className={`flex items-center gap-2 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            <input
              type="checkbox"
              checked={v.required ?? false}
              onChange={e => updateAt(idx, { required: e.target.checked })}
              className="rounded"
            />
            必填
          </label>
        </div>
      ))}

      <button
        type="button"
        onClick={addNew}
        className={`flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
          isDarkMode ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}>
        <FiPlus className="size-3.5" />
        添加变量
      </button>
    </div>
  );
}
