/**
 * Workflow Quick Select Component
 * Allows users to quickly select and execute workflows from the chat input
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { FiShare2, FiSearch, FiPlay, FiSettings } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { userWorkflowsStore, type UserWorkflowConfig } from '@extension/storage';

interface WorkflowQuickSelectProps {
  isDarkMode?: boolean;
  onExecuteWorkflow: (workflowId: string) => void;
  disabled?: boolean;
}

export default function WorkflowQuickSelect({ onExecuteWorkflow, disabled = false }: WorkflowQuickSelectProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [workflows, setWorkflows] = useState<UserWorkflowConfig[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load workflows on mount
  useEffect(() => {
    const loadWorkflows = async () => {
      try {
        const storedWorkflows = await userWorkflowsStore.getAllWorkflows();
        console.log('[WorkflowQuickSelect] Loaded workflows:', storedWorkflows?.length || 0);
        setWorkflows(storedWorkflows || []);
      } catch (e) {
        console.error('[WorkflowQuickSelect] Failed to load workflows:', e);
        setWorkflows([]);
      }
    };
    loadWorkflows();

    // Subscribe to workflow changes
    const unsubscribe = userWorkflowsStore.subscribe(loadWorkflows);
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

  // Handle workflow execution
  const handleExecuteWorkflow = useCallback(
    (workflow: UserWorkflowConfig) => {
      setShowDropdown(false);
      setSearchQuery('');
      onExecuteWorkflow(workflow.id);
    },
    [onExecuteWorkflow],
  );

  // Open options page at workflows tab
  const handleManageWorkflows = useCallback(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html?tab=workflows') });
    setShowDropdown(false);
  }, []);

  // Filter workflows by search query
  const filteredWorkflows = useCallback(() => {
    if (!searchQuery.trim()) return workflows;

    const query = searchQuery.toLowerCase();
    return workflows.filter(
      workflow =>
        workflow.name.toLowerCase().includes(query) ||
        (workflow.description && workflow.description.toLowerCase().includes(query)),
    );
  }, [workflows, searchQuery]);

  const workflowsToShow = filteredWorkflows();

  return (
    <>
      {/* Workflow button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleDropdown}
        disabled={disabled}
        className={`icon-btn rounded-md ${disabled ? 'cursor-not-allowed !opacity-35' : ''}`}
        aria-label={t('workflow_quickselect_title')}
        title={t('workflow_quickselect_title')}>
        <FiShare2 className="size-4" />
      </button>

      {/* Workflow dropdown with search */}
      {showDropdown && (
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
              placeholder={t('workflow_quickselect_searchPlaceholder')}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            <span className="text-xs opacity-50" style={{ color: 'var(--text-muted)' }}>
              {workflowsToShow.length}/{workflows.length}
            </span>
          </div>

          {/* Workflow list */}
          <div className="overflow-y-auto px-1 py-1 flex-1" style={{ maxHeight: 280, minHeight: 100 }}>
            {workflowsToShow.length === 0 ? (
              <div className="py-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                {searchQuery ? t('workflow_quickselect_notFound') : t('workflow_quickselect_empty')}
              </div>
            ) : (
              workflowsToShow.map(workflow => (
                <button
                  key={workflow.id}
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    handleExecuteWorkflow(workflow);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors cursor-pointer hover:bg-white/10 active:bg-white/20"
                  style={{ color: 'var(--text-secondary)' }}>
                  <FiShare2 size={12} style={{ color: 'var(--accent-color)', opacity: 0.8 }} />
                  <div className="flex-1 min-w-0">
                    <span className="truncate text-left block" style={{ color: 'var(--text-primary)' }}>
                      {workflow.name}
                    </span>
                    {workflow.description && (
                      <span
                        className="truncate text-left block text-xs opacity-60"
                        style={{ color: 'var(--text-muted)' }}>
                        {workflow.description}
                      </span>
                    )}
                  </div>
                  <FiPlay size={12} style={{ color: 'var(--accent-color)', opacity: 0.6 }} className="shrink-0" />
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            className="px-3 py-2 border-t text-xs flex items-center justify-between"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
            <button type="button" onClick={handleManageWorkflows} className="hover:underline flex items-center gap-1">
              <FiSettings size={12} />
              {t('workflow_quickselect_manage')}
            </button>
            <button type="button" onClick={() => setShowDropdown(false)} className="hover:underline">
              {t('workflow_quickselect_close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
