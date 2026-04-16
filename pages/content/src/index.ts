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
 */
function generateSimpleXPath(element: HTMLElement): string {
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

    // Add id if exists
    if (current.id) {
      selector = `//*[@id="${current.id}"]`;
      parts.unshift(selector);
      break;
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

/**
 * Listen for messages from background
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
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
