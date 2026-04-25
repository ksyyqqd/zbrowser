/**
 * Content Script - Recorder Module
 * Monitors user actions and sends to background when recording is active
 */

console.log('Nanobrowser content script loaded');

// Recording state
let isRecording = false;
let sessionId: string | null = null;

// Throttle settings
const THROTTLE_MS = 100;
let lastScrollTime = 0;

// Workflow execution overlay state
let workflowOverlay: HTMLElement | null = null;
let workflowProgress: {
  workflowName: string;
  currentNodeId: string;
  currentNodeName: string;
  currentNodeType: string;
  totalNodes: number;
  executedNodes: number;
  status: 'running' | 'success' | 'error';
  error?: string;
} | null = null;

// Check recording status on load (for page navigation recovery)
(function checkRecordingStatus() {
  try {
    chrome.runtime.sendMessage({ type: 'check_recording_status' }, response => {
      if (chrome.runtime.lastError) {
        console.warn('[ContentScript] Failed to check recording status:', chrome.runtime.lastError.message);
        return;
      }
      if (response && response.isRecording && response.sessionId) {
        console.log('[ContentScript] Recovering recording session:', response.sessionId);
        startRecording(response.sessionId);
      }
    });
  } catch (e) {
    // Extension context might not be ready
    console.warn('[ContentScript] Extension context not ready');
  }
})();

/**
 * Extract element information for selector generation
 */
function extractElementInfo(element: HTMLElement): {
  tagName: string;
  id?: string;
  className?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  dataTestId?: string;
  href?: string;
  title?: string;
  textContent?: string;
  xpath?: string;
} {
  const info: Record<string, string | undefined> = {
    tagName: element.tagName,
  };

  // Basic attributes
  if (element.id) info.id = element.id;
  if (element.className && typeof element.className === 'string') info.className = element.className;
  if (element.getAttribute('name')) info.name = element.getAttribute('name');
  if (element.getAttribute('type')) info.type = element.getAttribute('type');
  if (element.getAttribute('placeholder')) info.placeholder = element.getAttribute('placeholder');
  if (element.getAttribute('aria-label')) info.ariaLabel = element.getAttribute('aria-label');
  if (element.getAttribute('data-testid')) info.dataTestId = element.getAttribute('data-testid');
  if (element.getAttribute('href')) info.href = element.getAttribute('href');
  if (element.getAttribute('title')) info.title = element.getAttribute('title');

  // Text content for buttons/links
  const tagName = element.tagName.toUpperCase();
  if (tagName === 'BUTTON' || tagName === 'A' || tagName === 'SPAN') {
    const text = element.textContent?.trim();
    if (text && text.length < 100) {
      info.textContent = text;
    }
  }

  // XPath (simplified)
  info.xpath = generateSimpleXPath(element);

  return info;
}

/**
 * Generate simple XPath for element
 * Produces valid XPath by either using a short //*[@id] path
 * or building the full path from element to body
 */
function generateSimpleXPath(element: HTMLElement): string {
  // If element has an id, use the short and reliable //*[@id] form
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // Add index if there are siblings with same tag
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `[${index}]`;
      }
    }

    // If an ancestor has an id, stop traversal and use //*[@id] as prefix
    if (current.parentElement?.id) {
      parts.unshift(selector);
      return `//*[@id="${current.parentElement.id}"]/${parts.join('/')}`;
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return '/html/body/' + parts.join('/');
}

/**
 * Send recorded action to background
 */
function sendActionToBackground(actionType: string, data: Record<string, unknown>) {
  if (!isRecording || !sessionId) return;

  const action = {
    sessionId,
    action: {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: actionType,
      timestamp: Date.now(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      ...data,
    },
  };

  try {
    chrome.runtime.sendMessage({
      type: 'recorded_action',
      ...action,
    });
  } catch (error) {
    // Extension context might be invalidated
    console.warn('Failed to send recorded action:', error);
  }
}

/**
 * Handle click events
 */
function handleClick(event: MouseEvent) {
  if (!isRecording) return;

  const target = event.target as HTMLElement;
  if (!target) return;

  // Ignore clicks on certain elements
  const tagName = target.tagName.toUpperCase();
  if (tagName === 'HTML' || tagName === 'BODY') return;

  const elementInfo = extractElementInfo(target);

  sendActionToBackground('click', {
    element: elementInfo,
  });
}

/**
 * Handle input events (with debounce)
 */
let inputDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastInputValue = '';

function handleInput(event: Event) {
  if (!isRecording) return;

  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target) return;

  // Debounce input to avoid too many messages
  if (inputDebounceTimer) {
    clearTimeout(inputDebounceTimer);
  }

  const currentValue = target.value;

  inputDebounceTimer = setTimeout(() => {
    // Only send if value changed significantly
    if (currentValue !== lastInputValue && currentValue.length > 0) {
      const elementInfo = extractElementInfo(target);
      sendActionToBackground('input', {
        element: elementInfo,
        value: currentValue,
      });
      lastInputValue = currentValue;
    }
  }, 500);
}

