/**
 * Skill Quick Select Component
 * Allows users to quickly select and execute skills from the chat input
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { FiZap, FiSearch, FiPlay, FiX, FiSettings } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { userSkillsStore, type UserSkillConfig } from '@extension/storage';
import type { Skill, SkillParameter } from '@extension/skills';

interface SkillQuickSelectProps {
  isDarkMode?: boolean;
  onExecuteSkill: (skillId: string, params: Record<string, unknown>) => void;
  disabled?: boolean;
  /** 选中的 skill 显示为标签时调用 */
  onSkillSelected?: (skill: Skill | null) => void;
}

export default function SkillQuickSelect({ onExecuteSkill, disabled = false, onSkillSelected }: SkillQuickSelectProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [showParamConfig, setShowParamConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const paramConfigRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load skills on mount
  useEffect(() => {
    const loadSkills = async () => {
      try {
        const storedSkills = await userSkillsStore.getAllSkills();
        console.log('[SkillQuickSelect] Loaded skills:', storedSkills?.length || 0);

        const skillList: Skill[] = (storedSkills || []).map((s: UserSkillConfig) => s as unknown as Skill);
        setSkills(skillList);
      } catch (e) {
        console.error('[SkillQuickSelect] Failed to load skills:', e);
        setSkills([]);
      }
    };
    loadSkills();

    // Subscribe to skill changes
    const unsubscribe = userSkillsStore.subscribe(loadSkills);
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setSearchQuery('');
      }
      if (paramConfigRef.current && !paramConfigRef.current.contains(e.target as Node)) {
        setShowParamConfig(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (showDropdown && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showDropdown]);

  // Calculate dropdown position when opening
  const updateDropdownPosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.top - 10,
        left: rect.right,
      });
    }
  }, []);

  // Handle toggle dropdown
  const handleToggleDropdown = useCallback(() => {
    if (!showDropdown) {
      updateDropdownPosition();
      setSearchQuery('');
    }
    setShowDropdown(!showDropdown);
  }, [showDropdown, updateDropdownPosition]);

  // Handle skill selection (shows as tag, waits for execution)
  const handleSelectSkill = useCallback(
    (skill: Skill) => {
      setSelectedSkill(skill);
      setShowDropdown(false);
      setSearchQuery('');

      // Notify parent about selected skill
      if (onSkillSelected) {
        onSkillSelected(skill);
      }

      // Check if skill has required parameters
      const hasRequiredParams = skill.parameters.some((p: SkillParameter) => p.required);
      if (hasRequiredParams) {
        // Initialize param values with defaults
        const initialParams: Record<string, string> = {};
        skill.parameters.forEach((p: SkillParameter) => {
          if (p.default !== undefined) {
            initialParams[p.name] = String(p.default);
          } else {
            initialParams[p.name] = '';
          }
        });
        setParamValues(initialParams);
        setShowParamConfig(true);
      }
    },
    [onSkillSelected],
  );

  // Handle parameter change
  const handleParamChange = useCallback((paramName: string, value: string) => {
    setParamValues(prev => ({ ...prev, [paramName]: value }));
  }, []);

  // Execute skill with current params
  const handleExecuteSkill = useCallback(() => {
    if (!selectedSkill) return;

    setLoading(true);
    setShowParamConfig(false);

    // Convert param values to proper types
    const params: Record<string, unknown> = {};
    selectedSkill.parameters.forEach((p: SkillParameter) => {
      const value = paramValues[p.name];
      if (value === '' && !p.required) {
        return; // Skip empty optional params
      }
      switch (p.type) {
        case 'number':
          params[p.name] = Number(value) || 0;
          break;
        case 'boolean':
          params[p.name] = value === 'true' || value === '1';
          break;
        case 'array':
          params[p.name] = value.split(',').map(v => v.trim());
          break;
        default:
          params[p.name] = value;
      }
    });

    onExecuteSkill(selectedSkill.id, params);

    // Reset after a short delay
    setTimeout(() => {
      setLoading(false);
      setSelectedSkill(null);
      setParamValues({});
      if (onSkillSelected) {
        onSkillSelected(null);
      }
    }, 500);
  }, [selectedSkill, paramValues, onExecuteSkill, onSkillSelected]);

  // Cancel param config
  const handleCancelParamConfig = useCallback(() => {
    setShowParamConfig(false);
    // Don't clear selected skill - user can still execute it later
  }, []);

  // Filter skills by search query
  const filteredSkills = useCallback(() => {
    if (!searchQuery.trim()) return skills;

    const query = searchQuery.toLowerCase();
    return skills.filter(
      skill =>
        skill.name.toLowerCase().includes(query) ||
        (skill.description && skill.description.toLowerCase().includes(query)) ||
        (skill.category && skill.category.toLowerCase().includes(query)),
    );
  }, [skills, searchQuery]);

  const skillsToShow = filteredSkills();

  return (
    <>
      {/* Skill button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleDropdown}
        disabled={disabled || loading}
        className={`icon-btn rounded-md ${disabled || loading ? 'cursor-not-allowed !opacity-35' : ''}`}
        aria-label={t('skill_quickselect_title')}
        title={t('skill_quickselect_title')}>
        {loading ? <span className="animate-spin">⏳</span> : <FiZap className="size-4" />}
      </button>

      {/* Skill dropdown with search */}
      {showDropdown && !showParamConfig && (
        <div
          ref={dropdownRef}
          className="skill-dropdown"
          style={{
            position: 'fixed',
            top: dropdownPosition.top,
            right: 16,
            transform: 'translateY(-100%)',
            width: 280,
            maxHeight: 228,
            borderRadius: 12,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            zIndex: 9999,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
          {/* Header with search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <FiSearch size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('skill_quickselect_searchPlaceholder')}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            <span className="text-xs opacity-50" style={{ color: 'var(--text-muted)' }}>
              {skillsToShow.length}/{skills.length}
            </span>
          </div>

          {/* Skill list - simplified (name only) */}
          <div className="overflow-y-auto px-1 py-1 flex-1" style={{ maxHeight: 280, minHeight: 100 }}>
            {skillsToShow.length === 0 ? (
              <div className="py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                {searchQuery ? t('skill_quickselect_notFound') : t('skill_quickselect_empty')}
                {!searchQuery && (
                  <>
                    <br />
                    <span className="opacity-70">{t('skill_quickselect_importHint')}</span>
                  </>
                )}
              </div>
            ) : (
              skillsToShow.map(skill => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    handleSelectSkill(skill);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/10 active:bg-white/20"
                  style={{ color: 'var(--text-secondary)' }}>
                  <FiZap size={12} style={{ color: 'var(--accent-color)', opacity: 0.8 }} />
                  <span className="flex-1 truncate text-left" style={{ color: 'var(--text-primary)' }}>
                    {skill.name}
                  </span>
                  {skill.parameters.length > 0 && (
                    <FiSettings size={10} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            className="px-3 py-2 border-t text-xs flex items-center justify-between"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
            <button
              type="button"
              onClick={() => chrome.runtime.openOptionsPage()}
              className="hover:underline flex items-center gap-1">
              <FiSettings size={12} />
              {t('skill_quickselect_manage')}
            </button>
            <button type="button" onClick={() => setShowDropdown(false)} className="hover:underline">
              {t('skill_quickselect_close')}
            </button>
          </div>
        </div>
      )}

      {/* Parameter configuration modal */}
      {showParamConfig && selectedSkill && (
        <div
          ref={paramConfigRef}
          className="skill-param-config"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={e => {
            if (e.target === e.currentTarget) handleCancelParamConfig();
          }}>
          <div
            className="param-config-modal"
            style={{
              width: 320,
              borderRadius: 16,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              padding: 20,
            }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FiZap style={{ color: 'var(--accent-color)' }} />
                <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {selectedSkill.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCancelParamConfig}
                className="p-1 rounded hover:bg-white/10"
                style={{ color: 'var(--text-muted)' }}>
                <FiX size={16} />
              </button>
            </div>

            {/* Description */}
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              {selectedSkill.description}
            </p>

            {/* Parameters */}
            <div className="space-y-3">
              {selectedSkill.parameters.map((param: SkillParameter) => (
                <div key={param.name}>
                  <label className="flex items-center gap-1 text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    <span>{param.description || param.name}</span>
                    {param.required && <span style={{ color: '#EF4444' }}>*</span>}
                  </label>
                  {param.enum ? (
                    <select
                      value={paramValues[param.name] || ''}
                      onChange={e => handleParamChange(param.name, e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={{
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-primary)',
                      }}>
                      <option value="">{t('skill_quickselect_selectPlaceholder')}</option>
                      {param.enum.map(opt => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : param.type === 'boolean' ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleParamChange(param.name, 'true')}
                        className={`px-3 py-1.5 rounded-lg text-xs ${
                          paramValues[param.name] === 'true' ? 'ring-2 ring-green-500' : ''
                        }`}
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                        {t('skill_quickselect_yes')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleParamChange(param.name, 'false')}
                        className={`px-3 py-1.5 rounded-lg text-xs ${
                          paramValues[param.name] === 'false' ? 'ring-2 ring-green-500' : ''
                        }`}
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                        {t('skill_quickselect_no')}
                      </button>
                    </div>
                  ) : (
                    <input
                      type={param.type === 'number' ? 'number' : 'text'}
                      value={paramValues[param.name] || ''}
                      onChange={e => handleParamChange(param.name, e.target.value)}
                      placeholder={
                        param.default ? t('skill_quickselect_defaultPlaceholder', [String(param.default)]) : ''
                      }
                      className="w-full px-3 py-2 rounded-lg text-sm"
                      style={{
                        background: 'var(--bg-input)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={handleCancelParamConfig}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                {t('skill_quickselect_cancel')}
              </button>
              <button
                type="button"
                onClick={handleExecuteSkill}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: 'var(--accent-color)', color: '#fff' }}>
                <FiPlay size={12} />
                {t('skill_quickselect_execute')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Skill Tag Component - displays selected skill like image attachment
 */
export function SkillTag({
  skill,
  onRemove,
  onExecute,
  isDarkMode = false,
}: {
  skill: Skill;
  onRemove: () => void;
  onExecute?: () => void;
  isDarkMode?: boolean;
}) {
  return (
    <div
      className={`relative group flex items-center gap-2 px-2 py-1.5 rounded-md ${
        isDarkMode ? 'bg-slate-700/50' : 'bg-gray-100'
      }`}
      style={{ maxWidth: 200 }}>
      <FiZap size={14} style={{ color: 'var(--accent-color)' }} />
      <div className="flex flex-col text-xs flex-1 min-w-0">
        <span className={`truncate font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{skill.name}</span>
        <span className={`${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {skill.parameters.length > 0
            ? t('skill_quickselect_params', [String(skill.parameters.length)])
            : t('skill_quickselect_readyExecute')}
        </span>
      </div>
      {onExecute && skill.parameters.length === 0 && (
        <button
          type="button"
          onClick={onExecute}
          className="p-1 rounded hover:bg-white/20 transition-opacity"
          style={{ color: 'var(--accent-color)' }}
          title={t('skill_quickselect_executeNow')}>
          <FiPlay size={12} />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        className={`absolute -top-1 -right-1 size-5 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity ${
          isDarkMode ? 'bg-red-500/80 text-white' : 'bg-red-500 text-white'
        }`}
        title={t('skill_quickselect_remove')}>
        ✕
      </button>
    </div>
  );
}
