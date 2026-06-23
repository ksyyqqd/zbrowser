/**
 * VariablesPanel
 *
 * Right-side panel that lets the user manage workflow-level variables
 * (`Workflow.variables`). Each variable has a name, type, optional default
 * value and description. Variables can later be referenced via `{{name}}`
 * in AI prompts and Automation parameters, or set as outputs of AI nodes.
 */
import { useEffect, useMemo, useState } from 'react';
import { FiTrash2, FiPlus, FiAlertCircle } from 'react-icons/fi';
import type { WorkflowVariable } from '@extension/workflow';

interface VariablesPanelProps {
  variables: WorkflowVariable[];
  onChange: (variables: WorkflowVariable[]) => void;
  isDarkMode: boolean;
  /**
   * Names of variables referenced anywhere in the workflow (prompts,
   * automation params, output templates, ...). Used to surface a "未使用"
   * badge for variables the user declared but never wired up.
   * Defaults to an empty set if the parent doesn't compute usage.
   */
  usedVariableNames?: Set<string>;
}

const VARIABLE_TYPES: WorkflowVariable['type'][] = ['string', 'number', 'boolean', 'array', 'object'];

// Identifier rule mirroring the executor's read/write template regex —
// keeps the variable name compatible with `{{name}}` and `${name}` syntax.
const NAME_RE = /^[a-zA-Z_][\w]*$/;

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

export function VariablesPanel({ variables, onChange, isDarkMode, usedVariableNames }: VariablesPanelProps) {
  const [items, setItems] = useState<WorkflowVariable[]>(variables);

  useEffect(() => {
    setItems(variables);
  }, [variables]);

  // Per-row validation flags computed once per render:
  //  - nameEmpty: name is blank → highlight red, exclude on save
  //  - nameDup:   another row already uses the same name → warn red
  //  - nameInvalid: contains characters {{name}}/${name} syntax doesn't allow
  //  - unused:    declared but never referenced anywhere in the workflow
  const validation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      const k = (it.name || '').trim();
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return items.map(it => {
      const name = (it.name || '').trim();
      return {
        nameEmpty: name === '',
        nameDup: name !== '' && (counts.get(name) ?? 0) > 1,
        nameInvalid: name !== '' && !NAME_RE.test(name),
        unused: name !== '' && usedVariableNames !== undefined && !usedVariableNames.has(name),
      };
    });
  }, [items, usedVariableNames]);

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

      {items.map((v, idx) => {
        const flags = validation[idx];
        const nameInputCls = `flex-1 rounded-md border px-2 py-1 font-mono text-sm focus:ring-2 ${
          flags.nameEmpty || flags.nameDup || flags.nameInvalid
            ? `border-red-400 focus:ring-red-400/50 ${isDarkMode ? 'bg-red-900/10 text-red-200' : 'bg-red-50 text-red-700'}`
            : `${isDarkMode ? 'border-slate-600 bg-slate-800 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} focus:ring-blue-400/50`
        }`;
        return (
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
                className={nameInputCls}
              />
              {flags.unused && !flags.nameEmpty && !flags.nameDup && !flags.nameInvalid && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    isDarkMode ? 'bg-amber-900/30 text-amber-300' : 'bg-amber-100 text-amber-700'
                  }`}
                  title="此变量没有在任何节点中被引用">
                  未使用
                </span>
              )}
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="rounded-md p-1 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
                title="删除变量">
                <FiTrash2 className="size-3.5" />
              </button>
            </div>
            {/* Inline name validation messages */}
            {(flags.nameEmpty || flags.nameDup || flags.nameInvalid) && (
              <p className="-mt-1 flex items-center gap-1 text-[11px] text-red-500">
                <FiAlertCircle className="size-3" />
                {flags.nameEmpty
                  ? '名称不能为空，保存时此变量会被丢弃'
                  : flags.nameDup
                    ? '名称重复，请改成唯一的名字'
                    : '名称只能包含字母、数字和下划线，且不能以数字开头'}
              </p>
            )}
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
            <label
              className={`flex items-center gap-2 text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}
              title="勾选后，启动工作流时必须为此变量提供值（来自默认值或调用方），否则会立即报错">
              <input
                type="checkbox"
                checked={v.required ?? false}
                onChange={e => updateAt(idx, { required: e.target.checked })}
                className="rounded"
              />
              必填（启动时必须有值）
            </label>
          </div>
        );
      })}

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
