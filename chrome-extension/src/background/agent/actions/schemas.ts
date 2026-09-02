import { z } from 'zod';

export interface ActionSchema {
  name: string;
  description: string;
  schema: z.ZodType;
}

export const doneActionSchema: ActionSchema = {
  name: 'done',
  description: 'Complete task',
  schema: z.object({
    text: z.string().default('').describe('summary or final answer to report to the user'),
    success: z.boolean(),
  }),
};

// Basic Navigation Actions
export const searchGoogleActionSchema: ActionSchema = {
  name: 'search_google',
  description:
    'Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    query: z.string(),
  }),
};

export const goToUrlActionSchema: ActionSchema = {
  name: 'go_to_url',
  description: 'Navigate to URL in the current tab',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url: z.string(),
  }),
};

export const goBackActionSchema: ActionSchema = {
  name: 'go_back',
  description: 'Go back to the previous page',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
};

export const clickElementActionSchema: ActionSchema = {
  name: 'click_element',
  description:
    'Click element by index. If a remembered or user-provided xpath/selector is available, include it and it must be used before any index fallback.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    // index 必须可选：提示词与本 schema 都要求「命中事实库时把 xpath/selector 原样填进来」，
    // 而记忆里的元素不一定出现在本次渲染的可交互列表里（没有 highlightIndex），此时模型
    // 根本给不出 index。强制 required 会让照做的模型被 schema 打回（缺 index → 整步失败）。
    // 与 input_text 保持一致；builder 侧的解析顺序本就是 xpath → selector → index。
    index: z
      .number()
      .int()
      .optional()
      .describe(
        'index of the element. Omit only if providing xpath/selector for a known element not in the current page summary.',
      ),
    xpath: z
      .string()
      .nullable()
      .optional()
      .describe('xpath of the element, especially from known/user-referenced elements'),
    selector: z
      .string()
      .nullable()
      .optional()
      .describe('css selector of the element, especially from known/user-referenced elements'),
  }),
};

export const inputTextActionSchema: ActionSchema = {
  name: 'input_text',
  description:
    'Input text into an interactive input element. If a remembered or user-provided xpath/selector is available, include it and it must be used before any index fallback.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z
      .number()
      .int()
      .optional()
      .describe(
        'index of the element. Omit only if providing xpath for a known element not in the current page summary.',
      ),
    text: z.string().describe('text to input'),
    xpath: z
      .string()
      .nullable()
      .optional()
      .describe('xpath of the element, especially from known/user-referenced elements'),
    selector: z
      .string()
      .nullable()
      .optional()
      .describe('css selector of the element, especially from known/user-referenced elements'),
  }),
};

// Tab Management Actions
export const switchTabActionSchema: ActionSchema = {
  name: 'switch_tab',
  description:
    'Switch to a tab by tab id. You MUST include the numeric tab_id parameter — copy it exactly from the "Available tabs" list in the page state. Never call this action without tab_id.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    tab_id: z.number().int().describe('numeric id of the tab to switch to (REQUIRED, copy from Available tabs)'),
  }),
};

export const openTabActionSchema: ActionSchema = {
  name: 'open_tab',
  description: 'Open a URL in a new tab. You MUST include the url parameter.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    url: z.string().describe('full URL to open (REQUIRED, must start with http:// or https://)'),
  }),
};

export const closeTabActionSchema: ActionSchema = {
  name: 'close_tab',
  description:
    'Close a tab by tab id. You MUST include the numeric tab_id parameter — copy it from the "Available tabs" list.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    tab_id: z.number().int().describe('numeric id of the tab to close (REQUIRED)'),
  }),
};

// Content Actions, not used currently
// export const extractContentActionSchema: ActionSchema = {
//   name: 'extract_content',
//   description:
//     'Extract page content to retrieve specific information from the page, e.g. all company names, a specific description, all information about, links with companies in structured format or simply links',
//   schema: z.object({
//     goal: z.string(),
//   }),
// };

// Cache Actions
export const cacheContentActionSchema: ActionSchema = {
  name: 'cache_content',
  description: 'Cache what you have found so far from the current page for future use',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    content: z.string().default('').describe('content to cache'),
  }),
};

