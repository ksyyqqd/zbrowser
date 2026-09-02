import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  analyticsSettingsStore,
  userWorkflowsStore,
  isWorkflowReviewed,
} from '@extension/storage';
import { t } from '@extension/i18n';
import BrowserContext from './browser/context';
import type Page from './browser/page';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState, MCP_ENABLED } from '@extension/shared';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { injectBuildDomTreeScripts } from './browser/dom/service';
import { analytics } from './services/analytics';
import { MCPService } from './services/mcp';
import { SkillsService, createSkillFromAI } from './services/skills';
import {
  WorkflowService,
  guardOrchestration,
  createWorkflowFromAI,
  updateWorkflowFromAI,
  type OrchestrationFrame,
} from './services/workflow';
import type { WorkflowResult, Workflow, WorkflowEvent } from '@extension/workflow';
import { recorderState, selectorGenerator, generateSkillFromRecording } from './recorder';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');
const OPTIONS_URL = chrome.runtime.getURL('options/index.html');
// Long-lived ports from Options pages (multiple instances allowed)
const optionsPorts = new Set<chrome.runtime.Port>();

// Initialize MCP and Skills services
// MCP 被 MCP_ENABLED 屏蔽时不实例化 —— 不建连接、不注册 action、prompt 里也不提它。
const mcpService = MCP_ENABLED ? new MCPService() : null;
const skillsService = new SkillsService();
const workflowService = new WorkflowService();

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    await injectBuildDomTreeScripts(tabId);
  }
});

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  console.log('Debugger detached:', source, reason);
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      currentExecutor?.cancel();
      await browserContext.cleanup();
    }
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  browserContext.removeAttachedPage(tabId);
});

logger.info('background loaded');

// Initialize MCP and Skills services
Promise.all([mcpService?.initialize(), skillsService.initialize(), workflowService.initialize()])
  .then(() => {
    logger.info(`Skills and Workflow services initialized (MCP ${MCP_ENABLED ? 'enabled' : 'disabled'})`);
  })
  .catch(error => {
    logger.error('Failed to initialize MCP/Skills/Workflow services:', error);
  });

// Initialize analytics
analytics.init().catch(error => {
  logger.error('Failed to initialize analytics:', error);
});

// Listen for analytics settings changes
analyticsSettingsStore.subscribe(() => {
  analytics.updateSettings().catch(error => {
    logger.error('Failed to update analytics settings:', error);
  });
});

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle MCP related messages
  if (message.type === 'MCP_TEST_CONNECTION') {
    handleMCPTestConnection(message.config)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error instanceof Error ? error.message : 'Test failed' }));
    return true; // Keep the message channel open for async response
  }

  if (message.type === 'MCP_LIST_TOOLS') {
    handleMCPListTools(message.serverId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ tools: [], error: error instanceof Error ? error.message : 'Failed' }));
    return true;
  }

  if (message.type === 'SKILLS_LIST') {
    handleSkillsList(message.category)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ skills: [], error: error instanceof Error ? error.message : 'Failed' }));
    return true;
  }

  // Handle workflow execution from options page
  if (message.type === 'execute_workflow') {
    handleExecuteWorkflow(message)
      .then(result => sendResponse(result))
      .catch(error =>
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Execution failed' }),
      );
    return true; // Keep the message channel open for async response
  }

  // Inject the element-picker overlay into a chosen tab. The page enters a
  // mode where hovering highlights elements and clicking sends back the
  // selector + xpath of the picked element. Used by the workflow editor's
  // "拾取元素" helper for selector / xpath fields.
  if (message.type === 'pick_element_start') {
    const tabId: number | undefined = message.tabId;
    if (typeof tabId !== 'number') {
      sendResponse({ success: false, error: 'Missing tabId' });
      return false;
    }
    handlePickElementStart(tabId)
      .then(result => sendResponse(result))
      .catch(error =>
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Pick element failed' }),
      );
    return true;
  }

  return false;
});

// ============ Pick Element (workflow editor helper) ============

/** 被拾取元素的语义证据，随 locator 一起回传 */
type PickedEvidence = {
  tagName?: string;
  role?: string;
  ariaLabel?: string;
  title?: string;
  placeholder?: string;
  dataTestId?: string;
  disabled?: boolean;
};

export type PickElementResult = {
  success: boolean;
  selector?: string;
  /** 基于 data-testid / aria-label 等稳定属性的备用选择器（主选择器依赖构建期哈希 class 时可用） */
  stableSelector?: string;
  xpath?: string;
  text?: string;
  evidence?: PickedEvidence;
  error?: string;
};

/**
 * Inject a transient element-picker overlay into the target tab and wait for
 * the user to click an element. Returns the resolved selector + xpath.
 */
async function handlePickElementStart(tabId: number): Promise<PickElementResult> {
  // Activate the target tab so the user immediately sees where to click.
  try {
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    /* ignore — focusing is best-effort */
  }

  return new Promise(resolve => {
    let settled = false;
    const finish = (result: PickElementResult) => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(onMsg);
      resolve(result);
    };
    const onMsg = (msg: { type?: string } & PickElementResult) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'pick_element_done') {
        finish({
          success: true,
          selector: msg.selector,
          stableSelector: msg.stableSelector,
          xpath: msg.xpath,
          text: msg.text,
          evidence: msg.evidence,
        });
      } else if (msg.type === 'pick_element_cancel') {
        finish({ success: false, error: 'cancelled' });
      }
    };
    chrome.runtime.onMessage.addListener(onMsg);

    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [0] },
        func: injectedElementPicker,
      })
      .catch(err => {
        finish({ success: false, error: err instanceof Error ? err.message : 'Injection failed' });
      });

    // Safety timeout — 2 minutes — so a forgotten picker doesn't leak.
    setTimeout(() => finish({ success: false, error: 'timeout' }), 120_000);
  });
}

/**
 * The element picker that runs INSIDE the target page. Self-contained.
 */
