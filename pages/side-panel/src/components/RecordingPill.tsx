/**
 * RecordingPill - 精简版录制组件
 *
 * 浮动药丸样式的录制控件，替代旧 RecordingControl（1605 行）。
 *
 * 设计要点：
 * - 状态机：idle → recording → stopped → idle
 * - idle 阶段：渲染 header 触发按钮
 * - recording/stopped 阶段：浮动 Pill（紧凑 + 展开两态）
 * - 仅保留主路径：录制 → 停止 → 保存为工作流（→ 跳转编辑器）
 * - ✕ 关闭即丢弃
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiVideo, FiVideoOff, FiX, FiSave, FiSquare } from 'react-icons/fi';

interface RecordingSession {
  id: string;
  tabId: number;
  tabIds?: number[];
  activeTabId?: number;
  startedAt: number;
  endedAt?: number;
  actions: RecordedAction[];
  status: 'recording' | 'stopped' | 'completed';
}

interface RecordedAction {
  id: string;
  type:
    | 'click'
    | 'input'
    | 'scroll'
    | 'keydown'
    | 'navigate'
    | 'select'
    | 'copy'
    | 'paste'
    | 'cut'
    | 'tab_open'
    | 'tab_switch'
    | 'tab_close';
  timestamp: number;
  tabId?: number;
  tabInfo?: { url?: string; title?: string; openerTabId?: number };
  element?: {
    tagName: string;
    primary: string;
    textContent?: string;
    xpath?: string;
    fallbacks?: string[];
    attributes?: Record<string, string>;
  };
  value?: string;
  keys?: string;
  scrollInfo?: { yPercent?: number };
  navigateInfo?: { url: string; title: string };
  selectionInfo?: { text: string; length: number };
  pasteInfo?: { length: number; isImage: boolean };
  cutInfo?: { length: number };
  pageUrl: string;
  pageTitle: string;
}

interface RecordingPillProps {
  isDarkMode?: boolean;
  /** Port from SidePanel; updated via state mirror so this component re-renders when connection is established */
  port: chrome.runtime.Port | null;
  /** Always-fresh accessor for the underlying port ref (handles reconnections after disconnect) */
  getPort?: () => chrome.runtime.Port | null;
  onRecordingChange?: (isRecording: boolean) => void;
}

const STORAGE_KEY_POS = 'recordingPillPos';

const ACTION_ICON: Record<RecordedAction['type'], string> = {
  navigate: '🌐',
  click: '👆',
  input: '⌨',
  keydown: '⏎',
  scroll: '↕',
  select: '☑',
  copy: '📋',
  paste: '📎',
  cut: '✂',
  tab_open: '🗂',
  tab_switch: '🔀',
  tab_close: '❎',
};

function actionToSkillAction(type: RecordedAction['type']): string {
  switch (type) {
    case 'navigate':
      return 'go_to_url';
    case 'click':
      return 'click_element';
    case 'input':
      return 'input_text';
    case 'keydown':
      return 'send_keys';
    case 'scroll':
      return 'scroll_to_percent';
    case 'select':
      return 'select_dropdown_option';
    case 'copy':
      return 'copy_text';
    case 'paste':
      return 'paste_text';
    case 'cut':
      return 'cut_text';
    case 'tab_open':
      return 'open_tab';
    case 'tab_switch':
      return 'switch_tab';
    case 'tab_close':
      return 'close_tab';
    default:
      return 'wait';
  }
}