/**
 * Handle keydown events (for special keys like Enter)
 */
function handleKeydown(event: KeyboardEvent) {
  if (!isRecording) return;

  // Only capture special keys
  const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace'];
  if (!specialKeys.includes(event.key)) return;

  // Don't capture Enter if it's in a form that will be submitted via click
  if (event.key === 'Enter') {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      // This might trigger a submit, record it
      sendActionToBackground('keydown', {
        keys: 'Enter',
      });
    }
  } else {
    sendActionToBackground('keydown', {
      keys: event.key,
    });
  }
}

/**
 * Handle scroll events (throttled)
 */
function handleScroll(event: Event) {
  if (!isRecording) return;

  const now = Date.now();
  if (now - lastScrollTime < THROTTLE_MS) return;
  lastScrollTime = now;

  const yPercent = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);

  sendActionToBackground('scroll', {
    scrollInfo: {
      x: window.scrollX,
      y: window.scrollY,
      yPercent: Math.min(100, Math.max(0, yPercent || 0)),
    },
  });
}

/**
 * Handle select/change events for dropdowns
 */
function handleSelect(event: Event) {
  if (!isRecording) return;

  const target = event.target as HTMLSelectElement;
  if (!target || target.tagName !== 'SELECT') return;

  const elementInfo = extractElementInfo(target);
  const selectedValue = target.options[target.selectedIndex]?.text || target.value;

  sendActionToBackground('select', {
    element: elementInfo,
    value: selectedValue,
  });
}

/**
 * Handle copy events
 */
function handleCopy(event: ClipboardEvent) {
  if (!isRecording) return;

  // Get the copied content
  const selection = window.getSelection();
  const copiedText = selection?.toString() || '';

  // Get the target element where copy occurred
  const target = event.target as HTMLElement;
  const elementInfo = target ? extractElementInfo(target) : null;

  // Get clipboard data
  const clipboardData = event.clipboardData;
  const clipboardContent = clipboardData?.getData('text') || copiedText;

  // Don't record empty copies
  if (!clipboardContent && !copiedText) return;

  sendActionToBackground('copy', {
    element: elementInfo,
    value: copiedText || clipboardContent,
    selectionInfo: {
      text: copiedText.slice(0, 200), // Limit content length for storage
      length: copiedText.length,
    },
  });
}

/**
 * Handle paste events
 */
function handlePaste(event: ClipboardEvent) {
  if (!isRecording) return;

  // Get the target element where paste occurred
  const target = event.target as HTMLElement;
  if (!target) return;

  // Only record paste into input/textarea elements
  const tagName = target.tagName.toUpperCase();
  if (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && !target.isContentEditable) return;

  const elementInfo = extractElementInfo(target);

  // Get the pasted content
  const clipboardData = event.clipboardData;
  const pastedText = clipboardData?.getData('text') || '';

  // Don't record empty pastes
  if (!pastedText) return;

  sendActionToBackground('paste', {
    element: elementInfo,
    value: pastedText.slice(0, 200), // Limit content length
    pasteInfo: {
      length: pastedText.length,
      isImage: clipboardData?.getData('image') !== '',
    },
  });
}

/**
 * Handle cut events
 */
function handleCut(event: ClipboardEvent) {
  if (!isRecording) return;

  // Get the target element where cut occurred
  const target = event.target as HTMLElement;
  if (!target) return;

  // Only record cut from input/textarea/contenteditable
  const tagName = target.tagName.toUpperCase();
  if (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && !target.isContentEditable) return;

  const elementInfo = extractElementInfo(target);

  // Get the cut content
  const selection = window.getSelection();
  const cutText = selection?.toString() || '';

  // For input/textarea, also get from the element value
  const elementValue = (target as HTMLInputElement | HTMLTextAreaElement).value || '';

  sendActionToBackground('cut', {
    element: elementInfo,
    value: cutText.slice(0, 200) || elementValue.slice(0, 200),
    cutInfo: {
      length: cutText.length || elementValue.length,
    },
  });
}

/**
 * Start recording
 */