function injectedElementPicker() {
  const w = window as unknown as { __nb_picker_active__?: boolean };
  if (w.__nb_picker_active__) return;
  w.__nb_picker_active__ = true;

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #2563eb;background:rgba(37,99,235,0.12);transition:all 60ms;box-sizing:border-box;border-radius:2px;';
  const label = document.createElement('div');
  label.style.cssText =
    'position:fixed;z-index:2147483647;background:#1e293b;color:white;padding:4px 8px;font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;border-radius:4px;pointer-events:none;max-width:480px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  label.textContent = '将鼠标移到目标元素上 → 点击拾取（↑↓ 换层，Esc 取消）';
  document.documentElement.append(overlay, label);

  /** 鼠标当前命中的原始节点（可能是按钮内部的背景层/图标层） */
  let hoverTarget: Element | null = null;
  /** hoverTarget 到 <html> 的祖先链，index 越大越靠外 */
  let ancestors: Element[] = [];
  /** 自动解析出的"可操作层"在 ancestors 里的下标 */
  let basisIndex = 0;
  /** 用户用 ↑↓ 手动偏移的层数，0 表示采用自动解析结果 */
  let layerOffset = 0;
  /** 最终会被记录的那一层 */
  let current: Element | null = null;

  const move = (x: number, y: number) => {
    label.style.left = `${Math.min(window.innerWidth - 460, Math.max(8, x + 14))}px`;
    label.style.top = `${Math.max(8, y + 18)}px`;
  };

  /**
   * 判断一个元素是不是"强信号可操作元素"。
   * 命中任意一条就认为它自己就是操作目标，不必再往外找。
   */
  const isActionableElement = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'input', 'select', 'textarea', 'summary', 'label', 'option'].includes(tag)) return true;

    const role = (el.getAttribute('role') || '').toLowerCase();
    if (
      ['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'checkbox', 'radio', 'switch', 'textbox'].includes(role)
    )
      return true;

    if (el.hasAttribute('onclick')) return true;
    if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true;

    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) >= 0) return true;

    return false;
  };

  /**
   * 从鼠标命中的节点向上解析出真正该被记录的那一层。
   *
   * 为什么需要：鼠标停在按钮的背景层/图标层是常态（例如 DeepSeek 发送按钮实际命中的是
   * div.ds-button__background，而按钮本体是外层 div.ds-button--primary）。click 事件会冒泡，
   * 所以点内层通常也能触发；但 **输入类操作不会** —— 往 wrapper 上打字什么都不会发生，
   * focus 和 keyboard 事件没有 click 那样的冒泡补救。同时 disabled / aria-disabled /
   * aria-label 都挂在按钮本体上，记到内层就永远读不到这些证据。
   *
   * 解析策略（保守优先，宁可少走一层也不要越过真正的目标）：
   *  1. 命中强信号（button / a / role=button / onclick / tabindex>=0 ...）→ 立即停，那就是目标
   *  2. 否则沿 `cursor: pointer` 往上走。cursor 是**继承**属性，按钮内部的装饰层会继承
   *     按钮的 pointer，所以"pointer 区域的最外层"通常正好是按钮本体
   *  3. 两个封顶条件，防止整张卡片都是 pointer 时走过头：
   *     - 最多 MAX_LIFT 层
   *     - 包围盒面积增长超过 AREA_GROWTH_LIMIT 倍就停（换了个量级说明已经不是同一个控件）
   */
  const resolveActionableAncestor = (start: Element, chain: Element[]): number => {
    const MAX_LIFT = 5;
    const AREA_GROWTH_LIMIT = 2;

    const areaOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    };

    const startArea = areaOf(start);
    let best = 0;

    for (let i = 0; i < chain.length && i <= MAX_LIFT; i++) {
      const el = chain[i];

      // 1. 强信号 —— 直接采用，不再往外看
      if (isActionableElement(el)) return i;

      if (i === 0) continue;

      // 3. 面积封顶
      const area = areaOf(el);
      if (startArea > 0 && area > startArea * AREA_GROWTH_LIMIT) break;

      // 2. cursor: pointer 链
      let cursor = '';
      try {
        cursor = window.getComputedStyle(el).cursor;
      } catch {
        break;
      }
      if (cursor !== 'pointer') break;

      best = i;
    }

    return best;
  };

  /** 采集从 el 到 <html> 的祖先链 */
  const collectAncestors = (el: Element): Element[] => {
    const chain: Element[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
      chain.push(cur);
      cur = cur.parentElement;
    }
    return chain;
  };

  /**
   * 读取被拾取元素的语义证据，跟 locator 一起回传。
   *
   * 事实库里现在只存 purpose + 哈希类名选择器，模型看不到「这个按钮是灰的」之类的信息。
   * 把 disabled / aria-label / 可见文本一并带回来，模型判断把握度时才有据可依。
   */
  const collectEvidence = (el: Element) => {
    const ariaDisabled = (el.getAttribute('aria-disabled') || '').toLowerCase();
    return {
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      title: el.getAttribute('title') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || undefined,
      disabled: (el as HTMLButtonElement).disabled === true || ariaDisabled === 'true',
    };
  };

  const computeCssSelector = (el: Element): string => {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
      return `#${el.id}`;
    }
    const parts: string[] = [];
    let cur: Element | null = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html' && depth < 6) {
      let segment = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
        segment = `#${cur.id}`;
        parts.unshift(segment);
        break;
      }
      const classes = Array.from(cur.classList || []).filter(c => /^[A-Za-z_][\w-]*$/.test(c));
      if (classes.length > 0) {
        segment += '.' + classes.slice(0, 2).join('.');
      } else if (cur.parentElement) {
        const siblings = Array.from(cur.parentElement.children).filter(c => c.tagName === (cur as Element).tagName);
        if (siblings.length > 1) {
          segment += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(segment);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  };

  /**
   * 基于稳定属性生成备用 CSS 选择器。
   *
   * computeCssSelector 依赖 class，而现代前端的 class 多是构建期哈希（div._020ab5b），
   * 下次发版就失效。data-testid / aria-label / name 这类属性跨版本稳定得多，
   * 作为同级候选存下来，主选择器失效时还能命中。
   *
   * 只在选择器能唯一命中时返回 —— 命中多个的选择器会被 page.ts 的多匹配保护拒绝执行，
   * 存下来反而是噪音。
   */
  const computeStableSelector = (el: Element): string | undefined => {
    const tag = el.tagName.toLowerCase();
    const attrs = ['data-testid', 'data-test-id', 'aria-label', 'name', 'placeholder', 'title'];
    const cssEscape = (v: string) => v.replace(/["\\]/g, '\\$&');

    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (!value || value.length > 100) continue;
      const candidate = `${tag}[${attr}="${cssEscape(value)}"]`;
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch {
        /* 属性值里有奇怪字符导致选择器非法 —— 跳过 */
      }
    }
    return undefined;
  };

  const computeXpath = (el: Element): string => {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${cur.tagName.toLowerCase()}[${idx}]`);
      cur = cur.parentElement;
    }
    return '/html/' + parts.join('/');
  };

  /**
   * 按当前的 basisIndex + layerOffset 重算 current，并刷新高亮框和标签。
   *
   * 标签显示的是**最终会被记录的那一层**，不是鼠标命中的那一层 —— 自动解析不可能对所有站点
   * 都猜对，但拾取是用户在场的交互：把结果显示出来、允许 ↑↓ 调整，就把「没法保证猜准」
   * 从算法问题变成了可核对的 UI 问题。这是唯一能真正保证准确性的手段。
   */
  const refresh = () => {
    if (!ancestors.length) return;
    const idx = Math.min(ancestors.length - 1, Math.max(0, basisIndex + layerOffset));
    current = ancestors[idx];

    const r = current.getBoundingClientRect();
    overlay.style.left = `${r.left}px`;
    overlay.style.top = `${r.top}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;

    const ev = collectEvidence(current);
    const descriptor = [
      current.tagName.toLowerCase(),
      current.id ? `#${current.id}` : '',
      ev.role ? `[role=${ev.role}]` : '',
    ].join('');
    const lifted = idx > 0 ? ` ↑${idx}层` : '';
    const disabled = ev.disabled ? ' ⚠已禁用' : '';
    const name = ev.ariaLabel || ev.dataTestId || (current.textContent || '').trim().slice(0, 24);
    label.textContent = `${descriptor}${lifted}${disabled}${name ? ` — ${name}` : ''} — 点击拾取（↑↓ 换层，Esc 取消）`;
  };

  const onMove = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target || target === overlay || target === label) return;
    if (target === hoverTarget) {
      move(e.clientX, e.clientY);
      return;
    }

    hoverTarget = target;
    ancestors = collectAncestors(target);
    basisIndex = resolveActionableAncestor(target, ancestors);
    // 换了目标元素就丢弃之前的手动偏移 —— 偏移是针对某个具体元素调的，带到下一个没有意义
    layerOffset = 0;
    refresh();
    move(e.clientX, e.clientY);
  };
  const cleanup = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('wheel', onWheel, true);
    overlay.remove();
    label.remove();
    w.__nb_picker_active__ = false;
  };
  const onClick = (e: MouseEvent) => {
    if (!current) return;
    e.preventDefault();
    e.stopPropagation();
    const selector = computeCssSelector(current);
    const stableSelector = computeStableSelector(current);
    const xpath = computeXpath(current);
    const text = (current.textContent || '').trim().slice(0, 200);
    chrome.runtime.sendMessage({
      type: 'pick_element_done',
      selector,
      stableSelector,
      xpath,
      text,
      evidence: collectEvidence(current),
    });
    cleanup();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      chrome.runtime.sendMessage({ type: 'pick_element_cancel' });
      cleanup();
      return;
    }
    // ↑ 往外一层（父元素），↓ 往内一层，回到鼠标实际命中的节点
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const next = basisIndex + layerOffset + (e.key === 'ArrowUp' ? 1 : -1);
      if (next < 0 || next > ancestors.length - 1) return;
      layerOffset = next - basisIndex;
      refresh();
    }
  };
  // 拾取期间禁止滚动，否则高亮框会跟元素错位（overlay 用的是 fixed 定位）
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
}

/**
 * Build a prioritized list of selectors from workflow action parameters.
 * Order: primary selector → xpath → fallbacks → attribute-based selectors
 */
function buildSelectorList(params: Record<string, unknown>): string[] {
  const selectors: string[] = [];

  // 1. XPath first — most precise, records exact element position in DOM tree
  const xpath = params.xpath as string;
  if (xpath && xpath.trim()) {
    selectors.push(xpath.trim());
  }

  // 2. Primary CSS selector (may match multiple elements, used as fallback)
  const primary = params.selector as string;
  if (primary && primary.trim()) {
    selectors.push(primary.trim());
  }

  // 3. Fallback selectors
  const fallbacks = params.fallbacks as string[] | undefined;
  if (fallbacks && Array.isArray(fallbacks)) {
    for (const fb of fallbacks) {
      if (fb && fb.trim() && !selectors.includes(fb.trim())) {
        selectors.push(fb.trim());
      }
    }
  }

  // 4. Build attribute-based selectors from recorded attributes
  const attributes = params.attributes as Record<string, string> | undefined;
  // tagName may be stored either as a top-level field (legacy
  // selectorGenerator output) or embedded inside attributes (RecordingPill's
  // actionToParams output). Accept both.
  const tagName = ((params.tagName as string) || attributes?.tagName || '').toLowerCase() || undefined;
  if (attributes && tagName) {
    // Try common attribute combinations
    const attrSelectors: string[] = [];

    // id
    if (attributes.id) {
      attrSelectors.push(`#${attributes.id}`);
    }

    // data-testid
    if (attributes['data-testid']) {
      attrSelectors.push(`[data-testid="${attributes['data-testid']}"]`);
    }

    // name
    if (attributes.name) {
      attrSelectors.push(`${tagName}[name="${attributes.name}"]`);
    }

    // type + placeholder combination (for inputs)
    if (attributes.type && attributes.placeholder) {
      attrSelectors.push(`${tagName}[type="${attributes.type}"][placeholder="${attributes.placeholder}"]`);
    }

    // placeholder alone (common for chat inputs)
    if (attributes.placeholder) {
      attrSelectors.push(`${tagName}[placeholder="${attributes.placeholder}"]`);
    }

    // aria-label
    if (attributes.ariaLabel) {
      attrSelectors.push(`[aria-label="${attributes.ariaLabel}"]`);
    }

    for (const attrSel of attrSelectors) {
      if (!selectors.includes(attrSel)) {
        selectors.push(attrSel);
      }
    }
  }

  // 5. Last-resort fallback: bare tag name. For SPAs with a single textarea /
  // input (chat boxes, search bars) this rescues clicks/inputs when every
  // brittle path-based selector has gone stale. Restricted to a small allowlist
  // so we don't accidentally click "div".
  if (tagName && ['textarea', 'input', 'select', 'button'].includes(tagName)) {
    if (!selectors.includes(tagName)) {
      selectors.push(tagName);
    }
  }

  return selectors;
}

