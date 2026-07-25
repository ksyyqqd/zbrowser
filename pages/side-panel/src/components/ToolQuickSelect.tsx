/**
 * 统一工具快速选择 — 整合 Skill 和 Workflow
 * 替换原来的 SkillQuickSelect + WorkflowQuickSelect，合并为一个入口
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { FiZap } from 'react-icons/fi';
import type { Skill } from '@extension/skills';

interface UserWorkflowConfig {
  id: string;
  name: string;
  description?: string;
}

interface ToolQuickSelectProps {
  isDarkMode?: boolean;
  disabled?: boolean;
  onExecuteSkill?: (skillId: string, params: Record<string, unknown>) => void;
  onSkillSelected?: (skill: Skill | null) => void;
  onExecuteWorkflow?: (workflowId: string) => void;
}

export default function ToolQuickSelect({
  isDarkMode = false,
  disabled = false,
  onExecuteSkill,
  onSkillSelected,
  onExecuteWorkflow,
}: ToolQuickSelectProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState({ bottom: 0, right: 0 });
  const [activeTab, setActiveTab] = useState<'skills' | 'workflows'>('skills');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workflows, setWorkflows] = useState<UserWorkflowConfig[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [showParamConfig, setShowParamConfig] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 加载数据
  useEffect(() => {
    (async () => {
      try {
        const [{ userSkillsStore }, { userWorkflowsStore }] = await Promise.all([
          import('@extension/storage'),
          import('@extension/storage'),
        ]);
        const [loadedSkills, loadedWorkflows] = (await Promise.all([
          userSkillsStore.getAllSkills(),
          userWorkflowsStore.getAllWorkflows(),
        ])) as [Skill[], UserWorkflowConfig[]];
        setSkills(loadedSkills);
        setWorkflows(loadedWorkflows);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // 外部点击关闭
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
        setShowParamConfig(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  // 聚焦搜索
  useEffect(() => {
    if (showDropdown && searchInputRef.current) searchInputRef.current.focus();
  }, [showDropdown]);

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        bottom: window.innerHeight - rect.top + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, []);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    updatePosition();
    setShowDropdown(prev => !prev);
    setSearchQuery('');
    setShowParamConfig(false);
    setSelectedSkill(null);
  }, [disabled, updatePosition]);

  const hasTools = skills.length > 0 || workflows.length > 0;
  if (!hasTools || (!onExecuteSkill && !onExecuteWorkflow)) return null;

  const filteredSkills = skills.filter(
    s =>
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredWorkflows = workflows.filter(
    w =>
      !searchQuery ||
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleSelectSkill = (skill: Skill) => {
    if (skill.parameters.length > 0) {
      setSelectedSkill(skill);
      const initial: Record<string, string> = {};
      skill.parameters.forEach(p => {
        if (p.default !== undefined) initial[p.name] = String(p.default);
      });
      setParamValues(initial);
      setShowParamConfig(true);
    } else {
      // 无参数直接执行
      onExecuteSkill?.(skill.id, {});
      onSkillSelected?.(skill);
      setShowDropdown(false);
    }
  };

  const handleExecuteSkill = () => {
    if (!selectedSkill) return;
    const params: Record<string, unknown> = {};
    selectedSkill.parameters.forEach(p => {
      const val = paramValues[p.name];
      if (val !== undefined && val !== '') {
        if (p.type === 'number') params[p.name] = Number(val);
        else if (p.type === 'boolean') params[p.name] = val === 'true';
        else params[p.name] = val;
      }
    });
    onExecuteSkill?.(selectedSkill.id, params);
    setShowDropdown(false);
    setShowParamConfig(false);
    setSelectedSkill(null);
  };

  const handleExecuteWorkflow = (id: string) => {
    onExecuteWorkflow?.(id);
    setShowDropdown(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`icon-btn rounded-md ${disabled ? 'cursor-not-allowed !opacity-35' : ''}`}
        aria-label="工具"
        title="Skills / Workflows">
        <FiZap className="size-4" />
      </button>

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="fixed z-[9999] overflow-hidden rounded-lg border shadow-2xl"
          style={{
            bottom: dropdownPosition.bottom,
            right: dropdownPosition.right,
            width: 280,
            maxHeight: 380,
            background: isDarkMode ? '#1E1B18' : '#ffffff',
            borderColor: isDarkMode ? 'rgba(116,198,157,0.2)' : 'rgba(139,115,85,0.2)',
          }}>
          {/* 搜索栏 */}
          <div className="border-b p-2" style={{ borderColor: 'var(--border-color)' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索工具..."
              className="w-full rounded-md px-2 py-1.5 text-xs outline-none"
              style={{
                background: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {/* Tab 切换 */}
          {skills.length > 0 && workflows.length > 0 && (
            <div className="flex border-b" style={{ borderColor: 'var(--border-color)' }}>
              {(['skills', 'workflows'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    color: activeTab === tab ? 'var(--accent-color)' : 'var(--text-muted)',
                    borderBottom: activeTab === tab ? '2px solid var(--accent-color)' : '2px solid transparent',
                  }}>
                  {tab === 'skills'
                    ? `⚡ Skills (${filteredSkills.length})`
                    : `🔄 Workflows (${filteredWorkflows.length})`}
                </button>
              ))}
            </div>
          )}

          {/* 列表区域 */}
          <div className="max-h-[280px] overflow-y-auto p-1">
            {activeTab === 'skills' && !showParamConfig && (
              <>
                {filteredSkills.length === 0 ? (
                  <div className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    {searchQuery ? '无匹配 Skill' : '暂无 Skill，去设置页创建'}
                  </div>
                ) : (
                  filteredSkills.map(skill => (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => handleSelectSkill(skill)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-card-hover)]"
                      style={{ color: 'var(--text-primary)' }}>
                      <span className="shrink-0">⚡</span>
                      <span className="truncate font-medium">{skill.name}</span>
                      {skill.parameters.length > 0 && (
                        <span
                          className="ml-auto shrink-0 rounded px-1 text-[10px]"
                          style={{
                            background: isDarkMode ? 'rgba(116,198,157,0.15)' : 'rgba(64,145,108,0.1)',
                            color: 'var(--accent-color)',
                          }}>
                          参数
                        </span>
                      )}
                    </button>
                  ))
                )}
              </>
            )}

            {activeTab === 'skills' && showParamConfig && selectedSkill && (
              <div className="p-2">
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowParamConfig(false);
                      setSelectedSkill(null);
                    }}
                    className="text-xs"
                    style={{ color: 'var(--accent-color)' }}>
                    ← 返回
                  </button>
                  <span className="truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    {selectedSkill.name}
                  </span>
                </div>
                {selectedSkill.parameters.map(p => (
                  <div key={p.name} className="mb-2">
                    <label className="mb-0.5 block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {p.name} {p.required && <span style={{ color: '#EF4444' }}>*</span>}
                    </label>
                    {p.type === 'boolean' ? (
                      <select
                        value={paramValues[p.name] || ''}
                        onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                        className="w-full rounded border px-2 py-1 text-xs"
                        style={{
                          borderColor: 'var(--border-color)',
                          background: isDarkMode ? 'rgba(255,255,255,0.06)' : '#fff',
                          color: 'var(--text-primary)',
                        }}>
                        <option value="">-- 选择 --</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        type={p.type === 'number' ? 'number' : 'text'}
                        value={paramValues[p.name] || ''}
                        onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                        placeholder={p.description || p.name}
                        className="w-full rounded border px-2 py-1 text-xs"
                        style={{
                          borderColor: 'var(--border-color)',
                          background: isDarkMode ? 'rgba(255,255,255,0.06)' : '#fff',
                          color: 'var(--text-primary)',
                        }}
                      />
                    )}
                  </div>
                ))}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowParamConfig(false);
                      setSelectedSkill(null);
                    }}
                    className="flex-1 rounded-md border px-3 py-1.5 text-xs"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteSkill}
                    className="jade-btn flex-1 rounded-md px-3 py-1.5 text-xs">
                    执行
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'workflows' && (
              <>
                {filteredWorkflows.length === 0 ? (
                  <div className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    {searchQuery ? '无匹配 Workflow' : '暂无 Workflow，去设置页创建'}
                  </div>
                ) : (
                  filteredWorkflows.map(wf => (
                    <button
                      key={wf.id}
                      type="button"
                      onClick={() => handleExecuteWorkflow(wf.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-card-hover)]"
                      style={{ color: 'var(--text-primary)' }}>
                      <span className="shrink-0">🔄</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{wf.name}</span>
                        {wf.description && (
                          <span className="block truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {wf.description}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px]" style={{ color: 'var(--accent-color)' }}>
                        执行 →
                      </span>
                    </button>
                  ))
                )}
              </>
            )}
          </div>

          {/* 底部 */}
          <div className="flex items-center gap-2 border-t px-2 py-1.5" style={{ borderColor: 'var(--border-color)' }}>
            <button
              type="button"
              onClick={() => {
                chrome.runtime.openOptionsPage();
                setShowDropdown(false);
              }}
              className="text-[10px] transition-opacity hover:underline"
              style={{ color: 'var(--text-muted)' }}>
              管理工具
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setShowDropdown(false)}
              className="rounded px-1.5 py-0.5 text-[10px]"
              style={{ color: 'var(--text-muted)' }}>
              Esc
            </button>
          </div>
        </div>
      )}
    </>
  );
}