function actionToParams(a: RecordedAction): Record<string, unknown> {
  switch (a.type) {
    case 'navigate':
      return { intent: `Navigate to ${a.navigateInfo?.url}`, url: a.navigateInfo?.url || a.pageUrl };
    case 'click':
      return {
        intent: a.element?.textContent ? `Click "${a.element.textContent.slice(0, 30)}"` : 'Click element',
        selector: a.element?.primary,
        xpath: a.element?.xpath,
        fallbacks: a.element?.fallbacks ?? [],
        attributes: { ...(a.element?.attributes ?? {}), tagName: a.element?.tagName ?? '' },
      };
    case 'input':
      return {
        intent: 'Input text',
        selector: a.element?.primary,
        xpath: a.element?.xpath,
        fallbacks: a.element?.fallbacks ?? [],
        attributes: { ...(a.element?.attributes ?? {}), tagName: a.element?.tagName ?? '' },
        text: a.value,
      };
    case 'keydown':
      return { intent: a.keys === 'Enter' ? 'Submit or confirm' : `Send key ${a.keys}`, keys: a.keys };
    case 'scroll':
      return { intent: 'Scroll page', yPercent: a.scrollInfo?.yPercent || 50 };
    case 'select':
      return {
        intent: 'Select option',
        selector: a.element?.primary,
        xpath: a.element?.xpath,
        fallbacks: a.element?.fallbacks ?? [],
        attributes: { ...(a.element?.attributes ?? {}), tagName: a.element?.tagName ?? '' },
        text: a.value,
      };
    case 'copy':
      return { intent: 'Copy content', selectionInfo: a.selectionInfo };
    case 'paste':
      return { intent: 'Paste content', text: a.value, pasteInfo: a.pasteInfo };
    case 'cut':
      return { intent: 'Cut content', cutInfo: a.cutInfo };
    case 'tab_open':
      return { intent: `Open new tab: ${a.tabInfo?.title || a.tabInfo?.url || ''}`, url: a.tabInfo?.url || '' };
    case 'tab_switch':
      return { intent: `Switch to tab: ${a.tabInfo?.title || a.tabInfo?.url || ''}`, url: a.tabInfo?.url || '' };
    case 'tab_close':
      return { intent: 'Close tab' };
    default:
      return { intent: 'Wait', seconds: 1 };
  }
}