function startRecording(id: string) {
  isRecording = true;
  sessionId = id;

  // Record initial navigation
  sendActionToBackground('navigate', {
    navigateInfo: {
      url: window.location.href,
      title: document.title,
    },
  });

  // Add event listeners
  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('scroll', handleScroll, true);
  document.addEventListener('change', handleSelect, true);
  document.addEventListener('copy', handleCopy, true);
  document.addEventListener('paste', handlePaste, true);
  document.addEventListener('cut', handleCut, true);

  console.log('Recording started, session:', sessionId);
}

/**
 * Stop recording
 */
function stopRecording() {
  isRecording = false;
  sessionId = null;

  // Remove event listeners
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('scroll', handleScroll, true);
  document.removeEventListener('change', handleSelect, true);
  document.removeEventListener('copy', handleCopy, true);
  document.removeEventListener('paste', handlePaste, true);
  document.removeEventListener('cut', handleCut, true);

  // Clear timers
  if (inputDebounceTimer) {
    clearTimeout(inputDebounceTimer);
    inputDebounceTimer = null;
  }
  lastInputValue = '';

  console.log('Recording stopped');
}

// ============ Workflow Execution Overlay ============

/**
 * Create workflow execution overlay
 */
function createWorkflowOverlay() {
  if (workflowOverlay) return;

  // Create overlay container
  workflowOverlay = document.createElement('div');
  workflowOverlay.id = 'nanobrowser-workflow-overlay';
  workflowOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  `;

  // Create progress card
  const card = document.createElement('div');
  card.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px 32px;
    min-width: 320px;
    max-width: 480px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    pointer-events: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  `;

  // Spinner
  const spinner = document.createElement('div');
  spinner.id = 'workflow-spinner';
  spinner.style.cssText = `
    width: 24px;
    height: 24px;
    border: 3px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  `;
  header.appendChild(spinner);

  // Title
  const title = document.createElement('div');
  title.id = 'workflow-title';
  title.style.cssText = `
    font-size: 16px;
    font-weight: 600;
    color: #1f2937;
  `;
  title.textContent = '执行工作流';
  header.appendChild(title);

  card.appendChild(header);

  // Workflow name
  const workflowName = document.createElement('div');
  workflowName.id = 'workflow-name';
  workflowName.style.cssText = `
    font-size: 14px;
    color: #6b7280;
    margin-bottom: 12px;
  `;
  card.appendChild(workflowName);

  // Progress bar container
  const progressContainer = document.createElement('div');
  progressContainer.style.cssText = `
    background: #e5e7eb;
    border-radius: 4px;
    height: 8px;
    margin-bottom: 12px;
    overflow: hidden;
  `;

  const progressBar = document.createElement('div');
  progressBar.id = 'workflow-progress-bar';
  progressBar.style.cssText = `
    background: linear-gradient(90deg, #3b82f6, #8b5cf6);
    height: 100%;
    width: 0%;
    transition: width 0.3s ease;
  `;
  progressContainer.appendChild(progressBar);
  card.appendChild(progressContainer);

  // Current node info
  const currentNodeInfo = document.createElement('div');
  currentNodeInfo.id = 'workflow-current-node';
  currentNodeInfo.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #f3f4f6;
    border-radius: 6px;
    margin-bottom: 8px;
  `;

  const nodeTypeIcon = document.createElement('span');
  nodeTypeIcon.id = 'workflow-node-icon';
  nodeTypeIcon.style.cssText = `
    font-size: 16px;
  `;
  currentNodeInfo.appendChild(nodeTypeIcon);

  const nodeName = document.createElement('span');
  nodeName.id = 'workflow-node-name';
  nodeName.style.cssText = `
    font-size: 13px;
    color: #374151;
    flex: 1;
  `;
  currentNodeInfo.appendChild(nodeName);

  card.appendChild(currentNodeInfo);

  // Status text
  const statusText = document.createElement('div');
  statusText.id = 'workflow-status';
  statusText.style.cssText = `
    font-size: 12px;
    color: #9ca3af;
  `;
  statusText.textContent = '正在执行...';
  card.appendChild(statusText);

  workflowOverlay.appendChild(card);
  document.body.appendChild(workflowOverlay);

  // Add spinner animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Update workflow progress overlay
 */
function updateWorkflowOverlay(data: {
  workflowName?: string;
  currentNodeId?: string;
  currentNodeName?: string;
  currentNodeType?: string;
  totalNodes?: number;
  executedNodes?: number;
  status?: 'running' | 'success' | 'error';
  error?: string;
}) {
  if (!workflowOverlay) createWorkflowOverlay();

  workflowProgress = { ...workflowProgress, ...data } as any;

  // Update workflow name
  const nameEl = document.getElementById('workflow-name');
  if (nameEl && data.workflowName) {
    nameEl.textContent = data.workflowName;
  }

  // Update progress bar
  const progressBar = document.getElementById('workflow-progress-bar');
  if (progressBar && data.totalNodes && data.executedNodes) {
    const percent = Math.round((data.executedNodes / data.totalNodes) * 100);
    progressBar.style.width = `${percent}%`;
  }

  // Update current node info
  const nodeIcon = document.getElementById('workflow-node-icon');
  const nodeNameEl = document.getElementById('workflow-node-name');
  if (nodeIcon && nodeNameEl) {
    if (data.currentNodeType) {
      const icons: Record<string, string> = {
        ai: '🧠',
        automation: '⚡',
        condition: '🔀',
        start: '▶️',
        end: '✅',
      };
      nodeIcon.textContent = icons[data.currentNodeType] || '●';
    }
    if (data.currentNodeName) {
      nodeNameEl.textContent = data.currentNodeName;
    }
  }

  // Update status
  const titleEl = document.getElementById('workflow-title');
  const spinnerEl = document.getElementById('workflow-spinner');
  const statusEl = document.getElementById('workflow-status');

  if (data.status === 'success') {
    if (titleEl) titleEl.textContent = '执行完成';
    if (spinnerEl) {
      spinnerEl.style.borderTopColor = '#22c55e';
      spinnerEl.style.animation = 'none';
      spinnerEl.textContent = '✓';
      spinnerEl.style.display = 'flex';
      spinnerEl.style.alignItems = 'center';
      spinnerEl.style.justifyContent = 'center';
      spinnerEl.style.fontSize = '16px';
      spinnerEl.style.color = '#22c55e';
      spinnerEl.style.border = 'none';
    }
    if (statusEl) statusEl.textContent = '工作流执行成功';
    if (progressBar) progressBar.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
    // Auto hide after 2 seconds
    setTimeout(removeWorkflowOverlay, 2000);
  } else if (data.status === 'error') {
    if (titleEl) titleEl.textContent = '执行失败';
    if (spinnerEl) {
      spinnerEl.style.borderTopColor = '#ef4444';
      spinnerEl.style.animation = 'none';
      spinnerEl.textContent = '✗';
      spinnerEl.style.display = 'flex';
      spinnerEl.style.alignItems = 'center';
      spinnerEl.style.justifyContent = 'center';
      spinnerEl.style.fontSize = '16px';
      spinnerEl.style.color = '#ef4444';
      spinnerEl.style.border = 'none';
    }
    if (statusEl) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = data.error || '执行过程中发生错误';
    }
    if (progressBar) progressBar.style.background = '#ef4444';
  }
}

/**
 * Remove workflow overlay
 */
function removeWorkflowOverlay() {
  if (workflowOverlay) {
    workflowOverlay.remove();
    workflowOverlay = null;
    workflowProgress = null;
  }
}

/**
 * Listen for messages from background
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'ping_content_script':
      sendResponse({ success: true, loaded: true });
      break;

    case 'start_recording':
      startRecording(message.sessionId);
      sendResponse({ success: true });
      break;

    case 'stop_recording':
      stopRecording();
      sendResponse({ success: true });
      break;

    case 'check_recording_status':
      sendResponse({ isRecording, sessionId });
      break;

    // Workflow execution progress messages
    case 'workflow_start':
      createWorkflowOverlay();
      updateWorkflowOverlay({
        workflowName: message.workflowName,
        totalNodes: message.totalNodes,
        executedNodes: 0,
        status: 'running',
      });
      sendResponse({ success: true });
      break;

    case 'workflow_progress':
      updateWorkflowOverlay({
        currentNodeId: message.nodeId,
        currentNodeName: message.nodeName,
        currentNodeType: message.nodeType,
        executedNodes: message.executedNodes,
        totalNodes: message.totalNodes,
        status: 'running',
      });
      sendResponse({ success: true });
      break;

    case 'workflow_complete':
      updateWorkflowOverlay({
        status: 'success',
        executedNodes: message.totalNodes,
      });
      sendResponse({ success: true });
      break;

    case 'workflow_error':
      updateWorkflowOverlay({
        status: 'error',
        error: message.error,
      });
      sendResponse({ success: true });
      break;

    case 'workflow_hide':
      removeWorkflowOverlay();
      sendResponse({ success: true });
      break;

    default:
      // Unknown message type
      break;
  }

  // Return true to indicate async response
  return false;
});

// Notify background that content script is ready
try {
  chrome.runtime.sendMessage({ type: 'content_script_loaded' });
} catch {
  // Extension context might not be ready
}
