/**
 * Recording types for the recorder module
 * MVP version: supports click, input, scroll, keydown, navigate
 */

/**
 * Selector strategy for element location (multi-layer fallback)
 */
export interface ElementSelector {
  /** Primary CSS selector */
  primary: string;
  /** Fallback selectors when primary fails */
  fallbacks: string[];
  /** XPath selector as last resort */
  xpath?: string;
  /** Text content for text-based matching */
  textContent?: string;
  /** Key attributes for attribute matching */
  attributes: Record<string, string>;
  /** Element tag name */
  tagName: string;
}

/**
 * Recorded action types
 */
export type RecordedActionType =
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

/**
 * Tab info for tab_open / tab_switch / tab_close synthetic actions
 */
export interface TabInfo {
  /** URL of the tab when the event happened */
  url?: string;
  /** Title of the tab when the event happened */
  title?: string;
  /** Opener tab id (only set for tab_open) */
  openerTabId?: number;
}

/**
 * Selection info for copy/cut actions
 */
export interface SelectionInfo {
  /** Selected text (limited to first 200 chars) */
  text: string;
  /** Full selection length */
  length: number;
}

/**
 * Paste info for paste actions
 */
export interface PasteInfo {
  /** Full pasted content length */
  length: number;
  /** Whether paste includes image */
  isImage: boolean;
}

/**
 * Cut info for cut actions
 */
export interface CutInfo {
  /** Full cut content length */
  length: number;
}

/**
 * Single recorded action
 */
export interface RecordedAction {
  /** Unique action ID */
  id: string;
  /** Action type */
  type: RecordedActionType;
  /** Timestamp when action occurred */
  timestamp: number;
  /** Tab ID where the action occurred (for cross-tab recording) */
  tabId?: number;
  /** Tab info for tab_open / tab_switch / tab_close */
  tabInfo?: TabInfo;
  /** Element selector info (for click/input/scroll/select) */
  element?: ElementSelector;
  /** Value for input/select/copy/paste/cut actions */
  value?: string;
  /** Keys for keydown actions */
  keys?: string;
  /** Scroll position info */
  scrollInfo?: {
    x: number;
    y: number;
    yPercent?: number;
  };
  /** Navigate info */
  navigateInfo?: {
    url: string;
    title: string;
  };
  /** Selection info for copy actions */
  selectionInfo?: SelectionInfo;
  /** Paste info for paste actions */
  pasteInfo?: PasteInfo;
  /** Cut info for cut actions */
  cutInfo?: CutInfo;
  /** Page URL when action occurred */
  pageUrl: string;
  /** Page title */
  pageTitle: string;
}

/**
 * Recording session
 */
export interface RecordingSession {
  /** Session ID */
  id: string;
  /** Tab ID where the session was started (kept for backwards compatibility) */
  tabId: number;
  /** All tab IDs currently being tracked */
  tabIds: number[];
  /** Currently focused tab id (last activated tracked tab) */
  activeTabId?: number;
  /** Start timestamp */
  startedAt: number;
  /** End timestamp (null if ongoing) */
  endedAt?: number;
  /** Recorded actions */
  actions: RecordedAction[];
  /** Session status */
  status: 'recording' | 'stopped' | 'completed';
}

/**
 * Recording message types for communication
 */
export interface RecordingMessages {
  // Background -> Content Script
  start_recording: {
    sessionId: string;
  };
  stop_recording: {};
  pause_recording: {};
  resume_recording: {};

  // Content Script -> Background
  recorded_action: {
    sessionId: string;
    action: RecordedAction;
  };

  // Background -> Side Panel
  recording_state_update: {
    session: RecordingSession;
  };
  recording_completed: {
    session: RecordingSession;
    skillId?: string;
  };

  // Side Panel -> Background
  get_recording_state: {};
  save_recording_as_skill: {
    sessionId: string;
    skillName: string;
    skillDescription: string;
  };
}

/**
 * Convert recorded action to Skill step parameters
 */
export interface ActionToSkillStep {
  actionName: string;
  parameters: Record<string, unknown>;
  onError: 'stop' | 'continue' | 'retry';
  description?: string;
}

/**
 * Generated skill from recording
 */
export interface GeneratedSkill {
  id: string;
  name: string;
  description: string;
  category: 'automation';
  parameters: Array<{
    name: string;
    type: 'string' | 'number';
    description: string;
    required: boolean;
    default?: string;
  }>;
  steps: Array<{
    id: string;
    action: string;
    description?: string;
    parameters: Record<string, unknown>;
    onError: 'stop' | 'continue' | 'retry';
  }>;
  executionMode: 'expanded' | 'atomic';
}
