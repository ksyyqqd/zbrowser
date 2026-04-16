/**
 * Recorder Manager - manages recording sessions
 */

import type { RecordedAction, RecordingSession, GeneratedSkill, ElementSelector } from './types';

/**
 * Generate unique ID (simple implementation)
 */
function generateId(): string {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Recorder state storage (in-memory for MVP)
 */
class RecorderState {
  private session: RecordingSession | null = null;
  // Deduplication: track last navigate to avoid duplicates
  private lastNavigateUrl: string | null = null;
  private lastNavigateTime: number = 0;
  // Track the tab ID where recording started
  private recordingTabId: number | null = null;
  // Minimum time between same URL navigates (ms)
  private readonly NAVIGATE_DEDUP_MS = 2000;

  startSession(tabId: number): RecordingSession {
    this.session = {
      id: generateId(),
      tabId,
      startedAt: Date.now(),
      actions: [],
      status: 'recording',
    };
    // Reset dedup state
    this.lastNavigateUrl = null;
    this.lastNavigateTime = 0;
    this.recordingTabId = tabId;
    return this.session;
  }

  stopSession(): RecordingSession | null {
    if (this.session) {
      this.session.status = 'stopped';
      this.session.endedAt = Date.now();
    }
    return this.session;
  }

  getActiveSession(): RecordingSession | null {
    if (this.session?.status === 'recording') {
      return this.session;
    }
    return null;
  }

  getSession(): RecordingSession | null {
    return this.session;
  }

  getRecordingTabId(): number | null {
    return this.recordingTabId;
  }

  addAction(action: RecordedAction): boolean {
    if (!this.session || this.session.status !== 'recording') {
      return false;
    }

    // Deduplication for navigate actions
    if (action.type === 'navigate') {
      const url = action.navigateInfo?.url || action.pageUrl;
      const now = Date.now();

      // Skip if same URL within dedup window (increased to 2s)
      if (url === this.lastNavigateUrl && now - this.lastNavigateTime < this.NAVIGATE_DEDUP_MS) {
        console.log('[Recorder] Skipping duplicate navigate (same URL within 2s):', url);
        return false;
      }

      this.lastNavigateUrl = url;
      this.lastNavigateTime = now;
    }

    this.session.actions.push(action);
    return true;
  }

  removeAction(actionId: string): boolean {
    if (!this.session) return false;
    const index = this.session.actions.findIndex(a => a.id === actionId);
    if (index >= 0) {
      this.session.actions.splice(index, 1);
      return true;
    }
    return false;
  }

  updateAction(actionId: string, updates: Partial<RecordedAction>): boolean {
    if (!this.session) return false;
    const action = this.session.actions.find(a => a.id === actionId);
    if (action) {
      Object.assign(action, updates);
      return true;
    }
    return false;
  }

  clearSession(): void {
    this.session = null;
    this.lastNavigateUrl = null;
    this.lastNavigateTime = 0;
    this.recordingTabId = null;
  }
}

/**
 * Element selector generator - creates stable selectors for elements
 */
class SelectorGenerator {
  /**
   * Generate selectors from element info received from content script
   */
  generateSelectors(elementInfo: {
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
  }): ElementSelector {
    const selectors: string[] = [];
    const fallbacks: string[] = [];
    const attributes: Record<string, string> = {};

    // 1. ID selector (most stable)
    if (elementInfo.id) {
      selectors.push(`#${elementInfo.id}`);
      attributes['id'] = elementInfo.id;
    }

    // 2. Data-testid / data-cy / data-qa selectors
    if (elementInfo.dataTestId) {
      selectors.push(`[data-testid="${elementInfo.dataTestId}"]`);
      attributes['data-testid'] = elementInfo.dataTestId;
    }

    // 3. Name attribute
    if (elementInfo.name) {
      const selector = `${elementInfo.tagName.toLowerCase()}[name="${elementInfo.name}"]`;
      fallbacks.push(selector);
      attributes['name'] = elementInfo.name;
    }

    // 4. Type + placeholder combination
    if (elementInfo.type && elementInfo.placeholder) {
      const selector = `${elementInfo.tagName.toLowerCase()}[type="${elementInfo.type}"][placeholder="${elementInfo.placeholder}"]`;
      fallbacks.push(selector);
      attributes['type'] = elementInfo.type;
      attributes['placeholder'] = elementInfo.placeholder;
    }

    // 5. Aria-label
    if (elementInfo.ariaLabel) {
      const selector = `[aria-label="${elementInfo.ariaLabel}"]`;
      fallbacks.push(selector);
      attributes['aria-label'] = elementInfo.ariaLabel;
    }

    // 6. Class-based selector (less stable but useful as fallback)
    if (elementInfo.className) {
      const classes = elementInfo.className
        .split(' ')
        .filter(c => c && !c.includes(':') && c.length > 2)
        .slice(0, 2);
      if (classes.length > 0) {
        const classSelector = classes.map(c => `.${c}`).join('');
        fallbacks.push(`${elementInfo.tagName.toLowerCase()}${classSelector}`);
      }
    }

    // 7. Text content for buttons/links
    if (
      elementInfo.textContent &&
      (elementInfo.tagName === 'BUTTON' || elementInfo.tagName === 'A' || elementInfo.tagName === 'SPAN')
    ) {
      const text = elementInfo.textContent.trim().slice(0, 50);
      if (text) {
        // This will be used for text-based matching
        return {
          primary: selectors[0] || fallbacks[0] || elementInfo.tagName.toLowerCase(),
          fallbacks,
          xpath: elementInfo.xpath,
          textContent: text,
          attributes,
          tagName: elementInfo.tagName,
        };
      }
    }

    return {
      primary: selectors[0] || fallbacks[0] || elementInfo.tagName.toLowerCase(),
      fallbacks,
      xpath: elementInfo.xpath,
      attributes,
      tagName: elementInfo.tagName,
    };
  }
}

/**
 * Action to Skill converter
 */
class ActionConverter {
  /**
   * Convert recorded action to skill step
   */
  convertAction(
    action: RecordedAction,
    stepIndex: number,
  ): {
    id: string;
    action: string;
    description?: string;
    parameters: Record<string, unknown>;
    onError: 'stop' | 'continue' | 'retry';
  } {
    const stepId = `step${stepIndex + 1}`;

    switch (action.type) {
      case 'navigate': {
        return {
          id: stepId,
          action: 'go_to_url',
          description: `Navigate to ${action.navigateInfo?.title || action.pageUrl}`,
          parameters: {
            intent: `Navigate to ${action.navigateInfo?.url}`,
            url: action.navigateInfo?.url || action.pageUrl,
          },
          onError: 'stop',
        };
      }

      case 'click': {
        const selector = action.element?.primary || '';
        const description = action.element?.textContent
          ? `Click "${action.element.textContent.slice(0, 30)}"`
          : `Click ${action.element?.tagName || 'element'}`;

        return {
          id: stepId,
          action: 'click_element',
          description,
          parameters: {
            intent: description,
            selector,
            xpath: action.element?.xpath,
          },
          onError: 'retry',
        };
      }

      case 'input': {
        const selector = action.element?.primary || '';
        const description = action.element?.textContent
          ? `Input into "${action.element.textContent.slice(0, 20)}"`
          : `Input into ${action.element?.tagName || 'input field'}`;

        // Check if value looks like a parameter (could be replaced by user)
        const isParametric = this.isParametricValue(action.value || '');

        return {
          id: stepId,
          action: 'input_text',
          description,
          parameters: {
            intent: description,
            selector,
            xpath: action.element?.xpath,
            text: isParametric ? '{{inputValue}}' : action.value || '',
          },
          onError: 'stop',
        };
      }

      case 'keydown': {
        const key = action.keys || '';
        const isEnter = key === 'Enter';
        return {
          id: stepId,
          action: 'send_keys',
          description: isEnter ? 'Press Enter' : `Press ${key}`,
          parameters: {
            intent: isEnter ? 'Submit or confirm' : `Send key ${key}`,
            keys: key,
          },
          onError: 'stop',
        };
      }

      case 'scroll': {
        return {
          id: stepId,
          action: 'scroll_to_percent',
          description: `Scroll to ${action.scrollInfo?.yPercent || 50}%`,
          parameters: {
            intent: 'Scroll page',
            yPercent: action.scrollInfo?.yPercent || 50,
          },
          onError: 'continue',
        };
      }

      case 'select': {
        return {
          id: stepId,
          action: 'select_dropdown_option',
          description: `Select "${action.value?.slice(0, 20)}"`,
          parameters: {
            intent: `Select option ${action.value}`,
            selector: action.element?.primary,
            text: action.value || '',
          },
          onError: 'stop',
        };
      }

      case 'copy': {
        const copiedText = action.value || action.selectionInfo?.text || '';
        const description = copiedText
          ? `Copy "${copiedText.slice(0, 30)}${copiedText.length > 30 ? '...' : ''}"`
          : 'Copy content';
        return {
          id: stepId,
          action: 'copy_text',
          description,
          parameters: {
            intent: description,
            selectionInfo: action.selectionInfo,
          },
          onError: 'continue',
        };
      }

      case 'paste': {
        const pastedText = action.value || '';
        const description = pastedText
          ? `Paste "${pastedText.slice(0, 30)}${pastedText.length > 30 ? '...' : ''}"`
          : 'Paste content';
        const isParametric = this.isParametricValue(pastedText);
        return {
          id: stepId,
          action: 'paste_text',
          description,
          parameters: {
            intent: description,
            text: isParametric ? '{{pasteValue}}' : pastedText,
            pasteInfo: action.pasteInfo,
          },
          onError: 'stop',
        };
      }

      case 'cut': {
        const cutText = action.value || '';
        const description = cutText
          ? `Cut "${cutText.slice(0, 30)}${cutText.length > 30 ? '...' : ''}"`
          : 'Cut content';
        return {
          id: stepId,
          action: 'cut_text',
          description,
          parameters: {
            intent: description,
            cutInfo: action.cutInfo,
          },
          onError: 'continue',
        };
      }

      default:
        return {
          id: stepId,
          action: 'wait',
          description: 'Unknown action',
          parameters: { intent: 'Wait', seconds: 1 },
          onError: 'continue',
        };
    }
  }

  /**
   * Check if value should be converted to parameter
   */
  private isParametricValue(value: string): boolean {
    // Values that look like user-specific data
    const patterns = [
      /^[A-Z]/, // Capital letters (names, titles)
      /\d{4,}/, // Numbers (IDs, prices)
      /@/, // Email-like
      /\d+\.\d+/, // Decimal numbers
      /https?:\/\//, // URLs
      /.{20,}/, // Long text
    ];

    return patterns.some(p => p.test(value));
  }

  /**
   * Extract parameters from recorded actions
   */
  extractParameters(actions: RecordedAction[]): Array<{
    name: string;
    type: 'string' | 'number';
    description: string;
    required: boolean;
    default?: string;
  }> {
    const params: Array<{
      name: string;
      type: 'string' | 'number';
      description: string;
      required: boolean;
      default?: string;
    }> = [];

    // Find input actions with parametric values
    for (const action of actions) {
      if (action.type === 'input' && this.isParametricValue(action.value || '')) {
        const existingParam = params.find(p => p.name === 'inputValue');
        if (!existingParam && action.value) {
          params.push({
            name: 'inputValue',
            type: 'string',
            description: 'Text to input',
            required: true,
            default: action.value.slice(0, 50),
          });
        }
      }
      // Find paste actions with parametric values
      if (action.type === 'paste' && this.isParametricValue(action.value || '')) {
        const existingParam = params.find(p => p.name === 'pasteValue');
        if (!existingParam && action.value) {
          params.push({
            name: 'pasteValue',
            type: 'string',
            description: 'Text to paste',
            required: true,
            default: action.value.slice(0, 50),
          });
        }
      }
    }

    return params;
  }
}

/**
 * Export singleton instances
 */
export const recorderState = new RecorderState();
export const selectorGenerator = new SelectorGenerator();
export const actionConverter = new ActionConverter();

/**
 * Generate skill from recording session
 */
export function generateSkillFromRecording(
  session: RecordingSession,
  skillName: string,
  skillDescription: string,
): GeneratedSkill {
  // Skip initial navigate if it's the starting page
  let actions = session.actions;
  if (actions.length > 0 && actions[0].type === 'navigate') {
    // Keep the navigate as first step
  }

  const steps = actions.map((action, index) => actionConverter.convertAction(action, index));
  const parameters = actionConverter.extractParameters(actions);

  return {
    id: `recorded-${session.id}`,
    name: skillName,
    description: skillDescription,
    category: 'automation',
    parameters,
    steps,
    executionMode: 'expanded',
  };
}