export const scrollToPercentActionSchema: ActionSchema = {
  name: 'scroll_to_percent',
  description:
    'Scrolls to a particular vertical percentage of the document or an element. If no index of element is specified, scroll the whole document.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    yPercent: z.number().int().describe('percentage to scroll to - min 0, max 100; 0 is top, 100 is bottom'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const scrollToTopActionSchema: ActionSchema = {
  name: 'scroll_to_top',
  description: 'Scroll the document in the window or an element to the top',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const scrollToBottomActionSchema: ActionSchema = {
  name: 'scroll_to_bottom',
  description: 'Scroll the document in the window or an element to the bottom',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const previousPageActionSchema: ActionSchema = {
  name: 'previous_page',
  description:
    'Scroll the document in the window or an element to the previous page. If no index is specified, scroll the whole document.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const nextPageActionSchema: ActionSchema = {
  name: 'next_page',
  description:
    'Scroll the document in the window or an element to the next page. If no index is specified, scroll the whole document.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().nullable().optional().describe('index of the element'),
  }),
};

export const scrollToTextActionSchema: ActionSchema = {
  name: 'scroll_to_text',
  description: 'If you dont find something which you want to interact with in current viewport, try to scroll to it',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    text: z.string().describe('text to scroll to'),
    nth: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('which occurrence of the text to scroll to (1-indexed, default: 1)'),
  }),
};

export const sendKeysActionSchema: ActionSchema = {
  name: 'send_keys',
  description:
    'Send strings of special keys like Backspace, Insert, PageDown, Delete, Enter. Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard press. Be aware of different operating systems and their shortcuts',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    keys: z.string().describe('keys to send'),
  }),
};

export const getDropdownOptionsActionSchema: ActionSchema = {
  name: 'get_dropdown_options',
  description: 'Get all options from a native dropdown',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the dropdown element'),
  }),
};

export const selectDropdownOptionActionSchema: ActionSchema = {
  name: 'select_dropdown_option',
  description:
    'Select dropdown option for interactive element index by the text of the option you want to select. If a remembered xpath/selector is available, include it and it must be used before any index fallback.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z.number().int().describe('index of the dropdown element'),
    text: z.string().describe('text of the option'),
    xpath: z
      .string()
      .nullable()
      .optional()
      .describe('xpath of the dropdown element, especially from known/user-referenced elements'),
    selector: z
      .string()
      .nullable()
      .optional()
      .describe('css selector of the dropdown element, especially from known/user-referenced elements'),
  }),
};

export const waitActionSchema: ActionSchema = {
  name: 'wait',
  description: 'Wait for x seconds default 3, do NOT use this action unless user asks to wait explicitly',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    seconds: z.number().int().default(3).describe('amount of seconds'),
  }),
};

// Get full HTML content action
export const getFullHtmlActionSchema: ActionSchema = {
  name: 'get_full_html',
  description:
    'Get the complete HTML content of the current page or a specific element by index. Use this when the simplified element tags are not sufficient to understand the page structure or content. WARNING: This may return large content, use sparingly.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    index: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe('index of the element to get HTML for (optional, if not provided returns full page HTML)'),
    max_length: z.number().int().default(5000).describe('maximum length of HTML to return (default 5000 chars)'),
  }),
};

// User clarification action — pauses the task and asks the user a question.
export const askUserActionSchema: ActionSchema = {
  name: 'ask_user',
  description:
    'Pause the task and ask the human user a clarifying question. ONLY use this when you genuinely cannot decide on your own — ambiguous user intent, multiple plausible target elements, irreversible/risky action that needs confirmation. ' +
    'Provide `options` with stable `id`s when there are a small number of plausible choices. ' +
    "Set `allow_element_pick: true` when the uncertainty is which DOM element to click/use — the user can then point at the element directly and you'll receive its selector/xpath. " +
    'After the user answers, you receive their choice/text/picked selector in the action result; resume the task using that information. Do NOT call this for trivial steps — guess when you reasonably can.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    question: z.string().describe('the question shown to the user (concise, single sentence preferred)'),
    context: z
      .string()
      .default('')
      .describe('optional extra context shown under the question (e.g. why you are uncertain)'),
    options: z
      .array(
        z.object({
          id: z.string().describe('stable id you will receive back as choiceId'),
          label: z.string().describe('option label shown to the user'),
          description: z.string().default('').describe('optional grey sub-text for the option'),
        }),
      )
      .default([])
      .describe('preset choices (empty array = free-text only)'),
    allow_free_text: z.boolean().default(true).describe('allow the user to also type a free-text answer'),
    allow_element_pick: z
      .boolean()
      .default(false)
      .describe('show a "pick element on page" button so the user can click a DOM element directly'),
  }),
};