// Handler function for workflow execution
async function handleExecuteWorkflow(message: {
  workflowId: string;
  tabId?: number;
  taskId?: string;
  params?: Record<string, unknown>;
  showOverlay?: boolean; // 是否显示工作流进度遮罩
  /**
   * 编排链。用户从 UI 点执行时不传（顶层）；工作流内部的 ai 节点唤起 Executor、
   * 那个 Executor 再触发工作流执行时带上调用方的链，用于环检测和深度上限。
   * 见 services/workflow/orchestrationDepth.ts。
   */
  orchestrationStack?: OrchestrationFrame[];
}): Promise<{ success: boolean; result?: WorkflowResult; error?: string }> {
  const workflowId = message.workflowId;
  const params = message.params || {};
  const showOverlay = message.showOverlay ?? false; // 默认不显示

  if (!workflowId) {
    return { success: false, error: 'Workflow ID is required' };
  }

  // 深度/环检测：必须在做任何事（开 tab、attach debugger）之前，否则被拦下的调用
  // 已经留下了副作用。
  const guard = guardOrchestration(message.orchestrationStack, { kind: 'workflow', id: workflowId });
  if (!guard.ok) {
    logger.error('Workflow orchestration blocked:', guard.error);
    return { success: false, error: guard.error };
  }
  const orchestrationStack = guard.stack;

  logger.info('execute_workflow request', workflowId, 'showOverlay:', showOverlay);

  // Declare variables outside try block for catch access
  let workflow: Workflow | undefined;
  let targetTabId: number | undefined;
  let targetPage: Page | null = null;

  try {
    // Get workflow from registry (always fetches latest from storage)
    workflow = await workflowService.getWorkflowInfo(workflowId);
    if (!workflow) {
      return { success: false, error: `Workflow "${workflowId}" not found` };
    }

    // 未确认的工作流不能执行。这是 `reviewed` 唯一的执行侧门禁 —— AI 写过的图
    // （新建或修改）没被任何人看过，直接跑等于让未经审核的脚本操作浏览器。
    // 放在这里而不是各个调用点：这是唯一的执行入口，UI 按钮、书签、快速执行都走它。
    const storedConfig = await userWorkflowsStore.getWorkflow(workflowId);
    if (storedConfig && !isWorkflowReviewed(storedConfig)) {
      logger.warning('Refusing to execute unreviewed workflow:', workflowId);
      return { success: false, error: t('bg_workflow_unreviewed') };
    }

    // If the workflow starts with a go_to_url action, open a new tab for that URL
    // up front so that targetPage is set and subsequent nodes can operate on it.
    const startNode = workflow.nodes.find((n: { type: string }) => n.type === 'start');
    const firstEdge = workflow.edges.find((e: { source: string }) => e.source === startNode?.id);
    const firstNodeId = firstEdge?.target;
    const firstNode = workflow.nodes.find((n: { id: string }) => n.id === firstNodeId);

    if (firstNode?.type === 'automation' && firstNode.data.action === 'go_to_url') {
      const targetUrl = (firstNode.data.parameters?.url as string) || (params.url as string);
      if (targetUrl) {
        logger.info('Workflow starts with go_to_url, opening new tab:', targetUrl);
        const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
        if (newTab.id) {
          targetTabId = newTab.id;
          browserContext.updateCurrentTabId(newTab.id);
          // Wait for page to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          targetPage = await browserContext.getCurrentPage();
          logger.info('Pre-opened tab for workflow:', newTab.id, targetUrl);
        }
      }
    }

    // If no target page from go_to_url, find existing valid tab
    if (!targetPage) {
      // Search for existing http/https tabs
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      logger.info('Searching for valid web page tab among', allTabs.length, 'tabs');

      for (const tab of allTabs) {
        if (tab.id && tab.url && tab.url.startsWith('http')) {
          browserContext.updateCurrentTabId(tab.id);
          const page = await browserContext.getCurrentPage();
          if (page && page.validWebPage) {
            targetPage = page;
            targetTabId = tab.id;
            logger.info('Found existing valid tab:', tab.id, tab.url);
            break;
          }
        }
      }
    }

    // Still no valid page? Create a blank tab
    if (!targetPage) {
      logger.info('No valid tab found, creating a new tab');
      targetPage = await browserContext.openTab('');
      if (targetPage?.tabId) {
        targetTabId = targetPage.tabId;
        // Wait for blank page
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Final check
    if (!targetPage || !targetPage.tabId) {
      return {
        success: false,
        error: '无法创建执行页面，请检查浏览器状态',
      };
    }

    targetTabId = targetPage.tabId;

    // Attach the page if not already attached
    if (!targetPage.attached && targetPage.validWebPage) {
      logger.info('Attaching to page...', targetTabId);
      try {
        const attached = await browserContext.attachPage(targetPage);
        if (!attached) {
          return { success: false, error: '无法连接到页面' };
        }
        await injectBuildDomTreeScripts(targetTabId);
        await new Promise(resolve => setTimeout(resolve, 500));
        logger.info('Page attached successfully');
      } catch (attachError) {
        logger.error('Failed to attach page:', attachError);
        return {
          success: false,
          error: attachError instanceof Error ? attachError.message : '连接页面失败',
        };
      }
    }

    logger.info('Page ready, starting workflow execution on tab:', targetTabId);

    // Wait for content script to be ready
    const waitForContentScript = async (tabId: number, maxRetries = 5): Promise<boolean> => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { type: 'ping_content_script' });
          if (response?.success) {
            logger.info('Content script is ready on tab:', tabId);
            return true;
          }
        } catch (e) {
          logger.info(`Content script not ready, retry ${i + 1}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      return false;
    };

    // Try to inject content script if not ready
    const ensureContentScript = async (tabId: number): Promise<boolean> => {
      // First try to ping
      const ready = await waitForContentScript(tabId, 3);
      if (ready) return true;

      // Try to inject content script manually
      try {
        logger.info('Attempting to inject content script manually on tab:', tabId);
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/index.iife.js'],
        });
        // Wait for script to initialize
        await new Promise(resolve => setTimeout(resolve, 300));
        return await waitForContentScript(tabId, 3);
      } catch (e) {
        logger.error('Failed to inject content script:', e);
        return false;
      }
    };

    // Ensure content script is loaded before sending progress messages
    const contentScriptReady = await ensureContentScript(targetTabId);
    if (!contentScriptReady) {
      logger.warning('Content script not ready on target tab, workflow will execute without overlay');
    }

    // Send start progress message to content script (only if overlay is enabled)
    if (contentScriptReady && showOverlay) {
      try {
        await chrome.tabs.sendMessage(targetTabId, {
          type: 'workflow_start',
          workflowName: workflow.name,
          totalNodes: workflow.nodes.filter((n: { type: string }) => n.type !== 'start' && n.type !== 'end').length,
        });
      } catch (e) {
        logger.warning('Failed to send workflow_start message:', e);
      }
    }

    // Track executed nodes for progress
    let executedNodesCount = 0;
    const totalExecutableNodes = workflow.nodes.filter(
      (n: { type: string }) => n.type !== 'start' && n.type !== 'end',
    ).length;

    // Create action executor that integrates with browser automation
    const actionExecutor = async (action: string, params: Record<string, unknown>) => {
      logger.info('Workflow action:', action, params);

      // Send progress update to content script (only if overlay is enabled and ready)
      if (contentScriptReady && showOverlay) {
        try {
          await chrome.tabs.sendMessage(targetTabId!, {
            type: 'workflow_progress',
            nodeId: `node-${executedNodesCount}`,
            nodeName: action,
            nodeType: 'automation',
            executedNodes: executedNodesCount + 1,
            totalNodes: totalExecutableNodes,
          });
        } catch (e) {
          logger.warning('Failed to send progress message:', e);
        }
      }

      executedNodesCount++;

      try {
        // Get the current page (should be attached now)
        const currentPage = await browserContext.getCurrentPage();
        if (!currentPage || !currentPage.attached) {
          return { success: false, error: 'Page is not attached' };
        }

        // Execute action based on type
        switch (action) {
          case 'go_to_url': {
            const url = params.url as string;
            if (!url) return { success: false, error: 'URL is required' };
            // Use the workflow's current page (kept in sync by open_tab /
            // switch_tab via browserContext) rather than a possibly-stale
            // local targetTabId, so that a go_to_url following an open_tab
            // doesn't re-open the same URL in yet another tab.
            const page = await browserContext.getCurrentPage();
            const curTabId = page?.tabId ?? targetTabId;
            if (curTabId !== undefined) {
              try {
                const curTab = await chrome.tabs.get(curTabId);
                if (curTab?.url === url) {
                  return { success: true, extractedContent: `Already on: ${url}` };
                }
                // Navigate the current workflow tab in place instead of
                // spawning a new tab for every go_to_url node.
                await browserContext.navigateTo(url);
                if (page?.tabId) targetTabId = page.tabId;
                return { success: true, extractedContent: `Navigated to: ${url}` };
              } catch {
                /* current tab might be closed; fall through to open a new one */
              }
            }
            // No current tab — open a new one and keep the workflow pointed at it.
            const newTab = await chrome.tabs.create({ url, active: true });
            if (!newTab.id) {
              return { success: false, error: 'Failed to create tab for go_to_url' };
            }
            targetTabId = newTab.id;
            browserContext.updateCurrentTabId(newTab.id);
            return { success: true, extractedContent: `Opened new tab for: ${url}` };
          }

          case 'click_element': {
            const clickSelectors = buildSelectorList(params);
            if (clickSelectors.length === 0) return { success: false, error: 'No selector provided' };
            for (const sel of clickSelectors) {
              try {
                const result = await currentPage.clickBySelector(sel);
                if (result) return { success: true };
              } catch (e) {
                // Invalid selector (e.g. Tailwind JIT class with unescaped brackets)
                // — log and try the next fallback.
                console.warn('[workflow] click selector failed, trying next:', sel, e);
              }
            }
            return { success: false, error: `Element not found with selectors: ${clickSelectors.join(', ')}` };
          }

          case 'input_text': {
            const inputSelectors = buildSelectorList(params);
            const text = params.text as string;
            if (inputSelectors.length === 0 || !text) return { success: false, error: 'Missing selector or text' };
            for (const sel of inputSelectors) {
              try {
                const result = await currentPage.inputBySelector(sel, text);
                if (result) return { success: true };
              } catch (e) {
                console.warn('[workflow] input selector failed, trying next:', sel, e);
              }
            }
            return { success: false, error: `Element not found with selectors: ${inputSelectors.join(', ')}` };
          }

          case 'scroll_to_percent': {
            const yPercent = (params.yPercent as number) || 0;
            await currentPage.scrollToPercentDirect(yPercent);
            return { success: true };
          }

          case 'scroll_to_top':
            await currentPage.scrollToPercentDirect(0);
            return { success: true };

          case 'scroll_to_bottom':
            await currentPage.scrollToPercentDirect(100);
            return { success: true };

          case 'wait': {
            const duration = (params.duration as number) || 1000;
            await new Promise(resolve => setTimeout(resolve, duration));
            return { success: true };
          }

          case 'send_keys': {
            const keys = params.keys as string;
            if (!keys) return { success: false, error: 'Keys are required' };
            await currentPage.sendKeys(keys);
            return { success: true };
          }

          case 'go_back':
            await currentPage.goBack();
            return { success: true };

          case 'go_forward':
            await currentPage.goForward();
            return { success: true };

          case 'open_tab': {
            const url = (params.url as string) || '';
            // Skip browser-internal pages (edge://, chrome://, about:): they
            // can't be automated and cause WORKFLOW_FAIL on replay.
            if (url && !/^https?:\/\//i.test(url)) {
              return {
                success: true,
                extractedContent: `Skipped non-http URL: ${url}`,
              };
            }
            const newPage = await browserContext.openTab(url);
            if (newPage?.tabId) {
              // Keep the local target in sync so subsequent nodes operate on
              // the newly opened tab (browserContext already updated its own
              // current tab id inside openTab).
              targetTabId = newPage.tabId;
              await injectBuildDomTreeScripts(newPage.tabId);
            }
            return { success: true };
          }

          case 'close_tab': {
            const currentTabId = currentPage.tabId;
            await browserContext.closeTab(currentTabId);
            return { success: true };
          }

          case 'switch_tab': {
            const tabs = await chrome.tabs.query({ currentWindow: true });
            let matchedTabId: number | undefined;
            const url = params.url as string;
            if (url) {
              // Match by URL — recorded tabId is a transient session id and
              // won't survive replay. SPAs commonly carry a session in the
              // path (e.g. /a/chat/s/<uuid>), so we match in stages from
              // strictest to loosest.
              const norm = (u: string) => u.split('#')[0].split('?')[0].replace(/\/$/, '');
              const target = norm(url);
              const targetUrl = (() => {
                try {
                  return new URL(url);
                } catch {
                  return null;
                }
              })();
              const targetOrigin = targetUrl?.origin;
              const targetPathTop = targetUrl?.pathname.split('/').filter(Boolean)[0]; // e.g. "a"

              // 1) exact (after dropping #/?)
              let match = tabs.find(t => t.url && norm(t.url) === target);
              // 2) prefix (one is a parent path of the other)
              if (!match)
                match = tabs.find(t => t.url && (norm(t.url).startsWith(target) || target.startsWith(norm(t.url))));
              // 3) same origin + same first path segment (handles dynamic
              //    session ids: /a/chat/s/<uuid> vs /a/chat/s/<other>)
              if (!match && targetOrigin && targetPathTop) {
                match = tabs.find(t => {
                  if (!t.url) return false;
                  let u: URL;
                  try {
                    u = new URL(t.url);
                  } catch {
                    return false;
                  }
                  return u.origin === targetOrigin && u.pathname.split('/').filter(Boolean)[0] === targetPathTop;
                });
              }
              // 4) same origin (last resort — better than failing the workflow)
              if (!match && targetOrigin) {
                match = tabs.find(t => {
                  if (!t.url) return false;
                  try {
                    return new URL(t.url).origin === targetOrigin;
                  } catch {
                    return false;
                  }
                });
              }
              if (match?.id) matchedTabId = match.id;
            }
            if (matchedTabId === undefined && params.tabIndex !== undefined) {
              const idx = params.tabIndex as number;
              if (tabs[idx]?.id) matchedTabId = tabs[idx].id;
            }
            if (matchedTabId !== undefined) {
              await browserContext.switchTab(matchedTabId);
              // Sync the outer workflow target so subsequent nodes operate on
              // the just-switched-to tab.
              targetTabId = matchedTabId;
              await injectBuildDomTreeScripts(matchedTabId);
              return { success: true };
            }
            return {
              success: false,
              error: url ? `No tab matching ${url}` : 'Invalid tab index',
            };
          }

          case 'select_dropdown_option': {
            const dropdownSelector = params.selector as string;
            const optionText = params.text as string;
            if (!dropdownSelector || !optionText) return { success: false, error: 'Missing selector or option text' };
            const result = await currentPage.selectOptionBySelector(dropdownSelector, optionText);
            return { success: result, error: result ? undefined : 'Select failed' };
          }

          case 'scroll_to_text': {
            const text = params.text as string;
            if (!text || !text.trim()) return { success: false, error: 'text is required' };
            // Run an in-page XPath query for the first element containing this text,
            // then scrollIntoView. We do it via chrome.scripting because puppeteer's
            // XPath helpers vary across versions and this stays self-contained.
            const tabId = currentPage.tabId;
            const [{ result } = { result: null }] = await chrome.scripting.executeScript({
              target: { tabId, frameIds: [0] },
              func: (needle: string) => {
                const lowered = needle.toLowerCase();
                // Try elements that look interactive first, then any visible element.
                const candidates: Element[] = Array.from(
                  document.querySelectorAll<HTMLElement>(
                    'button, a, label, span, p, h1, h2, h3, h4, h5, h6, li, td, th, div',
                  ),
                );
                for (const el of candidates) {
                  const t = (el as HTMLElement).innerText?.trim();
                  if (t && t.toLowerCase().includes(lowered)) {
                    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
                    return { found: true, text: t.slice(0, 200) };
                  }
                }
                return { found: false };
              },
              args: [text],
            });
            const r = result as { found: boolean; text?: string } | null;
            if (r?.found) {
              return { success: true, extractedContent: r.text };
            }
            return { success: false, error: `Text not found on page: ${text}` };
          }

          case 'get_dropdown_options': {
            const sel = params.selector as string;
            if (!sel) return { success: false, error: 'selector is required' };
            const tabId = currentPage.tabId;
            const [{ result } = { result: null }] = await chrome.scripting.executeScript({
              target: { tabId, frameIds: [0] },
              func: (selector: string) => {
                const node = document.querySelector(selector) as HTMLSelectElement | null;
                if (!node || node.tagName !== 'SELECT') return null;
                return Array.from(node.options).map((o, i) => ({
                  index: i,
                  text: o.text,
                  value: o.value,
                  selected: o.selected,
                }));
              },
              args: [sel],
            });
            const opts = result as Array<{ index: number; text: string; value: string; selected: boolean }> | null;
            if (!opts) return { success: false, error: `Not a <select> element: ${sel}` };
            // Stringify so the value flows cleanly through the variable system.
            return { success: true, extractedContent: JSON.stringify(opts) };
          }

          case 'cache_content': {
            const sel = params.selector as string;
            const xp = params.xpath as string;
            const attr = (params.attribute as string) || ''; // optional: read attribute instead of text
            if (!sel && !xp) return { success: false, error: 'selector or xpath is required' };
            const tabId = currentPage.tabId;
            const [{ result } = { result: null }] = await chrome.scripting.executeScript({
              target: { tabId, frameIds: [0] },
              func: (selector: string, xpath: string, attribute: string) => {
                let el: Element | null = null;
                if (selector) {
                  try {
                    el = document.querySelector(selector);
                  } catch {
                    /* ignore invalid selector */
                  }
                }
                if (!el && xpath) {
                  try {
                    const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    el = r.singleNodeValue as Element | null;
                  } catch {
                    /* ignore invalid xpath */
                  }
                }
                if (!el) return { ok: false };
                if (attribute) {
                  return { ok: true, value: el.getAttribute(attribute) ?? '' };
                }
                // Prefer innerText (visible text) over textContent (raw); fallback to value for inputs.
                const innerText = (el as HTMLElement).innerText;
                if (innerText && innerText.trim()) return { ok: true, value: innerText.trim() };
                if ('value' in el) return { ok: true, value: String((el as HTMLInputElement).value ?? '') };
                return { ok: true, value: (el.textContent ?? '').trim() };
              },
              args: [sel || '', xp || '', attr],
            });
            const r = result as { ok: boolean; value?: string } | null;
            if (!r?.ok) return { success: false, error: 'Element not found' };
            return { success: true, extractedContent: r.value ?? '' };
          }

          default:
            return { success: false, error: `Unknown action: ${action}` };
        }
      } catch (actionError) {
        logger.error('Workflow action failed:', action, actionError);
        return {
          success: false,
          error: actionError instanceof Error ? actionError.message : 'Action failed',
        };
      }
    };

    // Create AI invoker that uses the Navigator agent
    const aiInvoker = async (prompt: string, context?: Record<string, unknown>) => {
      logger.info('Workflow AI invoke:', prompt, context);
      try {
        // Create a full Executor session - same flow as user chat conversation
        // This gives AI module access to page context, Navigator agent, etc.
        const aiTaskId = `wf-ai-${Date.now()}`;

        // Inject workflow context variables into the task prompt
        const contextStr = context ? `\n上下文变量: ${JSON.stringify(context)}` : '';
        const taskDescription = `${prompt}${contextStr}`;

        // 把编排链往下传，并压入一帧 ai —— 这个 Executor 里若再触发工作流执行
        // （subflow 等），守卫才能看到自己是被工作流唤起的，而不是一次顶层对话。
        const executor = await setupExecutor(aiTaskId, taskDescription, browserContext, undefined, [
          ...orchestrationStack,
          { kind: 'ai', id: workflowId },
        ]);

        // Collect result from executor events
        let finalResult: { success: boolean; response?: string; error?: string } = {
          success: false,
          error: 'AI execution timed out',
        };

        executor.subscribeExecutionEvents(async event => {
          // Forward AI executor events to side panel so user can see execution process
          if (currentPort) {
            try {
              currentPort.postMessage(event);
            } catch (e) {
              logger.warning('Failed to forward AI executor event to side panel:', e);
            }
          }

          if (event.state === ExecutionState.TASK_OK) {
            finalResult = {
              success: true,
              response: event.data?.details || event.data?.taskId || 'Task completed',
            };
          } else if (event.state === ExecutionState.TASK_FAIL) {
            finalResult = {
              success: false,
              error: event.data?.details || 'AI task failed',
            };
          }
        });

        // Run the executor
        await executor.execute();

        // Clean up the AI executor after completion (don't interfere with main currentExecutor)
        await executor.cleanup();

        logger.info('Workflow AI executor result:', finalResult.success, finalResult.response?.slice(0, 100));
        return finalResult;
      } catch (aiError) {
        logger.error('Workflow AI invoke failed:', aiError);
        return {
          success: false,
          error: aiError instanceof Error ? aiError.message : 'AI invoke failed',
        };
      }
    };

    // Create workflow event emitter to forward events to side panel and options pages
    const workflowEventEmitter = async (event: WorkflowEvent) => {
      const message = { type: 'workflow_event', event };
      if (currentPort) {
        try {
          currentPort.postMessage(message);
        } catch (e) {
          logger.warning('Failed to forward workflow event to side panel:', e);
        }
      }
      // Broadcast to all connected Options pages
      for (const p of optionsPorts) {
        try {
          p.postMessage(message);
        } catch {
          // port may be closed; cleanup on disconnect listener will remove it
        }
      }
    };

    // Execute workflow
    /**
     * Lightweight AI invoker for purely textual tasks (e.g. condition evaluation).
     * Calls the LLM directly without the Planner/Navigator agent pipeline:
     * no page DOM context, no skill catalog, no agent identity prompts.
     */
    const aiLightInvoker = async (prompt: string) => {
      try {
        const providers = await llmProviderStore.getAllProviders();
        if (Object.keys(providers).length === 0) {
          return { success: false, error: 'No LLM provider configured' };
        }
        const agentModels = await agentModelStore.getAllAgentModels();
        const navigatorModel = agentModels[AgentNameEnum.Navigator];
        if (!navigatorModel) {
          return { success: false, error: 'No Navigator model configured' };
        }
        const providerConfig = providers[navigatorModel.provider];
        const llm = createChatModel(providerConfig, navigatorModel);
        const response = await llm.invoke(prompt);
        const content = response.content;
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        return { success: true, response: text };
      } catch (error) {
        logger.error('aiLightInvoker failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'AI light invoke failed' };
      }
    };

    const result = await workflowService.executeWorkflow(
      workflowId,
      targetPage.tabId,
      message.params || {},
      actionExecutor,
      aiInvoker,
      workflowEventEmitter,
      aiLightInvoker,
    );

    logger.info('execute_workflow result', targetPage.tabId, result);

    // Send completion message to content script (only if overlay is enabled and ready)
    if (contentScriptReady && showOverlay) {
      try {
        if (result.success) {
          await chrome.tabs.sendMessage(targetTabId!, {
            type: 'workflow_complete',
            workflowName: workflow.name,
            totalNodes: totalExecutableNodes,
          });
        } else {
          await chrome.tabs.sendMessage(targetTabId!, {
            type: 'workflow_error',
            workflowName: workflow.name,
            error: result.error || 'Workflow execution failed',
          });
        }
      } catch (e) {
        logger.warning('Failed to send workflow completion message:', e);
      }
    }

    // Cleanup: detach page to release debugger connection
    try {
      if (targetPage?.tabId) {
        await browserContext.detachPage(targetPage.tabId);
        logger.info('Workflow execution complete, detached page:', targetPage.tabId);
      }
    } catch (e) {
      logger.warning('Failed to detach page after workflow:', e);
    }

    return { success: result.success, result };
  } catch (error) {
    logger.error('Execute workflow failed:', error);

    // Send error message to content script if we have a valid tab and overlay is enabled
    if (targetPage?.tabId && showOverlay) {
      try {
        await chrome.tabs.sendMessage(targetPage.tabId, {
          type: 'workflow_error',
          workflowName: workflow?.name || 'Unknown',
          error: error instanceof Error ? error.message : 'Failed to execute workflow',
        });
      } catch {
        // Ignore messaging errors
      }
    }

    // Cleanup: detach page to release debugger connection
    try {
      if (targetPage?.tabId) {
        await browserContext.detachPage(targetPage.tabId);
        logger.info('Workflow execution failed, detached page:', targetPage.tabId);
      }
    } catch (e) {
      logger.warning('Failed to detach page after workflow error:', e);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute workflow',
    };
  }
}

// Handler functions for MCP/Skills messages

/**
 * 给一批可交互元素批量推测 purpose 和 confidence。
 * 由 side-panel 教导模式（TeachingDialog）通过 port 'infer_element_purposes' 触发。
 *
 * 直接复用 Navigator 配的 LLM 和 provider。**不走 Agent prompts**——只发一个独立的 prompt
 * 要求 JSON 输出，避免 Navigator 系统提示词污染推测结果。
 *
 * 失败兜底：返回空数组，让 UI 走"无推荐、用户自己挑"分支，不阻塞用户操作。
 */
async function inferElementPurposes(
  elements: Array<{ index: number; tagName: string; text: string; attributes: Record<string, string> }>,
  url: string,
): Promise<Array<{ index: number; purpose: string; confidence: number; reasoning?: string }>> {
  try {
    const providers = await llmProviderStore.getAllProviders();
    if (Object.keys(providers).length === 0) {
      logger.warning('[infer] no LLM provider configured');
      return [];
    }
    const agentModels = await agentModelStore.getAllAgentModels();
    const navigatorModel = agentModels[AgentNameEnum.Navigator];
    if (!navigatorModel) {
      logger.warning('[infer] no Navigator model configured');
      return [];
    }
    const providerConfig = providers[navigatorModel.provider];
    if (!providerConfig) {
      logger.warning('[infer] provider config missing');
      return [];
    }
    const llm = createChatModel(providerConfig, navigatorModel);

    // 压缩元素列表，每条只给 LLM 真正有用的字段（去掉空 attrs）
    const compactList = elements.map(el => {
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(el.attributes || {})) {
        if (v && v.trim()) attrs[k] = v.trim().slice(0, 80);
      }
      return {
        index: el.index,
        tag: el.tagName,
        text: el.text.slice(0, 80),
        attrs,
      };
    });

    const prompt =
      `你正在帮用户标注一个网站（${url}）上的可交互元素，目的是建立元素事实库供未来的浏览器 Agent 复用。\n\n` +
      `下面是当前页面所有可交互元素的简化清单（index + 标签 + 可见文本 + 关键属性）。\n` +
      `请为每个元素推测它的功能用途（purpose），并给出 0-1 的 confidence 分数。\n\n` +
      `规则：\n` +
      `1. purpose 用 2-12 个汉字描述（例："提交按钮"/"搜索框"/"附件按钮"/"用户头像菜单"）；尽量具体不要含糊\n` +
      `2. confidence 严格遵守：\n` +
      `   - 0.9+：元素有明确的文本/aria-label 与功能强对应（如按钮文字是"登录"）\n` +
      `   - 0.7-0.89：有一定文本但需上下文推断（如 placeholder 暗示是搜索框）\n` +
      `   - 0.4-0.69：纯图标无文字 / 多个相似候选 / 只能猜功能\n` +
      `   - <0.4：完全不知道做什么用的（如纯装饰元素、未知按钮）\n` +
      `3. 只返回 confidence >= 0.4 的元素\n` +
      `4. **必须**输出严格 JSON 数组（不要 markdown 代码块，不要解释文字），格式：\n` +
      `[{"index": 0, "purpose": "...", "confidence": 0.85, "reasoning": "简短理由(可选)"}, ...]\n\n` +
      `元素清单：\n` +
      JSON.stringify(compactList);

    const response = await llm.invoke(prompt);
    const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // 尝试解析 JSON：去掉可能的 markdown fence
    let cleaned = raw.trim();
    // 兼容 ```json...```
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // 再尝试找到第一个 `[` 到最后一个 `]`
      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(cleaned.slice(start, end + 1));
        } catch (e2) {
          logger.error('[infer] JSON parse failed even after fence/bracket extraction:', e2);
          return [];
        }
      } else {
        logger.error('[infer] LLM did not return parseable JSON:', cleaned.slice(0, 200));
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      logger.error('[infer] LLM returned non-array:', typeof parsed);
      return [];
    }

    // 校验 + 兜底每条
    const validIndices = new Set(elements.map(e => e.index));
    const out: Array<{ index: number; purpose: string; confidence: number; reasoning?: string }> = [];
    for (const item of parsed as Array<Record<string, unknown>>) {
      const idx = Number(item.index);
      const purpose = String(item.purpose || '').trim();
      const conf = Number(item.confidence);
      const reasoning = typeof item.reasoning === 'string' ? item.reasoning : undefined;
      if (!Number.isFinite(idx) || !validIndices.has(idx)) continue;
      if (!purpose || !Number.isFinite(conf)) continue;
      out.push({
        index: idx,
        purpose: purpose.slice(0, 30),
        confidence: Math.max(0, Math.min(1, conf)),
        reasoning,
      });
    }
    logger.info(`[infer] LLM returned ${out.length}/${elements.length} purposes`);
    return out;
  } catch (error) {
    logger.error('[infer] failed:', error);
    return [];
  }
}

async function handleMCPTestConnection(config: unknown): Promise<{ success: boolean; error?: string }> {
  if (!mcpService) {
    return { success: false, error: t('options_mcp_disabled') };
  }
  try {
    const result = await mcpService.testConnection(config as Parameters<typeof mcpService.testConnection>[0]);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
    };
  }
}

async function handleMCPListTools(serverId?: string): Promise<{ tools: unknown[] }> {
  if (!mcpService) {
    return { tools: [] };
  }
  try {
    const tools = await mcpService.listTools(serverId);
    return { tools };
  } catch {
    return { tools: [] };
  }
}

async function handleSkillsList(category?: string): Promise<{ skills: unknown[] }> {
  try {
    const skills = skillsService.listSkills(category);
    return { skills };
  } catch {
    return { skills: [] };
  }
}

// Setup connection listener for long-lived connections (e.g., side panel, options pages)
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'options-connection') {
    const senderUrl = port.sender?.url;
    const senderId = port.sender?.id;
    if (!senderUrl || senderId !== chrome.runtime.id || !senderUrl.startsWith(OPTIONS_URL)) {
      logger.warning('Blocked unauthorized options-connection', senderId, senderUrl);
      port.disconnect();
      return;
    }
    optionsPorts.add(port);
    port.onDisconnect.addListener(() => {
      optionsPorts.delete(port);
    });
    return;
  }
  if (port.name === 'side-panel-connection') {
    const senderUrl = port.sender?.url;
    const senderId = port.sender?.id;

    if (!senderUrl || senderId !== chrome.runtime.id || senderUrl !== SIDE_PANEL_URL) {
      logger.warning('Blocked unauthorized side-panel-connection', senderId, senderUrl);
      port.disconnect();
      return;
    }

    currentPort = port;

    port.onMessage.addListener(async message => {
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_newTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info(
              'new_task',
              message.tabId,
              message.task,
              message.images?.length ? `with ${message.images.length} images` : '',
            );
            // Clean up any prior executor to free its browser context before starting a new task
            if (currentExecutor) {
              try {
                await currentExecutor.cleanup();
              } catch (e) {
                logger.warning('Failed to cleanup previous executor before new task:', e);
              }
              currentExecutor = null;
            }
            currentExecutor = await setupExecutor(message.taskId, message.task, browserContext, message.images);
            subscribeToExecutorEvents(currentExecutor);

            const result = await currentExecutor.execute();
            logger.info('new_task execution result', message.tabId, result);
            break;
          }

          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('follow_up_task', message.tabId, message.task);

            // If executor exists, add follow-up task
            if (currentExecutor) {
              currentExecutor.addFollowUpTask(message.task);
              // Re-subscribe to events in case the previous subscription was cleaned up
              subscribeToExecutorEvents(currentExecutor);
              const result = await currentExecutor.execute();
              logger.info('follow_up_task execution result', message.tabId, result);
            } else {
              // executor was cleaned up, can not add follow-up task
              logger.info('follow_up_task: executor was cleaned up, can not add follow-up task');
              return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_cleaned') });
            }
            break;
          }

          case 'cancel_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.cancel();
            break;
          }

          case 'resume_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_cmd_resumeTask_noTask') });
            await currentExecutor.resume();
            return port.postMessage({ type: 'success' });
          }

          case 'pause_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.pause();
            return port.postMessage({ type: 'success' });
          }

          case 'skip_step': {
            // 用户在 TaskProgressBar 点「跳过此步」→ executor 在下一轮 step 边界消费
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            currentExecutor.requestSkipStep();
            return port.postMessage({ type: 'success' });
          }

          case 'amend_next_step': {
            // 用户在 AmendNextStepDialog 提交了「修改下一步」文本，executor 注入到 message history
            // 调用方负责发送前 pause、发送后 resume；这里只管注入消息
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            const text = (message.text as string | undefined) ?? '';
            await currentExecutor.amendNextStep(text);
            return port.postMessage({ type: 'success' });
          }

          case 'clarify_response': {
            // side-panel 弹窗用户回应 ask_user 请求
            const requestId = message.requestId as string | undefined;
            const response = message.response as { requestId?: string } | undefined;
            if (!requestId || !response) {
              return port.postMessage({ type: 'error', error: 'clarify_response: missing requestId/response' });
            }
            if (!currentExecutor) {
              // 任务已结束但弹窗还在 —— 告诉前端 ack 失败，前端会自关并提示
              return port.postMessage({ type: 'clarify_ack', requestId, ok: false });
            }
            const ok = currentExecutor.resolveClarification(requestId, { ...response, requestId });
            return port.postMessage({ type: 'clarify_ack', requestId, ok });
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return port.postMessage({ type: 'success', screenshot });
          }

          case 'state': {
            try {
              const browserState = await browserContext.getState(true);
              const elementsText = browserState.elementTree.clickableElementsToString(
                DEFAULT_AGENT_OPTIONS.includeAttributes,
              );

              logger.info('state', browserState);
              logger.info('interactive elements', elementsText);
              return port.postMessage({ type: 'success', msg: t('bg_cmd_state_printed') });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return port.postMessage({ type: 'error', error: t('bg_cmd_state_failed') });
            }
          }

          case 'get_interactive_elements': {
            // 教导模式用：side-panel 请求当前页面所有可交互元素，做"批量推测 purpose"的输入
            try {
              const browserState = await browserContext.getState(true);
              const items: Array<{
                index: number;
                tagName: string;
                text: string;
                xpath?: string;
                attributes: Record<string, string>;
              }> = [];
              browserState.selectorMap.forEach((node, index) => {
                const attrs = node.attributes || {};
                items.push({
                  index,
                  tagName: (node.tagName || '').toLowerCase(),
                  text: (node.getAllTextTillNextClickableElement(2) || '').trim().slice(0, 200),
                  xpath: node.xpath || undefined,
                  attributes: {
                    'aria-label': attrs['aria-label'] || '',
                    title: attrs['title'] || '',
                    placeholder: attrs['placeholder'] || '',
                    alt: attrs['alt'] || '',
                    role: attrs['role'] || '',
                    type: attrs['type'] || '',
                    name: attrs['name'] || '',
                    id: attrs['id'] || '',
                  },
                });
              });
              return port.postMessage({
                type: 'interactive_elements',
                url: browserState.url,
                title: browserState.title,
                elements: items,
              });
            } catch (error) {
              logger.error('get_interactive_elements failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'failed to get elements',
              });
            }
          }

          case 'infer_element_purposes': {
            // 教导模式用：side-panel 把元素列表发给我们，调 LLM 批量推测 purpose+confidence
            try {
              const elements = message.elements as
                | Array<{ index: number; tagName: string; text: string; attributes: Record<string, string> }>
                | undefined;
              const url = (message.url as string | undefined) || '';
              if (!elements || elements.length === 0) {
                return port.postMessage({ type: 'inferred_purposes', items: [] });
              }
              const items = await inferElementPurposes(elements, url);
              return port.postMessage({ type: 'inferred_purposes', items });
            } catch (error) {
              logger.error('infer_element_purposes failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'inference failed',
              });
            }
          }

          case 'highlight_element': {
            // TeachingDialog 里"在页面上看"按钮 → 注入红框 2 秒
            const tabId = message.tabId as number | undefined;
            const selector = message.selector as string | undefined;
            const xpath = message.xpath as string | undefined;
            const duration = (message.duration as number | undefined) ?? 2000;
            if (typeof tabId !== 'number') {
              return port.postMessage({ type: 'error', error: 'highlight_element: missing tabId' });
            }
            if (!selector && !xpath) {
              return port.postMessage({ type: 'error', error: 'highlight_element: need selector or xpath' });
            }
            try {
              // 先注入脚本（首次定义 window.__nb_highlight_element__），再调用
              await chrome.scripting.executeScript({
                target: { tabId, frameIds: [0] },
                files: ['side-panel/highlightOverlayInject.js'],
              });
              await chrome.scripting.executeScript({
                target: { tabId, frameIds: [0] },
                func: (s: string | undefined, x: string | undefined, d: number) => {
                  const fn = (
                    window as unknown as { __nb_highlight_element__?: (s?: string, x?: string, d?: number) => void }
                  ).__nb_highlight_element__;
                  if (typeof fn === 'function') fn(s, x, d);
                },
                args: [selector, xpath, duration],
              });
              return port.postMessage({ type: 'success' });
            } catch (error) {
              logger.error('highlight_element failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'highlight failed',
              });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return port.postMessage({ type: 'success', msg: t('bg_cmd_nohighlight_ok') });
          }

          case 'replay': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.taskId) return port.postMessage({ type: 'error', error: t('bg_errors_noTaskId') });
            if (!message.historySessionId)
              return port.postMessage({ type: 'error', error: t('bg_cmd_replay_noHistory') });
            logger.info('replay', message.tabId, message.taskId, message.historySessionId);

            try {
              // Switch to the specified tab
              await browserContext.switchTab(message.tabId);
              // Setup executor with the new taskId and a dummy task description
              currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
              subscribeToExecutorEvents(currentExecutor);

              // Run replayHistory with the history session ID
              const result = await currentExecutor.replayHistory(message.historySessionId);
              logger.debug('replay execution result', message.tabId, result);
            } catch (error) {
              logger.error('Replay failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : t('bg_cmd_replay_failed'),
              });
            }
            break;
          }

          // Recording handlers
          case 'start_recording': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('start_recording', message.tabId);

            try {
              // Defensive cleanup: stop any previous session first so a fresh recording starts cleanly
              const previousSession = recorderState.getSession();
              if (previousSession) {
                logger.info('Stopping previous session before new recording:', previousSession.id);
                recorderState.stopSession();
                // Tell the previous tab's content script to stop listening
                try {
                  await chrome.tabs.sendMessage(previousSession.tabId, { type: 'stop_recording' }, { frameId: 0 });
                } catch {
                  // Tab may be closed or content script not loaded
                }
              }

              // Start recording session
              const session = recorderState.startSession(message.tabId);

              // Ensure content script is injected before sending message - ONLY in main frame
              try {
                // Try to send message first, if fails then inject script
                await chrome.tabs.sendMessage(
                  message.tabId,
                  {
                    type: 'check_recording_status',
                  },
                  { frameId: 0 },
                ); // Only check main frame
              } catch {
                // Content script not ready, inject it - ONLY to main frame
                logger.info('Injecting content script for recording (main frame only)');
                await chrome.scripting.executeScript({
                  target: { tabId: message.tabId, frameIds: [0] }, // Only inject to main frame
                  files: ['content/index.iife.js'],
                });
                // Wait a bit for script to initialize
                await new Promise(resolve => setTimeout(resolve, 100));
              }

              // Send start recording message - ONLY to main frame
              await chrome.tabs.sendMessage(
                message.tabId,
                {
                  type: 'start_recording',
                  sessionId: session.id,
                },
                { frameId: 0 },
              ); // Only send to main frame

              return port.postMessage({ type: 'recording_started', session });
            } catch (error) {
              logger.error('Failed to start recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to start recording',
              });
            }
          }

          case 'stop_recording': {
            logger.info('stop_recording');

            try {
              const session = recorderState.stopSession();

              if (session) {
                // Notify ALL tracked tabs' content scripts to stop - ONLY main frame
                const tabIds = session.tabIds && session.tabIds.length > 0 ? session.tabIds : [session.tabId];
                await Promise.all(
                  tabIds.map(async tid => {
                    try {
                      await chrome.tabs.sendMessage(tid, { type: 'stop_recording' }, { frameId: 0 });
                    } catch {
                      // Tab might be closed
                    }
                  }),
                );
              }

              return port.postMessage({ type: 'recording_stopped', session });
            } catch (error) {
              logger.error('Failed to stop recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to stop recording',
              });
            }
          }

          case 'get_recording_state': {
            const session = recorderState.getSession();
            return port.postMessage({ type: 'recording_state', session });
          }

          case 'save_recording_as_skill': {
            logger.info('save_recording_as_skill', message.skillName);

            try {
              const session = recorderState.getSession();
              if (!session || session.actions.length === 0) {
                return port.postMessage({
                  type: 'error',
                  error: 'No recording session or actions to save',
                });
              }

              // Generate skill from recording
              const generatedSkill = generateSkillFromRecording(session, message.skillName, message.skillDescription);

              // Import skill to storage - use addSkill instead of importSkillPackages
              const { userSkillsStore } = await import('@extension/storage');

              const skillConfig = {
                id: generatedSkill.id,
                name: generatedSkill.name,
                description: generatedSkill.description,
                version: '1.0.0',
                category: generatedSkill.category,
                author: 'Recorder',
                tags: [],
                parameters: generatedSkill.parameters.map(p => ({
                  name: p.name,
                  type: p.type,
                  description: p.description,
                  required: p.required,
                  default: p.default,
                })),
                steps: generatedSkill.steps.map(s => ({
                  id: s.id,
                  action: s.action,
                  description: s.description,
                  parameters: s.parameters,
                  onError: s.onError,
                })),
                executionMode: generatedSkill.executionMode,
                createdAt: Date.now(),
              };

              await userSkillsStore.addSkill(skillConfig);

              // Clear session after saving
              recorderState.clearSession();

              logger.info('Skill saved successfully:', generatedSkill.id);

              return port.postMessage({
                type: 'recording_saved',
                skillId: generatedSkill.id,
                skillName: generatedSkill.name,
              });
            } catch (error) {
              logger.error('Failed to save recording as skill:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to save recording',
              });
            }
          }

          case 'execute_skill': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.skillId) return port.postMessage({ type: 'error', error: 'Skill ID is required' });

            logger.info('execute_skill', message.tabId, message.skillId);

            try {
              // Get skill from storage
              const { userSkillsStore } = await import('@extension/storage');
              const skill = await userSkillsStore.getSkill(message.skillId);

              if (!skill) {
                return port.postMessage({ type: 'error', error: `Skill "${message.skillId}" not found` });
              }

              // 渲染成任务描述：优先用 instructions（通用文本格式正文），
              // 没有则退回把 steps 渲染成清单（含 selector/xpath 定位信息）。
              // message.parameters 里的取值会替换掉正文里的 {{param}} 占位符。
              const { renderSkillAsTask } = await import('@extension/skills');
              const taskDescription = renderSkillAsTask(
                skill,
                (message.parameters as Record<string, unknown> | undefined) ?? {},
              );

              // Setup executor
              currentExecutor = await setupExecutor(message.taskId, taskDescription, browserContext);
              subscribeToExecutorEvents(currentExecutor);

              // Execute with skill parameters
              const result = await currentExecutor.execute();
              logger.info('execute_skill result', message.tabId, result);
            } catch (error) {
              logger.error('Execute skill failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to execute skill',
              });
            }
            break;
          }

          case 'ai_polish_skill': {
            logger.info('ai_polish_skill', message.skill?.name);

            try {
              const { skill, originalActions } = message;
              if (!skill) {
                return port.postMessage({ type: 'error', error: 'No skill data provided' });
              }

              // Get LLM for polish
              const providers = await llmProviderStore.getAllProviders();
              if (Object.keys(providers).length === 0) {
                return port.postMessage({ type: 'error', error: t('bg_setup_noApiKeys') });
              }

              const agentModels = await agentModelStore.getAllAgentModels();
              const navigatorModel = agentModels[AgentNameEnum.Navigator];
              if (!navigatorModel) {
                return port.postMessage({ type: 'error', error: t('bg_setup_noNavigatorModel') });
              }

              const providerConfig = providers[navigatorModel.provider];
              const llm = createChatModel(providerConfig, navigatorModel);

              // Build prompt for AI polish
              const stepsDescription = skill.steps
                .map(
                  (
                    s: { id: string; action: string; description?: string; parameters: Record<string, unknown> },
                    i: number,
                  ) =>
                    `${i + 1}. ${s.action}: ${s.description || 'No description'}\n   参数: ${JSON.stringify(s.parameters)}`,
                )
                .join('\n');

              const originalActionsDesc =
                originalActions
                  ?.map(
                    (
                      a: {
                        type: string;
                        value?: string;
                        element?: { textContent?: string };
                        navigateInfo?: { url: string; title: string };
                      },
                      i: number,
                    ) => `${i + 1}. ${a.type}: ${a.value || a.element?.textContent || a.navigateInfo?.url || 'N/A'}`,
                  )
                  .join('\n') || '无原始操作记录';

              const polishPrompt = `你是一个自动化任务优化专家。请根据以下录制的操作步骤，优化并生成更清晰、更可靠的 Skill 定义。

## 原始操作记录
${originalActionsDesc}

## 当前 Skill 步骤
${stepsDescription}

## 优化要求
1. 分析用户的真实操作意图，为每个步骤生成更准确的描述
2. 检查步骤是否有冗余或错误，可以合并或删除不必要的步骤
3. 为 Skill 生成一个简洁明了的名称和描述
4. 【严格禁止】不得更改任何步骤的 action 类型（如 click_element、input_text、go_to_url 等）
5. 【严格禁止】不得更改 parameters 中的 selector、xpath、fallbacks、url 等定位/导航参数
6. 只允许修改 description 字段和 parameters.intent 字段
7. 不允许发明新的 action 类型（如 ai_invoke），必须保留原始录制的精确操作

请以 JSON 格式返回优化后的 Skill，格式如下：
{
  "name": "优化后的名称",
  "description": "优化后的描述",
  "steps": [
    {
      "id": "原始id",
      "action": "原始action（不可更改）",
      "description": "优化后的描述",
      "parameters": {原始参数不变，仅可修改 intent 字段},
      "onError": "stop"
    }
  ]
}

只返回 JSON，不要添加其他说明文字。`;

              // Call LLM
              const response = await llm.invoke(polishPrompt);
              const responseText = response.content as string;

              // Parse JSON response
              let polishedSkill: typeof skill;
              try {
                // Try to extract JSON from response (might be wrapped in markdown)
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
                polishedSkill = JSON.parse(jsonStr);
              } catch (parseError) {
                logger.error('Failed to parse AI response:', parseError);
                // Return original skill if parsing fails
                polishedSkill = skill;
              }

              // Safety guard: even if the LLM ignored the prompt and changed action types
              // or stripped selectors/xpath, we restore them from the original skill so
              // recorded element targeting is never lost.
              if (polishedSkill?.steps && Array.isArray(polishedSkill.steps)) {
                const originalById = new Map(
                  (skill.steps as Array<{ id: string; action: string; parameters: Record<string, unknown> }>).map(s => [
                    s.id,
                    s,
                  ]),
                );
                polishedSkill.steps = polishedSkill.steps.map(
                  (polishedStep: {
                    id: string;
                    action: string;
                    parameters: Record<string, unknown>;
                    description?: string;
                  }) => {
                    const original = originalById.get(polishedStep.id);
                    if (!original) return polishedStep;
                    return {
                      ...polishedStep,
                      // Restore action type — must never be changed
                      action: original.action,
                      // Merge parameters: keep all original params, only allow LLM to override `intent`
                      parameters: {
                        ...original.parameters,
                        ...(polishedStep.parameters?.intent !== undefined
                          ? { intent: polishedStep.parameters.intent }
                          : {}),
                      },
                    };
                  },
                );
              }

              // 润色只允许改 description / intent，不改 action 和 locator（上面的守卫保证了这点）。
              // 但 instructions 是从 steps 渲染出来的，不重渲染的话正文还是润色前的旧措辞，
              // 而正文才是执行时真正注入给 LLM 的内容 —— 润色就白做了。
              if (Array.isArray(polishedSkill?.steps)) {
                const steps = polishedSkill.steps as Array<{
                  action: string;
                  description?: string;
                  parameters?: Record<string, unknown>;
                }>;
                polishedSkill.instructions = steps
                  .map((step, i) => {
                    const lines = [`${i + 1}. ${step.description?.trim() || step.action}`];
                    const detail: string[] = [];
                    for (const key of ['url', 'selector', 'xpath', 'text'] as const) {
                      const v = step.parameters?.[key];
                      if (typeof v === 'string' && v) detail.push(`${key}=${v}`);
                    }
                    if (detail.length) lines.push(`   （${detail.join('，')}）`);
                    return lines.join('\n');
                  })
                  .join('\n');
              }

              logger.info('AI polish result:', polishedSkill.name);
              return port.postMessage({ type: 'ai_polish_result', polishedSkill });
            } catch (error) {
              logger.error('AI polish failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'AI polish failed',
              });
            }
          }

          case 'execute_workflow': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.workflowId) return port.postMessage({ type: 'error', error: 'Workflow ID is required' });

            logger.info('execute_workflow via port', message.tabId, message.workflowId);

            try {
              const workflowResult = await handleExecuteWorkflow({
                workflowId: message.workflowId,
                tabId: message.tabId,
                taskId: message.taskId,
                params: message.params || {},
              });

              if (workflowResult.success) {
                port.postMessage({ type: 'success', result: workflowResult });
              } else {
                port.postMessage({ type: 'error', error: workflowResult.error || 'Workflow execution failed' });
              }
            } catch (error) {
              logger.error('Execute workflow via port failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to execute workflow',
              });
            }
            break;
          }

          default:
            logger.warning('Unknown port message type:', message.type);
            return port.postMessage({ type: 'error', error: `Unknown message type: ${message.type}` });
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : t('errors_unknown'),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      console.log('Side panel disconnected');
      currentPort = null;
      currentExecutor?.cancel();
    });
  }
});

// Handle messages from content scripts (for recording)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle recorded action from content script
  if (message.type === 'recorded_action') {
    const session = recorderState.getActiveSession();
    if (session) {
      // Verify this action comes from the main frame (frameId === 0 or undefined for older chrome)
      // iframe 的 sender.frameId 会 > 0
      if (sender.frameId !== undefined && sender.frameId !== 0) {
        console.log('[Recording] Ignoring action from iframe (frameId:', sender.frameId, ')');
        sendResponse({ success: false, reason: 'iframe_ignored' });
        return false;
      }

      // Verify this action comes from a tab we're tracking (cross-tab recording)
      const senderTabId = sender.tab?.id;

      if (senderTabId !== undefined && !recorderState.isTabTracked(senderTabId)) {
        console.log('[Recording] Ignoring action from untracked tab:', senderTabId);
        sendResponse({ success: false, reason: 'wrong_tab' });
        return false;
      }

      // Process the recorded action
      const action = message.action;
      // Attach tabId for cross-tab distinction
      if (senderTabId !== undefined) action.tabId = senderTabId;

      // Generate element selectors if element info is present
      if (action.element) {
        action.element = selectorGenerator.generateSelectors(action.element);
      }

      recorderState.addAction(action);

      // Notify side panel of recording state update
      if (currentPort) {
        currentPort.postMessage({
          type: 'recording_state_update',
          session: recorderState.getSession(),
        });
      }
    }
    sendResponse({ success: true });
    return false;
  }

  // Handle content script checking recording status (for page navigation recovery)
  if (message.type === 'check_recording_status') {
    const session = recorderState.getActiveSession();
    if (session) {
      // Only respond to requests from main frame (frameId === 0)
      // iframe 的 sender.frameId 会 > 0，不应该获得 recording status
      if (sender.frameId !== undefined && sender.frameId !== 0) {
        console.log('[Recording] Ignoring check_recording_status from iframe (frameId:', sender.frameId, ')');
        sendResponse({ isRecording: false, sessionId: null, reason: 'iframe_ignored' });
        return false;
      }

      // Verify this request comes from a tab we're tracking
      const senderTabId = sender.tab?.id;

      if (senderTabId !== undefined && !recorderState.isTabTracked(senderTabId)) {
        console.log('[Recording] Ignoring check_recording_status from untracked tab:', senderTabId);
        sendResponse({ isRecording: false, sessionId: null, reason: 'wrong_tab' });
        return false;
      }

      sendResponse({ isRecording: true, sessionId: session.id });
    } else {
      sendResponse({ isRecording: false, sessionId: null });
    }
    return false;
  }

  // Handle content script loaded notification
  if (message.type === 'content_script_loaded') {
    // Content script is ready, could be used for future features
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// Listen for tab activation during recording.
// Cross-tab recording: ANY tab the user switches to during a session is
// automatically joined to the recording set, so users never have to manually
// "add" a tab. Newly joined tabs emit a tab_open action (which also marks them
// active); already-tracked tabs emit a tab_switch only when focus actually
// changes.
chrome.tabs.onActivated.addListener(async activeInfo => {
  const session = recorderState.getActiveSession();
  if (!session) return;

  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (!tab.url?.startsWith('http')) return;

  console.log('[Recording] Tab activated during recording:', activeInfo.tabId, tab.url);

  let changed = false;
  if (!recorderState.isTabTracked(activeInfo.tabId)) {
    // Auto-join: the user switched here, so record from this tab too
    const added = recorderState.addTab(activeInfo.tabId, { url: tab.url, title: tab.title });
    if (added) changed = true;
  } else {
    // Already tracked — emit tab_switch if focus moved away from the previous tab
    const switched = recorderState.markActiveTab(activeInfo.tabId, { url: tab.url, title: tab.title });
    if (switched) changed = true;
  }

  if (changed) {
    currentPort?.postMessage({ type: 'recording_state_update', session: recorderState.getSession() });
  }

  // Inject content script if needed - ONLY in main frame
  try {
    await chrome.tabs.sendMessage(activeInfo.tabId, { type: 'ping' }, { frameId: 0 });
  } catch {
    // Content script not present, inject it - ONLY to main frame
    console.log('[Recording] Injecting content script to tab (main frame only)');
    await chrome.scripting.executeScript({
      target: { tabId: activeInfo.tabId, frameIds: [0] }, // Only main frame
      files: ['content/index.iife.js'],
    });
  }

  // Send recording status to content script - ONLY in main frame
  try {
    await chrome.tabs.sendMessage(
      activeInfo.tabId,
      {
        type: 'start_recording',
        sessionId: session.id,
      },
      { frameId: 0 },
    ); // Only send to main frame
  } catch (e) {
    console.warn('[Recording] Failed to send recording status to tab:', e);
  }
});

// Listen for page navigation during recording
chrome.webNavigation?.onCompleted?.addListener(async details => {
  if (details.frameId !== 0) return; // Only main frame

  const session = recorderState.getActiveSession();
  if (!session) return;

  // Recording is active, ensure content script is ready after navigation
  if (!details.url?.startsWith('http')) return;

  // Only handle tabs in our tracked set
  if (!recorderState.isTabTracked(details.tabId)) {
    return;
  }

  console.log('[Recording] Page navigation completed during recording:', details.url);

  // Give content script time to load
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check if content script is ready and recording - ONLY in main frame (frameId: 0)
  try {
    const response = await chrome.tabs.sendMessage(details.tabId, { type: 'check_recording_status' }, { frameId: 0 });
    if (!response?.isRecording) {
      // Content script loaded but not recording, restart it - ONLY in main frame
      await chrome.tabs.sendMessage(
        details.tabId,
        {
          type: 'start_recording',
          sessionId: session.id,
        },
        { frameId: 0 },
      );
    }
  } catch (e) {
    // Content script not present, inject and start - ONLY in main frame
    try {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId, frameIds: [0] }, // Only inject to main frame
        files: ['content/index.iife.js'],
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      await chrome.tabs.sendMessage(
        details.tabId,
        {
          type: 'start_recording',
          sessionId: session.id,
        },
        { frameId: 0 },
      ); // Only send to main frame
    } catch (injectError) {
      console.warn('[Recording] Failed to inject content script after navigation:', injectError);
    }
  }
});

// Auto-track new tabs opened from a tracked tab (target="_blank" / window.open)
chrome.tabs.onCreated.addListener(async tab => {
  const session = recorderState.getActiveSession();
  if (!session || tab.id === undefined) return;
  // Only auto-add if the opener is a tracked tab
  if (tab.openerTabId !== undefined && recorderState.isTabTracked(tab.openerTabId)) {
    const added = recorderState.addTab(tab.id, {
      url: tab.pendingUrl || tab.url || '',
      title: tab.title || '',
      openerTabId: tab.openerTabId,
    });
    if (added) {
      console.log('[Recording] Auto-tracked new tab:', tab.id, 'from opener:', tab.openerTabId);
      currentPort?.postMessage({ type: 'recording_state_update', session: recorderState.getSession() });
    }
  }
});

// Clean up when a tracked tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  const session = recorderState.getActiveSession();
  if (!session) return;
  if (recorderState.isTabTracked(tabId)) {
    recorderState.removeTab(tabId);
    console.log('[Recording] Tab closed, removed from tracking:', tabId);
    currentPort?.postMessage({ type: 'recording_state_update', session: recorderState.getSession() });
  }
});

async function setupExecutor(
  taskId: string,
  task: string,
  browserContext: BrowserContext,
  images?: { name: string; base64: string }[],
  /**
   * 编排链。顶层对话不传；由工作流 ai 节点唤起时必须带上调用方的链，
   * 否则这个 Executor 里再触发的工作流执行会以为自己是顶层调用，深度守卫失效。
   */
  orchestrationStack?: OrchestrationFrame[],
) {
  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new Error(t('bg_setup_noApiKeys'));
  }

  // Clean up any legacy validator settings for backward compatibility
  await agentModelStore.cleanupLegacyValidatorSettings();

  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new Error(t('bg_setup_noProvider', [agentModel.provider]));
    }
  }

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error(t('bg_setup_noNavigatorModel'));
  }
  // Log the provider config being used for the navigator
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    // Log the provider config being used for the planner
    const plannerProviderConfig = providers[plannerModel.provider];
    plannerLLM = createChatModel(plannerProviderConfig, plannerModel);
  }

  // Create vision LLM if configured, otherwise use navigator LLM as fallback
  let visionLLM: BaseChatModel | null = null;
  const visionModel = agentModels[AgentNameEnum.Vision];
  if (visionModel) {
    const visionProviderConfig = providers[visionModel.provider];
    visionLLM = createChatModel(visionProviderConfig, visionModel);
    logger.info('Vision model configured:', visionModel.provider, visionModel.modelName);
  } else {
    // Use navigator LLM as fallback for vision
    visionLLM = navigatorLLM;
    logger.info('No vision model configured, using navigator model as fallback');
  }

  // Apply firewall settings to browser context
  const firewall = await firewallStore.getFirewall();
  if (firewall.enabled) {
    browserContext.updateConfig({
      allowedUrls: firewall.allowList,
      deniedUrls: firewall.denyList,
    });
  } else {
    browserContext.updateConfig({
      allowedUrls: [],
      deniedUrls: [],
    });
  }

  const generalSettings = await generalSettingsStore.getSettings();
  browserContext.updateConfig({
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000.0,
    displayHighlights: generalSettings.displayHighlights,
    viewportExpansion: generalSettings.viewportExpansion,
  });

  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    visionLLM: visionLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
      autonomousMode: generalSettings.autonomousMode,
    },
    generalSettings: generalSettings,
    navigatorProvider: navigatorModel.provider,
    navigatorModelName: navigatorModel.modelName,
    plannerProvider: plannerModel?.provider ?? navigatorModel.provider,
    plannerModelName: plannerModel?.modelName ?? navigatorModel.modelName,
    visionProvider: visionModel?.provider ?? navigatorModel.provider,
    visionModelName: visionModel?.modelName ?? navigatorModel.modelName,
    // mcpService 为 null 时 Executor 不注册 mcp_* action、不注入工具清单，
    // NavigatorPrompt 也会去掉 MCP 段落
    mcpService: mcpService ?? undefined,
    skillsService: {
      executeSkill: (skillId, params, mode) => skillsService.executeSkill(skillId, params, mode),
      listSkills: category => skillsService.listSkills(category),
      getSkillInfo: skillId => skillsService.getSkillInfo(skillId),
      createSkill: (input, createdCount) => createSkillFromAI(input, createdCount),
    },
    /**
     * 工作流能力：只有读和写，没有执行。
     *
     * 执行入口只有 `handleExecuteWorkflow`，且只由用户在 UI 上点触发。工作流是固定图，
     * 执行时不再逐节点决策 —— 让 AI 自己触发等于交给它一个不可中途纠偏的脚本去操作
     * 用户的浏览器。
     */
    workflowService: {
      listWorkflows: () => workflowService.listSummariesForAI(),
      getWorkflowSummary: workflowId => workflowService.getSummaryForAI(workflowId),
      createWorkflow: (input, createdCount) => createWorkflowFromAI(input, createdCount),
      updateWorkflow: (input, updatedCount) => updateWorkflowFromAI(input, updatedCount),
    },
    orchestrationStack,
    images, // 用户上传的图片
  });

  return executor;
}

// Update subscribeToExecutorEvents to use port
async function subscribeToExecutorEvents(executor: Executor) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      if (currentPort) {
        currentPort.postMessage(event);
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    // 任务到达终态时清理 browser context：断开 puppeteer（去掉浏览器顶部的"调试"黄条）
    // 并关闭任务期间通过 openTab 新开的 tab。
    // 注：不调 executor.cleanup()，以便 follow-up 时复用对话历史。
    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      try {
        await browserContext.cleanup(true);
      } catch (err) {
        logger.warning('Failed to cleanup browser context after task end:', err);
      }
    }
  });
}