function actionLabel(a: RecordedAction): string {
  switch (a.type) {
    case 'navigate':
      return a.navigateInfo?.title?.slice(0, 30) || a.pageUrl?.slice(0, 30) || 'Page';
    case 'click':
      return `点击 "${a.element?.textContent?.slice(0, 24) || a.element?.tagName || '元素'}"`;
    case 'input':
      return `输入 "${(a.value || '').slice(0, 20)}"`;
    case 'keydown':
      return a.keys === 'Enter' ? '回车' : `按键 ${a.keys}`;
    case 'scroll':
      return `滚动至 ${a.scrollInfo?.yPercent || 50}%`;
    case 'select':
      return `选择 "${(a.value || '').slice(0, 20)}"`;
    case 'copy':
      return `复制 "${(a.value || a.selectionInfo?.text || '').slice(0, 20)}"`;
    case 'paste':
      return `粘贴 "${(a.value || '').slice(0, 20)}"`;
    case 'cut':
      return `剪切 "${(a.value || '').slice(0, 20)}"`;
    case 'tab_open':
      return `新标签页 "${a.tabInfo?.title?.slice(0, 24) || a.tabInfo?.url?.slice(0, 24) || ''}"`;
    case 'tab_switch':
      return `切换标签 "${a.tabInfo?.title?.slice(0, 24) || a.tabInfo?.url?.slice(0, 24) || ''}"`;
    case 'tab_close':
      return '关闭标签页';
    default:
      return a.type;
  }
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function RecordingPill({ isDarkMode = false, port, getPort, onRecordingChange }: RecordingPillProps) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'stopped'>('idle');
  const [expanded, setExpanded] = useState(false);
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [pillPos, setPillPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_POS);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const portRef = useRef<chrome.runtime.Port | null>(port);
  const [portReady, setPortReady] = useState<boolean>(!!port);
  const dragStateRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // Notify parent on phase change
  useEffect(() => {
    onRecordingChange?.(phase === 'recording');
  }, [phase, onRecordingChange]);

  // Resolve port: prefer the prop (state-mirrored from SidePanel), fall back to live getter
  const resolvePort = useCallback((): chrome.runtime.Port | null => {
    return port || getPort?.() || portRef.current;
  }, [port, getPort]);

  // Establish a port if none provided by parent (or sync when parent provides one)
  useEffect(() => {
    const resolved = resolvePort();
    if (resolved) {
      portRef.current = resolved;
      setPortReady(true);
      return;
    }
    // No port from parent and no live ref — establish our own as fallback
    if (!portRef.current) {
      try {
        portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });
        setPortReady(true);
      } catch (e) {
        console.error('[RecordingPill] Failed to connect:', e);
        setPortReady(false);
      }
    }
  }, [port, resolvePort]);

  // Timer for recording
  useEffect(() => {
    if (phase !== 'recording' || !session) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - session.startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, session]);

  // Listen to port messages for recording state changes
  useEffect(() => {
    const p = portRef.current;
    if (!p) return;
    const onMessage = (msg: { type?: string; session?: RecordingSession; error?: string }) => {
      if (!msg?.type) return;
      switch (msg.type) {
        case 'recording_started':
          if (msg.session) {
            setSession(msg.session);
            setPhase('recording');
            setExpanded(true);
            setError(null);
          }
          break;
        case 'recording_stopped':
          if (msg.session) {
            setSession(msg.session);
            // Auto-skip if no actions recorded
            if (msg.session.actions.length === 0) {
              setPhase('idle');
              setSession(null);
              setExpanded(false);
            } else {
              setPhase('stopped');
              setExpanded(true);
            }
          }
          break;
        case 'recording_state_update':
          if (msg.session) setSession(msg.session);
          break;
        case 'recording_state':
          if (msg.session?.status === 'recording') {
            setSession(msg.session);
            setPhase('recording');
          }
          break;
        case 'error':
          setError(msg.error || '录制错误');
          break;
      }
    };
    try {
      p.onMessage.addListener(onMessage);
    } catch {
      /* port may already be disconnected */
    }
    return () => {
      try {
        p.onMessage.removeListener(onMessage);
      } catch {
        /* ignore */
      }
    };
  }, [port]);

  const handleStart = useCallback(async () => {
    setError(null);
    // Resolve the active port (prefer parent's port which is also background's currentPort)
    let p = resolvePort();
    if (!p) {
      try {
        p = chrome.runtime.connect({ name: 'side-panel-connection' });
        portRef.current = p;
        setPortReady(true);
      } catch {
        setError('连接未建立');
        return;
      }
    }
    portRef.current = p;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        setError('未找到活动标签页');
        return;
      }
      if (!activeTab.url?.startsWith('http')) {
        setError('只能在 http(s) 网页上录制');
        return;
      }
      try {
        portRef.current.postMessage({ type: 'start_recording', tabId: activeTab.id });
      } catch {
        // Port closed — reconnect
        portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });
        portRef.current.postMessage({ type: 'start_recording', tabId: activeTab.id });
      }
      // Optimistically flip — actual confirmation comes via 'recording_started'
      setPhase('recording');
      setExpanded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动录制失败');
    }
  }, [resolvePort]);

  const handleStop = useCallback(() => {
    try {
      portRef.current?.postMessage({ type: 'stop_recording' });
    } catch {
      /* ignore */
    }
  }, []);

  const handleClose = useCallback(() => {
    // Discard the pill: stop and reset
    if (phase === 'recording') {
      try {
        portRef.current?.postMessage({ type: 'stop_recording' });
      } catch {
        /* ignore */
      }
    }
    setPhase('idle');
    setSession(null);
    setExpanded(false);
    setShowSaveDialog(false);
    setError(null);
  }, [phase]);

  const handleOpenSaveDialog = useCallback(() => {
    if (!session) return;
    const defaultName = `录制任务 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    setSaveName(defaultName);
    setSaveDesc('');
    setShowSaveDialog(true);
  }, [session]);

  const handleSaveAsWorkflow = useCallback(async () => {
    if (!session || !saveName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { userWorkflowsStore } = await import('@extension/storage');
      const { convertSkillToWorkflow } = await import('@extension/workflow');
      const sourceSteps = session.actions.map((a, idx) => ({
        id: `step-${idx}`,
        action: actionToSkillAction(a.type),
        description: actionLabel(a),
        parameters: actionToParams(a),
        onError: 'stop' as const,
      }));
      const skill = {
        id: `skill-${Date.now()}`,
        name: saveName.trim(),
        description: saveDesc.trim() || `录制的自动化: ${saveName.trim()}`,
        version: '1.0.0',
        category: 'recorded',
        author: 'recorder',
        tags: [] as string[],
        parameters: [] as Array<{
          name: string;
          type: 'string' | 'number' | 'boolean' | 'array' | 'object';
          description?: string;
          required?: boolean;
          default?: unknown;
        }>,
        steps: sourceSteps,
        executionMode: 'expanded' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const workflow = convertSkillToWorkflow(skill as unknown as Parameters<typeof convertSkillToWorkflow>[0]);
      const workflowId = `recorded-${Date.now()}`;
      await userWorkflowsStore.addWorkflow({
        id: workflowId,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        nodes: workflow.nodes,
        edges: workflow.edges,
        variables: workflow.variables,
        executionConfig: workflow.executionConfig,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Reset state and open editor
      setShowSaveDialog(false);
      setSession(null);
      setPhase('idle');
      setExpanded(false);
      setSaving(false);
      const optionsUrl = chrome.runtime.getURL(`options/index.html?tab=workflows&editWorkflow=${workflowId}`);
      chrome.tabs.create({ url: optionsUrl });
    } catch (e) {
      console.error('[RecordingPill] Save failed:', e);
      setError(e instanceof Error ? e.message : '保存失败');
      setSaving(false);
    }
  }, [session, saveName, saveDesc]);

  // Drag handlers (header strip is the drag handle)
  const onDragStart = (e: React.MouseEvent) => {
    if (!pillPos) {
      // First drag — capture current rect-relative origin (top-right default)
      const target = e.currentTarget as HTMLElement;
      const parent = target.closest<HTMLElement>('.recording-pill-root');
      const rect = parent?.getBoundingClientRect();
      if (rect) setPillPos({ x: rect.left, y: rect.top });
    }
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: pillPos?.x ?? 0,
      baseY: pillPos?.y ?? 0,
    };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  };
  const onDragMove = (e: MouseEvent) => {
    const s = dragStateRef.current;
    if (!s) return;
    const x = Math.max(8, Math.min(window.innerWidth - 80, s.baseX + (e.clientX - s.startX)));
    const y = Math.max(8, Math.min(window.innerHeight - 60, s.baseY + (e.clientY - s.startY)));
    setPillPos({ x, y });
  };
  const onDragEnd = () => {
    dragStateRef.current = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    if (pillPos) {
      try {
        localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(pillPos));
      } catch {
        /* ignore */
      }
    }
  };

  // ============ Render ============

  // idle: Header trigger button only
  if (phase === 'idle') {
    return (
      <button
        type="button"
        onClick={handleStart}
        disabled={!portReady}
        className="header-icon"
        style={{
          color: !portReady ? 'rgba(150,150,150,0.5)' : isDarkMode ? 'rgba(116,198,157,0.85)' : 'rgba(64,145,108,0.95)',
          opacity: !portReady ? 0.5 : 1,
        }}
        aria-label="Start recording"
        title={!portReady ? '连接建立中…' : '开始录制'}>
        <FiVideo size={16} />
      </button>
    );
  }

  // recording / stopped: floating pill
  const isRecording = phase === 'recording';
  const accent = isRecording ? '#EF4444' : '#10B981';
  const positionStyle: React.CSSProperties = pillPos
    ? { position: 'fixed', left: pillPos.x, top: pillPos.y, right: 'auto' }
    : { position: 'fixed', top: 56, right: 12 };

  return (
    <>
      {/* Inline keyframes (kept local to avoid global CSS pollution) */}
      <style>{`
        @keyframes recording-pulse-dot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.6); opacity: 0.45; }
        }
        @keyframes recording-pill-in {
          from { transform: scale(0.92); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes recording-step-in {
          from { transform: translateY(-8px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        .rp-pill {
          animation: recording-pill-in 200ms ease-out;
          transition: max-height 200ms ease, box-shadow 250ms;
        }
        .rp-step {
          animation: recording-step-in 180ms ease-out;
        }
      `}</style>

      <div
        className="recording-pill-root rp-pill"
        style={{
          ...positionStyle,
          zIndex: 9999,
          width: expanded ? 280 : 'auto',
          minWidth: 160,
          maxHeight: expanded ? 380 : 40,
          borderRadius: expanded ? 12 : 999,
          background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.97)',
          border: `2px solid ${accent}`,
          boxShadow: `0 6px 20px rgba(0,0,0,0.18), 0 0 0 4px ${accent}22`,
          backdropFilter: 'blur(10px)',
          color: isDarkMode ? '#e2e8f0' : '#1e293b',
          overflow: 'hidden',
          fontSize: 12,
          userSelect: 'none',
          cursor: dragStateRef.current ? 'grabbing' : 'default',
        }}>
        {/* Header strip (drag handle + status + close) */}
        <div
          onMouseDown={onDragStart}
          onClick={() => !dragStateRef.current && setExpanded(v => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            cursor: 'grab',
            borderBottom: expanded ? `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}` : 'none',
          }}>
          {/* Status dot */}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: accent,
              animation: isRecording ? 'recording-pulse-dot 1.2s ease-in-out infinite' : 'none',
              flexShrink: 0,
            }}
          />
          {/* Status text */}
          <span style={{ fontWeight: 600, flex: 1 }}>
            {isRecording ? (
              <>
                录制中 · {formatElapsed(elapsed)} · {session?.actions.length ?? 0} 步
              </>
            ) : (
              <>已录制 {session?.actions.length ?? 0} 步</>
            )}
          </span>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              handleClose();
            }}
            style={{
              padding: 2,
              borderRadius: 4,
              color: isDarkMode ? '#94a3b8' : '#64748b',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            title="关闭并丢弃">
            <FiX size={14} />
          </button>
        </div>

        {/* Expanded body */}
        {expanded && (
          <>
            <div style={{ maxHeight: 220, overflowY: 'auto', padding: '6px 12px' }}>
              {!session?.actions.length ? (
                <div style={{ padding: '12px 0', textAlign: 'center', color: isDarkMode ? '#64748b' : '#94a3b8' }}>
                  {isRecording ? '正在等待操作...' : '未记录任何步骤'}
                </div>
              ) : (
                session.actions
                  .slice()
                  .reverse() // newest on top
                  .map((a, i) => (
                    <div
                      key={a.id}
                      className="rp-step"
                      style={{
                        display: 'flex',
                        gap: 6,
                        padding: '4px 0',
                        fontSize: 11,
                        color: isDarkMode ? '#cbd5e1' : '#475569',
                        borderBottom:
                          i < session.actions.length - 1 ? `1px dashed ${isDarkMode ? '#1e293b' : '#f1f5f9'}` : 'none',
                      }}>
                      <span style={{ width: 18, color: isDarkMode ? '#64748b' : '#94a3b8' }}>
                        {session.actions.length - i}.
                      </span>
                      <span style={{ width: 16 }}>{ACTION_ICON[a.type] || '•'}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {actionLabel(a)}
                      </span>
                    </div>
                  ))
              )}
            </div>

            {/* Footer actions */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                padding: '8px 12px',
                borderTop: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                background: isDarkMode ? 'rgba(15,23,42,0.6)' : 'rgba(248,250,252,0.6)',
              }}>
              {isRecording ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        portRef.current?.postMessage({ type: 'recording_add_active_tab' });
                      } catch {
                        /* ignore */
                      }
                    }}
                    title="把当前激活的标签页加入录制"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: 'transparent',
                      color: isDarkMode ? '#cbd5e1' : '#475569',
                      border: `1px solid ${isDarkMode ? '#475569' : '#cbd5e1'}`,
                      fontWeight: 500,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}>
                    + 当前页
                  </button>
                  <button
                    type="button"
                    onClick={handleStop}
                    style={{
                      flex: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: accent,
                      color: '#fff',
                      border: 'none',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}>
                    <FiSquare size={12} fill="#fff" /> 停止
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenSaveDialog}
                  disabled={!session?.actions.length}
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: accent,
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: session?.actions.length ? 'pointer' : 'not-allowed',
                    opacity: session?.actions.length ? 1 : 0.5,
                  }}>
                  <FiSave size={12} /> 保存为工作流
                </button>
              )}
            </div>
          </>
        )}

        {/* Error toast */}
        {error && (
          <div
            style={{
              padding: '6px 12px',
              fontSize: 11,
              color: '#fca5a5',
              background: 'rgba(239,68,68,0.1)',
              borderTop: '1px solid rgba(239,68,68,0.3)',
            }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Save dialog — portaled to document.body to avoid overflow/clipping from parent containers */}
      {showSaveDialog &&
        createPortal(
          <div
            onClick={() => setShowSaveDialog(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              backdropFilter: 'blur(2px)',
              padding: 12,
            }}>
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 320,
                maxHeight: 'calc(100vh - 32px)',
                borderRadius: 14,
                background: isDarkMode ? '#0f172a' : '#fff',
                border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
                padding: 18,
                boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
                overflowY: 'auto',
                boxSizing: 'border-box',
              }}>
              <h3
                style={{
                  margin: 0,
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: isDarkMode ? '#e2e8f0' : '#0f172a',
                }}>
                保存为工作流
              </h3>
              <label
                style={{ display: 'block', fontSize: 11, color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 4 }}>
                名称 *
              </label>
              <input
                type="text"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: `1px solid ${isDarkMode ? '#334155' : '#cbd5e1'}`,
                  background: isDarkMode ? '#1e293b' : '#fff',
                  color: isDarkMode ? '#e2e8f0' : '#0f172a',
                  marginBottom: 10,
                  boxSizing: 'border-box',
                }}
              />
              <label
                style={{ display: 'block', fontSize: 11, color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 4 }}>
                描述（可选）
              </label>
              <textarea
                value={saveDesc}
                onChange={e => setSaveDesc(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: `1px solid ${isDarkMode ? '#334155' : '#cbd5e1'}`,
                  background: isDarkMode ? '#1e293b' : '#fff',
                  color: isDarkMode ? '#e2e8f0' : '#0f172a',
                  marginBottom: 16,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowSaveDialog(false)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    fontSize: 12,
                    background: isDarkMode ? '#1e293b' : '#f1f5f9',
                    color: isDarkMode ? '#e2e8f0' : '#0f172a',
                    border: `1px solid ${isDarkMode ? '#334155' : '#cbd5e1'}`,
                    cursor: 'pointer',
                  }}>
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSaveAsWorkflow}
                  disabled={!saveName.trim() || saving}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    fontSize: 12,
                    background: '#10B981',
                    color: '#fff',
                    border: 'none',
                    cursor: !saveName.trim() || saving ? 'not-allowed' : 'pointer',
                    opacity: !saveName.trim() || saving ? 0.5 : 1,
                    fontWeight: 600,
                  }}>
                  {saving ? '保存中...' : '保存为工作流'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* When recording, also show "stop" icon button on header for quick access */}
      <button
        type="button"
        onClick={handleStop}
        className="header-icon"
        style={{ color: isRecording ? '#EF4444' : '#10B981' }}
        title={isRecording ? '停止录制' : '已录制'}>
        {isRecording ? <FiVideoOff size={16} /> : <FiVideo size={16} />}
      </button>
    </>
  );
}
