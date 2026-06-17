/**
 * Recording Control Component
 * MVP version: Start/Stop recording, view/edit recorded steps, save as skill
 * Added: Full editing modal with UI/text modes and AI polish
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FiVideo,
  FiVideoOff,
  FiSave,
  FiTrash2,
  FiCheck,
  FiEdit2,
  FiX,
  FiChevronUp,
  FiChevronDown,
  FiRefreshCw,
  FiEye,
  FiCode,
} from 'react-icons/fi';
import { HiSparkles } from 'react-icons/hi';

interface RecordingSession {
  id: string;
  tabId: number;
  startedAt: number;
  endedAt?: number;
  actions: RecordedAction[];
  status: 'recording' | 'stopped' | 'completed';
}

interface RecordedAction {
  id: string;
  type: 'click' | 'input' | 'scroll' | 'keydown' | 'navigate' | 'select' | 'copy' | 'paste' | 'cut';
  timestamp: number;
  element?: {
    tagName: string;
    primary: string;
    textContent?: string;
    xpath?: string;
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

interface SkillStep {
  id: string;
  action: string;
  description?: string;
  parameters: Record<string, unknown>;
  onError: 'stop' | 'continue' | 'retry';
}

interface EditedSkill {
  name: string;
  description: string;
  steps: SkillStep[];
}

interface RecordingControlProps {
  isDarkMode?: boolean;
  port: chrome.runtime.Port | null;
}

export default function RecordingControl({ isDarkMode = false, port }: RecordingControlProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [skillName, setSkillName] = useState('');
  const [skillDescription, setSkillDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portReady, setPortReady] = useState(false);

  // Edit state
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editedValue, setEditedValue] = useState<string>('');

  // Edit modal state
  const [editMode, setEditMode] = useState<'ui' | 'text'>('ui');
  const [editedSkill, setEditedSkill] = useState<EditedSkill | null>(null);
  const [textContent, setTextContent] = useState<string>('');
  const [aiPolishing, setAiPolishing] = useState(false);
  const [aiPolishResult, setAiPolishResult] = useState<string | null>(null);

  // Internal port reference
  const internalPortRef = useRef<chrome.runtime.Port | null>(null);
  const messageListenerRef = useRef<((message: any) => void) | null>(null);

  // Helper function to initialize edited skill - defined inline to avoid dependency issues
  const initEditedSkillFromSession = (s: RecordingSession) => {
    const steps: SkillStep[] = s.actions.map((action, index) => ({
      id: `step${index + 1}`,
      action: convertActionToSkillAction(action.type),
      description: generateActionDescription(action),
      parameters: generateActionParameters(action),
      onError: action.type === 'scroll' ? 'continue' : 'stop',
    }));

    const defaultName = `录制任务 ${new Date().toLocaleDateString()}`;
    const defaultDescription = `包含 ${steps.length} 个步骤的自动化任务`;

    setEditedSkill({
      name: defaultName,
      description: defaultDescription,
      steps,
    });
    setSkillName(defaultName);
    setSkillDescription(defaultDescription);
  };

  // Initialize or use provided port
  useEffect(() => {
    const setupPort = () => {
      // Use provided port if available and valid
      if (port && port.name === 'side-panel-connection') {
        internalPortRef.current = port;
        setPortReady(true);
        console.log('[RecordingControl] Using provided port');
      } else {
        // Create new connection if needed
        try {
          internalPortRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });
          setPortReady(true);
          console.log('[RecordingControl] Created new port');
        } catch (e) {
          console.error('[RecordingControl] Failed to create port:', e);
          setError('无法连接到后台服务，请刷新页面');
          setPortReady(false);
        }
      }

      // Setup message listener
      const handleMessage = (message: {
        type: string;
        session?: RecordingSession;
        error?: string;
        result?: EditedSkill;
        polishedSkill?: EditedSkill;
      }) => {
        console.log('[RecordingControl] Received message:', message.type);
        setError(null);

        switch (message.type) {
          case 'recording_started':
            setIsRecording(true);
            setSession(message.session ?? null);
            break;
          case 'recording_stopped':
            setIsRecording(false);
            setSession(message.session ?? null);
            // Initialize edited skill from session
            if (message.session) {
              initEditedSkillFromSession(message.session);
            }
            break;
          case 'recording_state_update':
            setSession(message.session ?? null);
            break;
          case 'recording_saved':
            setSaved(true);
            setSession(null);
            setShowSaveModal(false);
            setShowEditModal(false);
            setTimeout(() => {
              setSaved(false);
            }, 2000);
            break;
          case 'error':
            setError(message.error || 'Unknown error');
            setIsRecording(false);
            break;
          case 'recording_state':
            if (message.session?.status === 'recording') {
              setIsRecording(true);
            }
            setSession(message.session ?? null);
            break;
          case 'ai_polish_result':
            setAiPolishing(false);
            if (message.polishedSkill) {
              setEditedSkill(message.polishedSkill);
              setAiPolishResult('AI 已优化 skill 内容');
              setTimeout(() => setAiPolishResult(null), 3000);
            }
            break;
        }
      };

      messageListenerRef.current = handleMessage;

      if (internalPortRef.current) {
        internalPortRef.current.onMessage.addListener(handleMessage);

        // Get current recording state
        try {
          internalPortRef.current.postMessage({ type: 'get_recording_state' });
        } catch (e) {
          console.warn('[RecordingControl] Failed to get recording state:', e);
        }
      }
    };

    setupPort();

    return () => {
      if (internalPortRef.current && messageListenerRef.current) {
        try {
          internalPortRef.current.onMessage.removeListener(messageListenerRef.current);
        } catch {
          // Port might be disconnected
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port]);

  // Convert action type to skill action name
  const convertActionToSkillAction = (type: string): string => {
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
      default:
        return 'wait';
    }
  };

  // Generate action description
  const generateActionDescription = (action: RecordedAction): string => {
    switch (action.type) {
      case 'navigate':
        return `Navigate to ${action.navigateInfo?.title?.slice(0, 30) || action.pageUrl}`;
      case 'click':
        return `Click "${action.element?.textContent?.slice(0, 30) || action.element?.tagName || 'element'}"`;
      case 'input':
        return `Input "${(action.value || '').slice(0, 20)}"`;
      case 'keydown':
        return action.keys === 'Enter' ? 'Press Enter' : `Press ${action.keys}`;
      case 'scroll':
        return `Scroll to ${action.scrollInfo?.yPercent || 50}%`;
      case 'select':
        return `Select "${(action.value || '').slice(0, 20)}"`;
      case 'copy':
        return `Copy "${(action.value || action.selectionInfo?.text || '').slice(0, 20)}"`;
      case 'paste':
        return `Paste "${(action.value || '').slice(0, 20)}"`;
      case 'cut':
        return `Cut "${(action.value || '').slice(0, 20)}"`;
      default:
        return action.type;
    }
  };

  // Generate action parameters
  const generateActionParameters = (action: RecordedAction): Record<string, unknown> => {
    switch (action.type) {
      case 'navigate':
        return { intent: `Navigate to ${action.navigateInfo?.url}`, url: action.navigateInfo?.url || action.pageUrl };
      case 'click':
        return { intent: `Click element`, selector: action.element?.primary, xpath: action.element?.xpath };
      case 'input':
        return {
          intent: `Input text`,
          selector: action.element?.primary,
          xpath: action.element?.xpath,
          text: action.value,
        };
      case 'keydown':
        return { intent: action.keys === 'Enter' ? 'Submit or confirm' : `Send key ${action.keys}`, keys: action.keys };
      case 'scroll':
        return { intent: 'Scroll page', yPercent: action.scrollInfo?.yPercent || 50 };
      case 'select':
        return { intent: `Select option`, selector: action.element?.primary, text: action.value };
      case 'copy':
        return { intent: 'Copy content', selectionInfo: action.selectionInfo };
      case 'paste':
        return { intent: 'Paste content', text: action.value, pasteInfo: action.pasteInfo };
      case 'cut':
        return { intent: 'Cut content', cutInfo: action.cutInfo };
      default:
        return { intent: 'Wait', seconds: 1 };
    }
  };

  // Start recording
  const handleStartRecording = useCallback(async () => {
    if (!portReady || !internalPortRef.current) {
      setError('连接未建立，请稍候...');
      console.error('[RecordingControl] Port not ready');
      return;
    }

    setError(null);
    // Clear previous session state so a fresh recording can begin
    setSession(null);
    setEditedSkill(null);
    setSaved(false);

    // Get active tab
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        setError('未找到活动标签页');
        return;
      }

      // Check if tab is a valid web page (not chrome:// or extension pages)
      if (!activeTab.url?.startsWith('http')) {
        setError('只能在网页上录制（不支持 chrome:// 页面）');
        return;
      }

      console.log('[RecordingControl] Starting recording on tab:', activeTab.id, activeTab.url);

      // Reconnect port if it was disconnected (e.g. after extension reload)
      try {
        internalPortRef.current.postMessage({
          type: 'start_recording',
          tabId: activeTab.id,
        });
        // Optimistically mark recording as started so UI shows immediately
        setIsRecording(true);
      } catch (portErr) {
        // Port disconnected — reconnect and retry
        console.warn('[RecordingControl] Port disconnected, reconnecting...', portErr);
        try {
          const newPort = chrome.runtime.connect({ name: 'side-panel-connection' });
          internalPortRef.current = newPort;
          // Re-attach message listener to new port
          if (messageListenerRef.current) {
            newPort.onMessage.addListener(messageListenerRef.current);
          }
          newPort.postMessage({
            type: 'start_recording',
            tabId: activeTab.id,
          });
          setIsRecording(true);
        } catch (retryErr) {
          setError('连接断开，请刷新聊天面板');
          console.error('[RecordingControl] Reconnection failed:', retryErr);
          return;
        }
      }
    } catch (e) {
      setError('启动录制失败');
      console.error('[RecordingControl] Failed to start recording:', e);
    }
  }, [portReady]);

  // Stop recording
  const handleStopRecording = useCallback(() => {
    if (!internalPortRef.current) return;

    console.log('[RecordingControl] Stopping recording');
    internalPortRef.current.postMessage({ type: 'stop_recording' });
  }, []);

  // Open edit modal
  const handleOpenEditModal = () => {
    if (!session) return;
    initEditedSkillFromSession(session);
    setShowEditModal(true);
    setEditMode('ui');
  };

  // Convert edited skill to markdown text
  const convertToMarkdown = useCallback((skill: EditedSkill): string => {
    let md = `# ${skill.name}\n\n`;
    md += `${skill.description}\n\n`;
    md += `## 步骤\n\n`;
    skill.steps.forEach((step, index) => {
      md += `### 步骤 ${index + 1}: ${step.description || step.action}\n\n`;
      md += `- **Action**: ${step.action}\n`;
      md += `- **onError**: ${step.onError}\n`;
      if (step.parameters) {
        Object.entries(step.parameters).forEach(([key, value]) => {
          md += `- **${key}**: ${JSON.stringify(value)}\n`;
        });
      }
      md += '\n';
    });
    return md;
  }, []);

  // Parse markdown to edited skill
  const parseMarkdown = useCallback((md: string): EditedSkill => {
    const nameMatch = md.match(/^#\s+(.+)$/m);
    const name = nameMatch ? nameMatch[1].trim() : '未命名 Skill';

    // Extract description (text after # title, before ## 步骤)
    const descMatch = md.match(/^#\s+.+\n\n(.+?)\n\n## 步骤/m);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract steps
    const steps: SkillStep[] = [];
    const stepMatches = md.matchAll(/### 步骤 \d+:\s*(.+)\n\n(.+?)\n\n(?=### 步骤|$)/gs);
    for (const match of stepMatches) {
      const stepDesc = match[1].trim();
      const stepContent = match[2];
      const actionMatch = stepContent.match(/\*\*Action\*\*:\s*(\w+)/);
      const onErrorMatch = stepContent.match(/\*\*onError\*\*:\s*(stop|continue|retry)/);
      const parameters: Record<string, unknown> = {};
      const paramMatches = stepContent.matchAll(/\*\*(\w+)\*\*:\s*(.+)$/gm);
      for (const pm of paramMatches) {
        if (pm[1] !== 'Action' && pm[1] !== 'onError') {
          try {
            parameters[pm[1]] = JSON.parse(pm[2]);
          } catch {
            parameters[pm[1]] = pm[2];
          }
        }
      }
      steps.push({
        id: `step${steps.length + 1}`,
        action: actionMatch ? actionMatch[1] : 'wait',
        description: stepDesc,
        parameters,
        onError: (onErrorMatch ? onErrorMatch[1] : 'stop') as 'stop' | 'continue' | 'retry',
      });
    }

    return { name, description, steps };
  }, []);

  // Handle edit mode switch
  const handleEditModeSwitch = useCallback(
    (mode: 'ui' | 'text') => {
      if (mode === 'text' && editedSkill) {
        setTextContent(convertToMarkdown(editedSkill));
      } else if (mode === 'ui' && textContent) {
        try {
          setEditedSkill(parseMarkdown(textContent));
        } catch (e) {
          setError('文本格式解析失败');
        }
      }
      setEditMode(mode);
    },
    [editedSkill, textContent, convertToMarkdown, parseMarkdown],
  );

  // Update step in UI mode
  const updateStep = useCallback(
    (index: number, field: string, value: unknown) => {
      if (!editedSkill) return;
      const newSteps = [...editedSkill.steps];
      const step = newSteps[index];
      if (field === 'description') {
        step.description = value as string;
      } else if (field === 'action') {
        step.action = value as string;
      } else if (field === 'onError') {
        step.onError = value as 'stop' | 'continue' | 'retry';
      } else {
        step.parameters = { ...step.parameters, [field]: value };
      }
      setEditedSkill({ ...editedSkill, steps: newSteps });
    },
    [editedSkill],
  );

  // Add step
  const addStep = useCallback(() => {
    if (!editedSkill) return;
    const newStep: SkillStep = {
      id: `step${editedSkill.steps.length + 1}`,
      action: 'wait',
      description: '新步骤',
      parameters: { intent: '等待', seconds: 1 },
      onError: 'stop',
    };
    setEditedSkill({ ...editedSkill, steps: [...editedSkill.steps, newStep] });
  }, [editedSkill]);

  // Remove step
  const removeStep = useCallback(
    (index: number) => {
      if (!editedSkill) return;
      const newSteps = editedSkill.steps.filter((_, i) => i !== index);
      setEditedSkill({ ...editedSkill, steps: newSteps });
    },
    [editedSkill],
  );

  // AI Polish
  const handleAiPolish = useCallback(() => {
    if (!editedSkill || !internalPortRef.current) return;
    setAiPolishing(true);
    setAiPolishResult(null);

    internalPortRef.current.postMessage({
      type: 'ai_polish_skill',
      skill: editedSkill,
      originalActions: session?.actions,
    });
  }, [editedSkill, session]);

  // Save from edit modal
  const handleSaveFromEdit = useCallback(() => {
    if (!internalPortRef.current || !editedSkill) return;
    setSaving(true);

    internalPortRef.current.postMessage({
      type: 'save_recording_as_skill',
      sessionId: session?.id,
      skillName: editedSkill.name,
      skillDescription: editedSkill.description,
      editedSteps: editedSkill.steps,
    });

    setTimeout(() => setSaving(false), 3000);
  }, [session, editedSkill]);

  // Save recording as skill (direct save without editing)
  const handleSaveSkill = useCallback(() => {
    if (!internalPortRef.current || !skillName.trim()) return;
    setSaving(true);
    setError(null);

    internalPortRef.current.postMessage({
      type: 'save_recording_as_skill',
      sessionId: session?.id,
      skillName: skillName.trim(),
      skillDescription: skillDescription.trim() || `录制的自动化: ${skillName}`,
    });

    setTimeout(() => setSaving(false), 3000);
  }, [session, skillName, skillDescription]);

  /**
   * Save the current recording as a Workflow and open the workflow editor in the Options page.
   * Bridges Recording → Skill → SkillToWorkflow conversion → workflow store → openOptionsPage.
   */
  const handleSaveAsWorkflow = useCallback(async () => {
    if (!session || !skillName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { userWorkflowsStore } = await import('@extension/storage');
      const { convertSkillToWorkflow } = await import('@extension/workflow');

      // Build a Skill object from the current session/edited steps
      const sourceSteps =
        editedSkill?.steps && editedSkill.steps.length > 0
          ? editedSkill.steps
          : session.actions.map((a, idx) => {
              const action = convertActionToSkillAction(a.type);
              const params = convertActionParameters(a);
              return {
                id: `step-${idx}`,
                action,
                description: a.element?.textContent ? `${action}: ${a.element.textContent.slice(0, 30)}` : action,
                parameters: params,
                onError: 'stop' as const,
              };
            });

      const skill = {
        id: `skill-${Date.now()}`,
        name: skillName.trim(),
        description: skillDescription.trim() || `录制的自动化: ${skillName}`,
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

      // Convert Skill to Workflow
      const workflow = convertSkillToWorkflow(skill as unknown as Parameters<typeof convertSkillToWorkflow>[0]);
      const workflowId = `recorded-${Date.now()}`;
      const config = {
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
      };
      await userWorkflowsStore.addWorkflow(config);
      console.log('[RecordingControl] Workflow saved:', workflowId, 'with', config.nodes.length, 'nodes');

      // Close modals and recording state, then open Options at workflows tab
      setSession(null);
      setIsRecording(false);
      setShowSaveModal(false);
      setShowEditModal(false);
      setEditedSkill(null);
      setSaving(false);
      // Navigate to options page with workflows tab and auto-open param
      const optionsUrl = chrome.runtime.getURL(`options/index.html?tab=workflows&editWorkflow=${workflowId}`);
      chrome.tabs.create({ url: optionsUrl });
    } catch (e) {
      console.error('[RecordingControl] Save as workflow failed:', e);
      setError(e instanceof Error ? e.message : '保存为工作流失败');
      setSaving(false);
    }
  }, [session, skillName, skillDescription, editedSkill]);

  // Clear recorded session
  const handleClearSession = useCallback(() => {
    setSession(null);
    setIsRecording(false);
    setExpanded(false);
    setEditingActionId(null);
    setEditedSkill(null);
  }, []);

  // Remove action from session
  const handleRemoveAction = useCallback(
    (actionId: string) => {
      if (!session) return;

      const newActions = session.actions.filter(a => a.id !== actionId);
      setSession({ ...session, actions: newActions });

      // Notify background to remove
      if (internalPortRef.current) {
        internalPortRef.current.postMessage({
          type: 'remove_recorded_action',
          actionId,
        });
      }
    },
    [session],
  );

  // Start editing action value inline
  const handleStartEdit = useCallback((action: RecordedAction) => {
    setEditingActionId(action.id);
    setEditedValue(action.value || '');
  }, []);

  // Save edited action value inline
  const handleSaveEdit = useCallback(() => {
    if (!editingActionId || !session) return;

    const newActions = session.actions.map(a => {
      if (a.id === editingActionId) {
        return { ...a, value: editedValue };
      }
      return a;
    });

    setSession({ ...session, actions: newActions });

    // Notify background
    if (internalPortRef.current) {
      internalPortRef.current.postMessage({
        type: 'update_recorded_action',
        actionId: editingActionId,
        updates: { value: editedValue },
      });
    }

    setEditingActionId(null);
    setEditedValue('');
  }, [editingActionId, editedValue, session]);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    setEditingActionId(null);
    setEditedValue('');
  }, []);

  // Format action for display
  const formatAction = (action: RecordedAction): string => {
    switch (action.type) {
      case 'navigate':
        return `Navigate: ${action.navigateInfo?.title?.slice(0, 25) || action.pageUrl.slice(0, 25)}...`;
      case 'click':
        return `Click: ${action.element?.textContent?.slice(0, 20) || action.element?.tagName || 'element'}`;
      case 'input':
        const inputVal = action.value || '';
        return `Input: "${inputVal.slice(0, 15)}${inputVal.length > 15 ? '...' : ''}"`;
      case 'keydown':
        return `Press: ${action.keys}`;
      case 'scroll':
        return `Scroll: ${action.scrollInfo?.yPercent}%`;
      case 'select':
        return `Select: "${(action.value || '').slice(0, 20)}"`;
      case 'copy':
        return `Copy: "${(action.value || '').slice(0, 20)}"`;
      case 'paste':
        return `Paste: "${(action.value || '').slice(0, 20)}"`;
      case 'cut':
        return `Cut: "${(action.value || '').slice(0, 20)}"`;
      default:
        return action.type;
    }
  };

  // Get action icon
  const getActionIcon = (type: string): string => {
    switch (type) {
      case 'navigate':
        return '🔗';
      case 'click':
        return '👆';
      case 'input':
        return '⌨️';
      case 'keydown':
        return '⚡';
      case 'scroll':
        return '📜';
      case 'select':
        return '📋';
      case 'copy':
        return '📋';
      case 'paste':
        return '📝';
      case 'cut':
        return '✂️';
      default:
        return '•';
    }
  };

  return (
    <div className="recording-control">
      {/* Recording toggle button in header */}
      <button
        type="button"
        onClick={isRecording ? handleStopRecording : handleStartRecording}
        disabled={!portReady}
        className={`header-icon ${isRecording ? 'recording-active' : ''}`}
        style={{
          color: isRecording
            ? '#EF4444'
            : !portReady
              ? 'rgba(150,150,150,0.5)'
              : isDarkMode
                ? 'rgba(116,198,157,0.8)'
                : 'rgba(64,145,108,0.9)',
          opacity: !portReady ? 0.5 : 1,
        }}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        title={!portReady ? '连接建立中...' : isRecording ? '📹 Recording...' : '📹 Start Recording'}>
        {isRecording ? <FiVideoOff size={16} /> : <FiVideo size={16} />}
        {isRecording && (
          <span
            className="recording-dot"
            style={{
              position: 'absolute',
              right: -2,
              top: -2,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#EF4444',
              animation: 'pulse 1s infinite',
            }}
          />
        )}
      </button>

      {/* Success toast */}
      {saved && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            right: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: '#22C55E',
            color: '#fff',
            fontSize: 12,
            zIndex: 100,
          }}>
          ✅ Skill 已保存！
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            right: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: isDarkMode ? 'rgba(239,68,68,0.9)' : '#FEE2E2',
            color: isDarkMode ? '#fff' : '#991B1B',
            fontSize: 12,
            zIndex: 100,
            maxWidth: 200,
          }}>
          ⚠️ {error}
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              marginLeft: 8,
              opacity: 0.7,
            }}>
            ✕
          </button>
        </div>
      )}

      {/* Recorded steps panel (shown when recording stopped with actions) */}
      {session && session.actions.length > 0 && !isRecording && !showSaveModal && !showEditModal && (
        <div
          className={`recording-panel ${expanded ? 'expanded' : ''}`}
          style={{
            position: 'absolute',
            top: 40,
            right: 8,
            width: expanded ? 280 : 220,
            maxHeight: expanded ? 320 : 200,
            borderRadius: 12,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 100,
            overflow: 'hidden',
          }}>
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--border-color)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              📹 已录制 {session.actions.length} 步
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="p-1 rounded text-xs"
                style={{ color: 'var(--text-muted)' }}
                title={expanded ? '收起' : '展开'}>
                {expanded ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
              </button>
              <button
                type="button"
                onClick={handleClearSession}
                className="p-1 rounded"
                style={{ color: 'var(--text-muted)' }}
                title="清除">
                <FiTrash2 size={12} />
              </button>
            </div>
          </div>

          {/* Actions list */}
          <div className="overflow-y-auto px-2 py-1" style={{ maxHeight: expanded ? 200 : 100 }}>
            {session.actions.slice(0, expanded ? undefined : 5).map((action, index) => (
              <div
                key={action.id}
                className="flex items-center gap-2 py-1 text-xs"
                style={{
                  color: 'var(--text-secondary)',
                  borderBottom:
                    expanded && index < session.actions.length - 1 ? '1px dashed var(--border-color)' : 'none',
                }}>
                <span className="shrink-0 w-4">{index + 1}.</span>
                <span className="shrink-0">{getActionIcon(action.type)}</span>

                {/* Content - editable for input type */}
                {editingActionId === action.id && action.type === 'input' ? (
                  <div className="flex-1 flex items-center gap-1">
                    <input
                      type="text"
                      value={editedValue}
                      onChange={e => setEditedValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSaveEdit();
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                      className="flex-1 px-2 py-1 rounded text-xs"
                      style={{
                        background: 'var(--bg-input)',
                        border: '1px solid var(--accent-color)',
                        color: 'var(--text-primary)',
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      className="p-1 rounded"
                      style={{ color: '#22C55E' }}
                      title="保存">
                      <FiCheck size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="p-1 rounded"
                      style={{ color: 'var(--text-muted)' }}
                      title="取消">
                      <FiX size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="truncate">{formatAction(action)}</span>
                    {expanded && (
                      <div className="flex items-center gap-1 ml-2">
                        {action.type === 'input' && (
                          <button
                            type="button"
                            onClick={() => handleStartEdit(action)}
                            className="p-1 rounded opacity-60 hover:opacity-100"
                            style={{ color: 'var(--text-muted)' }}
                            title="编辑">
                            <FiEdit2 size={11} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveAction(action.id)}
                          className="p-1 rounded opacity-60 hover:opacity-100"
                          style={{ color: '#EF4444' }}
                          title="删除">
                          <FiTrash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!expanded && session.actions.length > 5 && (
              <div className="text-xs py-1" style={{ color: 'var(--text-muted)' }}>
                ...还有 {session.actions.length - 5} 步
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex justify-center gap-2 px-3 py-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <button
              type="button"
              onClick={handleOpenEditModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}>
              <FiEdit2 size={12} />
              编辑
            </button>
            <button
              type="button"
              onClick={() => setShowSaveModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: 'var(--accent-color)',
                color: '#fff',
              }}>
              <FiSave size={12} />
              保存
            </button>
          </div>
        </div>
      )}

      {/* Save modal (quick save) */}
      {showSaveModal && (
        <div
          className="save-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100vh',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowSaveModal(false)}>
          <div
            className="save-modal"
            style={{
              width: 320,
              borderRadius: 16,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              padding: 20,
            }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              快速保存为 Skill
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Skill 名称 *
                </label>
                <input
                  type="text"
                  value={skillName}
                  onChange={e => setSkillName(e.target.value)}
                  placeholder="例如：自动搜索商品"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  描述
                </label>
                <textarea
                  value={skillDescription}
                  onChange={e => setSkillDescription(e.target.value)}
                  placeholder="自动执行搜索和点击操作"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                包含 {session?.actions.length || 0} 个步骤
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                }}>
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveSkill}
                disabled={!skillName.trim() || saving}
                className="px-4 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  opacity: !skillName.trim() || saving ? 0.5 : 1,
                }}>
                {saving ? '保存中...' : '保存为 Skill'}
              </button>
              <button
                type="button"
                onClick={handleSaveAsWorkflow}
                disabled={!skillName.trim() || saving}
                className="px-4 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: 'var(--accent-color)',
                  color: '#fff',
                  opacity: !skillName.trim() || saving ? 0.5 : 1,
                }}>
                {saving ? '保存中...' : '保存为工作流'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal (full editing with UI/text modes and AI polish) */}
      {showEditModal && editedSkill && (
        <div
          className="edit-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100vh',
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowEditModal(false)}>
          <div
            className="edit-modal"
            style={{
              width: 480,
              maxHeight: '80vh',
              borderRadius: 16,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              padding: 20,
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                编辑 Skill
              </h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="p-1 rounded"
                style={{ color: 'var(--text-muted)' }}>
                <FiX size={16} />
              </button>
            </div>

            {/* AI polish result toast */}
            {aiPolishResult && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: '#22C55E',
                  color: '#fff',
                  fontSize: 12,
                  marginBottom: 12,
                }}>
                ✨ {aiPolishResult}
              </div>
            )}

            {/* Mode switcher */}
            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => handleEditModeSwitch('ui')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs ${editMode === 'ui' ? '' : ''}`}
                style={{
                  background: editMode === 'ui' ? 'var(--accent-color)' : 'var(--bg-secondary)',
                  color: editMode === 'ui' ? '#fff' : 'var(--text-primary)',
                }}>
                <FiEye size={12} />
                图形编辑
              </button>
              <button
                type="button"
                onClick={() => handleEditModeSwitch('text')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs ${editMode === 'text' ? '' : ''}`}
                style={{
                  background: editMode === 'text' ? 'var(--accent-color)' : 'var(--bg-secondary)',
                  color: editMode === 'text' ? '#fff' : 'var(--text-primary)',
                }}>
                <FiCode size={12} />
                文本编辑
              </button>
              <button
                type="button"
                onClick={handleAiPolish}
                disabled={aiPolishing}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs ml-auto"
                style={{
                  background: '#8B5CF6',
                  color: '#fff',
                  opacity: aiPolishing ? 0.6 : 1,
                }}>
                {aiPolishing ? <FiRefreshCw size={12} className="animate-spin" /> : <HiSparkles size={12} />}
                {aiPolishing ? 'AI 润色中...' : 'AI 润色'}
              </button>
            </div>

            {/* Basic info */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  Skill 名称
                </label>
                <input
                  type="text"
                  value={editedSkill.name}
                  onChange={e => setEditedSkill({ ...editedSkill, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  描述
                </label>
                <textarea
                  value={editedSkill.description}
                  onChange={e => setEditedSkill({ ...editedSkill, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </div>

            {/* Steps content */}
            <div style={{ maxHeight: 'calc(80vh - 280px)', overflow: 'auto' }}>
              {editMode === 'ui' ? (
                /* UI Mode: Visual step editor */
                <div className="space-y-2">
                  {editedSkill.steps.map((step, index) => (
                    <div
                      key={step.id}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                      }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          步骤 {index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeStep(index)}
                          className="p-1 rounded"
                          style={{ color: '#EF4444' }}>
                          <FiTrash2 size={12} />
                        </button>
                      </div>
                      <div className="grid gap-2">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                              Action
                            </label>
                            <select
                              value={step.action}
                              onChange={e => updateStep(index, 'action', e.target.value)}
                              className="w-full px-2 py-1 rounded text-xs"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                              }}>
                              <option value="go_to_url">go_to_url</option>
                              <option value="click_element">click_element</option>
                              <option value="input_text">input_text</option>
                              <option value="send_keys">send_keys</option>
                              <option value="scroll_to_percent">scroll_to_percent</option>
                              <option value="select_dropdown_option">select_dropdown_option</option>
                              <option value="copy_text">copy_text</option>
                              <option value="paste_text">paste_text</option>
                              <option value="wait">wait</option>
                            </select>
                          </div>
                          <div className="flex-1">
                            <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                              onError
                            </label>
                            <select
                              value={step.onError}
                              onChange={e => updateStep(index, 'onError', e.target.value)}
                              className="w-full px-2 py-1 rounded text-xs"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                              }}>
                              <option value="stop">stop</option>
                              <option value="continue">continue</option>
                              <option value="retry">retry</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                            描述
                          </label>
                          <input
                            type="text"
                            value={step.description || ''}
                            onChange={e => updateStep(index, 'description', e.target.value)}
                            className="w-full px-2 py-1 rounded text-xs"
                            style={{
                              background: 'var(--bg-input)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-primary)',
                            }}
                          />
                        </div>
                        {/* Dynamic parameters based on action type */}
                        {step.action === 'go_to_url' && (
                          <div>
                            <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                              URL
                            </label>
                            <input
                              type="text"
                              value={(step.parameters.url as string) || ''}
                              onChange={e => updateStep(index, 'url', e.target.value)}
                              className="w-full px-2 py-1 rounded text-xs"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                              }}
                            />
                          </div>
                        )}
                        {step.action === 'click_element' && (
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                                Selector
                              </label>
                              <input
                                type="text"
                                value={(step.parameters.selector as string) || ''}
                                onChange={e => updateStep(index, 'selector', e.target.value)}
                                className="w-full px-2 py-1 rounded text-xs"
                                style={{
                                  background: 'var(--bg-input)',
                                  border: '1px solid var(--border-color)',
                                  color: 'var(--text-primary)',
                                }}
                              />
                            </div>
                            <div className="flex-1">
                              <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                                XPath
                              </label>
                              <input
                                type="text"
                                value={(step.parameters.xpath as string) || ''}
                                onChange={e => updateStep(index, 'xpath', e.target.value)}
                                className="w-full px-2 py-1 rounded text-xs"
                                style={{
                                  background: 'var(--bg-input)',
                                  border: '1px solid var(--border-color)',
                                  color: 'var(--text-primary)',
                                }}
                              />
                            </div>
                          </div>
                        )}
                        {step.action === 'input_text' && (
                          <div>
                            <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                              Text
                            </label>
                            <input
                              type="text"
                              value={(step.parameters.text as string) || ''}
                              onChange={e => updateStep(index, 'text', e.target.value)}
                              className="w-full px-2 py-1 rounded text-xs"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                              }}
                            />
                          </div>
                        )}
                        {step.action === 'send_keys' && (
                          <div>
                            <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                              Keys
                            </label>
                            <input
                              type="text"
                              value={(step.parameters.keys as string) || ''}
                              onChange={e => updateStep(index, 'keys', e.target.value)}
                              className="w-full px-2 py-1 rounded text-xs"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                              }}
                            />
                          </div>
                        )}
                        {step.action === 'scroll_to_percent' && (
                          <div>
                            <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                              yPercent
                            </label>
                            <input
                              type="number"
                              value={(step.parameters.yPercent as number) || 0}
                              onChange={e => updateStep(index, 'yPercent', parseInt(e.target.value) || 0)}
                              className="w-full px-2 py-1 rounded text-xs"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                              }}
                            />
                          </div>
                        )}
                        {step.action === 'select_dropdown_option' && (
                          <div>
                            <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                              Option Text
                            </label>
                            <input
                              type="text"
                              value={(step.parameters.text as string) || ''}
                              onChange={e => updateStep(index, 'text', e.target.value)}
                              className="w-full px-2 py-1 rounded text-xs"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                              }}
                            />
                          </div>
                        )}
                        {step.action === 'wait' && (
                          <div>
                            <label className="text-xs mb-0.5 block" style={{ color: 'var(--text-muted)' }}>
                              Seconds
                            </label>
                            <input
                              type="number"
                              value={(step.parameters.seconds as number) || 1}
                              onChange={e => updateStep(index, 'seconds', parseInt(e.target.value) || 1)}
                              className="w-full px-2 py-1 rounded text-xs"
                              style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addStep}
                    className="w-full py-2 rounded-lg text-xs"
                    style={{
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: '1px dashed var(--border-color)',
                    }}>
                    + 添加步骤
                  </button>
                </div>
              ) : (
                /* Text Mode: Markdown editor */
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>
                    Markdown 格式编辑
                  </label>
                  <textarea
                    value={textContent}
                    onChange={e => setTextContent(e.target.value)}
                    rows={15}
                    className="w-full px-3 py-2 rounded-lg text-xs resize-none font-mono"
                    style={{
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setEditedSkill(parseMarkdown(textContent));
                        setError(null);
                      } catch (e) {
                        setError('解析失败，请检查格式');
                      }
                    }}
                    className="mt-2 px-3 py-1.5 rounded-lg text-xs"
                    style={{
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                    }}>
                    应用文本更改
                  </button>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-2 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                }}>
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveFromEdit}
                disabled={!editedSkill.name.trim() || saving}
                className="px-4 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: 'var(--accent-color)',
                  color: '#fff',
                  opacity: !editedSkill.name.trim() || saving ? 0.5 : 1,
                }}>
                {saving ? '保存中...' : '保存 Skill'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recording status indicator (bottom of panel when recording) */}
      {isRecording && (
        <div
          className="recording-status"
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            borderRadius: 20,
            background: 'rgba(239,68,68,0.9)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 500,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#fff',
              animation: 'pulse 1s infinite',
            }}
          />
          正在录制... {session?.actions.length || 0} 步
          <button
            type="button"
            onClick={handleStopRecording}
            className="ml-2 px-2 py-0.5 rounded text-xs"
            style={{ background: 'rgba(255,255,255,0.2)' }}>
            停止
          </button>
        </div>
      )}
    </div>
  );
}
