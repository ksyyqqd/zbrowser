import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import {
  clickElementActionSchema,
  doneActionSchema,
  goBackActionSchema,
  goToUrlActionSchema,
  inputTextActionSchema,
  openTabActionSchema,
  searchGoogleActionSchema,
  switchTabActionSchema,
  type ActionSchema,
  sendKeysActionSchema,
  scrollToTextActionSchema,
  cacheContentActionSchema,
  selectDropdownOptionActionSchema,
  getDropdownOptionsActionSchema,
  closeTabActionSchema,
  waitActionSchema,
  previousPageActionSchema,
  scrollToPercentActionSchema,
  nextPageActionSchema,
  scrollToTopActionSchema,
  scrollToBottomActionSchema,
  getFullHtmlActionSchema,
  askUserActionSchema,
} from './schemas';
import { mcpToolActionSchema, mcpListToolsActionSchema, mcpGetStatusActionSchema } from './mcpSchemas';
import {
  skillInvokeActionSchema,
  skillListActionSchema,
  skillGetInfoActionSchema,
  skillCreateActionSchema,
} from './skillSchemas';
import {
  workflowListActionSchema,
  workflowGetInfoActionSchema,
  workflowCreateActionSchema,
  workflowUpdateActionSchema,
} from './workflowSchemas';
import { z } from 'zod';
import { createLogger } from '@src/background/log';
import { ExecutionState, Actors, type AskUserPayload, type ClarifyResponse } from '@extension/shared';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { wrapUntrustedContent } from '../messages/utils';
import { summarizeClarifyResponse } from '../clarify';
import { elementHintsStore, getHostnameFromUrl, MAX_STALE_HITS } from '@extension/storage';
import type { DOMElementNode } from '@src/background/browser/dom/views';

const logger = createLogger('Action');

function normalizeLocatorValue(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * 把各处产出的 xpath 归一到可比较的规范形式。
 *
 * 代码里有三个互不兼容的 xpath 生成器，可以指向同一节点却字符串不相等：
 *  - buildDomTree.js 的 getXPathTree（即 DOMElementNode.xpath、事实库里存的那份）：
 *    无前导斜杠，且「该 tag 只有一个同名兄弟」时**省略** [n] → `html/body/div[1]/div/div[2]`
 *  - content script 的 generateSimpleXPath（用户拾取）：有前导斜杠，同样省略 [n]
 *  - 模型自己写的：有前导斜杠，且每层都补 [1] → `/html/body[1]/div[1]/div[1]`
 *
 * 而匹配用的是精确字符串相等，于是记忆/拾取的元素永远匹不上。
 *
 * 归一规则：补前导斜杠 + 去掉所有 [1]。去 [1] 是安全的：省略索引的生成器只在
 * 「同名兄弟仅一个」时省略，此时 div 与 div[1] 选中同一节点；[2] 及以上一律保留，
 * 所以不会把兄弟节点误判成同一个。
 */
function normalizeXPathForCompare(xpath?: string | null): string | null {
  const trimmed = normalizeLocatorValue(xpath);
  if (!trimmed) return null;
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\[1\]/g, '');
}

export function resolveElementNodeForAction(
  selectorMap: Map<number, DOMElementNode>,
  index?: number | null,
  selector?: string | null,
  xpath?: string | null,
  includeDynamicAttributes = true,
): DOMElementNode | undefined {
  // 三种 locator **依次回退**，不能「xpath 非空就早退」：模型命中事实库时往往同时给出
  // xpath 和 index，而它写的 xpath 格式未必跟 DOMElementNode.xpath 对得上。早退会让
  // 完全可用的 index 被彻底忽略，elementNode 变成 undefined，最后拿一条对不上的 xpath
  // 去 document.evaluate —— 它常常能解析出「某个」节点并点下去，于是动作报成功但点错了元素。
  const normalizedXpath = normalizeXPathForCompare(xpath);
  if (normalizedXpath) {
    const byXpath = Array.from(selectorMap.values()).find(
      node => normalizeXPathForCompare(node.xpath) === normalizedXpath,
    );
    if (byXpath) return byXpath;
  }

  const normalizedSelector = normalizeLocatorValue(selector);
  if (normalizedSelector) {
    const bySelector = Array.from(selectorMap.values()).find(node => {
      const selectors = [
        node.enhancedCssSelectorForElement(includeDynamicAttributes),
        node.enhancedCssSelectorForElement(!includeDynamicAttributes),
      ];
      return selectors.some(candidate => normalizeLocatorValue(candidate) === normalizedSelector);
    });
    if (bySelector) return bySelector;
  }

  if (typeof index === 'number') {
    return selectorMap.get(index);
  }

  return undefined;
}

/**
 * 记一次「事实库里的 locator 在当前页面上定位失败」。
 *
 * 为什么需要：站点改版后旧 selector 会稳定失败，但 `lastUsedAt` 不会变，TTL 还得等
 * 几十天才到。中间这段时间它照样排在注入名额里，prompt 还告诉 LLM「优先用它不要另猜」，
 * 于是每一步都被同一条坏数据带偏。累计 MAX_STALE_HITS 次后 `isHintExpired` 直接判它过期。
 *
 * 只在 locator 明确来自事实库（模型给了 selector/xpath 却匹配不到任何节点）时调用。
 * 失败不抛：这本身就在错误处理路径上，再抛会盖掉真正的报错。
 */
async function markHintStaleOnLocatorFailure(
  context: AgentContext,
  selector?: string | null,
  xpath?: string | null,
): Promise<void> {
  try {
    const sel = normalizeLocatorValue(selector);
    const xp = normalizeLocatorValue(xpath);
    if (!sel && !xp) return;

    const page = await context.browserContext.getCurrentPage();
    const hostname = getHostnameFromUrl(page.url());
    if (!hostname) return;

    const hints = await elementHintsStore.getByHostname(hostname);
    const hit = hints.find(
      h =>
        (xp && normalizeLocatorValue(h.xpath) === xp) ||
        (sel && (normalizeLocatorValue(h.selector) === sel || normalizeLocatorValue(h.stableSelector) === sel)),
    );
    if (!hit) return;

    await elementHintsStore.markHintStale(hostname, hit.id);
    logger.info(
      `[hint] locator failed on ${hostname}: purpose="${hit.purpose}" staleHits=${(hit.staleHits ?? 0) + 1}/${MAX_STALE_HITS}`,
    );
  } catch (err) {
    logger.warning('markHintStaleOnLocatorFailure failed:', err);
  }
}

/**
 * 把 context.pendingPickedHints 中"未落库"的拾取结果落库到 elementHintsStore。
 *
 * 触发：click_element / input_text / select_dropdown_option 成功后调用。
 * 匹配逻辑：
 *  1. 如果有任意 pending hint 的 xpath 跟当前 elementNode 的 xpath 一样 → 这就是用户拾取后真正被用上的，落库
 *  2. 如果都不匹配（用户拾取了一个但 LLM 最终点了别的）→ 落库"AI 实际用的元素"作为 ai_success 来源
 *  3. 落库后清空 pendingPickedHints（一次拾取 → 一次落库；避免多次入库噪音）
 *
 * 设计取舍：
 *  - 不匹配时仍记 ai_success 是为了让"AI 自己摸索成功"的元素也能积累事实库
 *  - 但是 source = 'ai_success' 而非 'user_pick'，UI 侧可以按来源区分置信度
 */
async function persistHintOnSuccess(
  context: AgentContext,
  elementNode: DOMElementNode,
  fallbackPurpose: string,
): Promise<void> {
  try {
    const page = await context.browserContext.getCurrentPage();
    const hostname = getHostnameFromUrl(page.url());
    if (!hostname) return;

    const nodeXpath = elementNode.xpath || undefined;
    const nodeText = elementNode.getAllTextTillNextClickableElement(2)?.trim().slice(0, 200);

    if (context.pendingPickedHints.length > 0) {
      // 优先匹配 pending 里的用户拾取
      const matched = context.pendingPickedHints.find(p => p.xpath && nodeXpath && p.xpath === nodeXpath);
      if (matched) {
        const stored = await elementHintsStore.addHint(hostname, {
          purpose: matched.purpose || fallbackPurpose,
          selector: matched.selector,
          stableSelector: matched.stableSelector,
          xpath: matched.xpath,
          textContent: matched.textContent || nodeText,
          source: 'user_pick',
        });
        logger.info(
          `[hint] saved user_pick on ${hostname}: purpose="${stored.purpose}" xpath="${stored.xpath || ''}" useCount=${stored.useCount}`,
        );
      } else {
        // 用户拾取了但 LLM 最终选了别的元素 → 落 LLM 实际用的那个
        const stored = await elementHintsStore.addHint(hostname, {
          purpose: fallbackPurpose,
          xpath: nodeXpath,
          textContent: nodeText,
          source: 'ai_success',
        });
        logger.info(
          `[hint] user picked but LLM chose another, saved ai_success on ${hostname}: purpose="${stored.purpose}" xpath="${stored.xpath || ''}" useCount=${stored.useCount}`,
        );
      }
      // 一次澄清 → 一次落库，无论是否匹配都清空，避免后续动作重复入库
      context.pendingPickedHints = [];
    } else if (fallbackPurpose && nodeXpath) {
      // 无 pending：LLM 自己摸索成功的元素也累积；但要求 purpose 非空避免无意义记录
      const stored = await elementHintsStore.addHint(hostname, {
        purpose: fallbackPurpose,
        xpath: nodeXpath,
        textContent: nodeText,
        source: 'ai_success',
      });
      logger.info(
        `[hint] saved ai_success on ${hostname}: purpose="${stored.purpose}" xpath="${stored.xpath || ''}" useCount=${stored.useCount}`,
      );
    } else {
      logger.debug(
        `[hint] skip persist: no pending pick and no element_purpose (hostname=${hostname}, hasXpath=${!!nodeXpath})`,
      );
    }
  } catch (err) {
    // 落库失败不能影响主流程
    logger.warning('persistHintOnSuccess failed:', err);
  }
}

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/**
 * An action is a function that takes an input and returns an ActionResult
 */
export class Action {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handler: (input: any) => Promise<ActionResult>,
    public readonly schema: ActionSchema,
    // Whether this action has an index argument
    public readonly hasIndex: boolean = false,
  ) {}

  async call(input: unknown): Promise<ActionResult> {
    // Validate input before calling the handler
    const schema = this.schema.schema;

    // check if the schema is schema: z.object({}), if so, ignore the input
    const isEmptySchema =
      schema instanceof z.ZodObject &&
      Object.keys((schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape || {}).length === 0;

    if (isEmptySchema) {
      return await this.handler({});
    }

    const parsedArgs = this.schema.schema.safeParse(input);
    if (!parsedArgs.success) {
      // 把 Zod 错误转成 LLM 看得懂、用户看着也不像 bug 的人话
      // 例如：[{code:"invalid_type", expected:"number", received:"undefined", path:["tab_id"]}]
      //   ->  "Action 'switch_tab' missing required parameter 'tab_id' (expected number)"
      const issues = parsedArgs.error.issues
        .map(issue => {
          const field = issue.path.length > 0 ? issue.path.join('.') : '<root>';
          if (issue.code === 'invalid_type' && (issue as any).received === 'undefined') {
            return `missing required parameter '${field}' (expected ${(issue as any).expected})`;
          }
          if (issue.code === 'invalid_type') {
            return `parameter '${field}' has wrong type (expected ${(issue as any).expected}, got ${(issue as any).received})`;
          }
          return `parameter '${field}': ${issue.message}`;
        })
        .join('; ');
      throw new InvalidInputError(`Action '${this.schema.name}' invalid input: ${issues}`);
    }
    return await this.handler(parsedArgs.data);
  }

  name() {
    return this.schema.name;
  }

  /**
   * Returns the prompt for the action
   * @returns {string} The prompt for the action
   */
  prompt() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemaShape = (this.schema.schema as z.ZodObject<any>).shape || {};
    const schemaProperties = Object.entries(schemaShape).map(([key, value]) => {
      const zodValue = value as z.ZodTypeAny;
      return `'${key}': {'type': '${zodValue.description}', ${zodValue.isOptional() ? "'optional': true" : "'required': true"}}`;
    });

    const schemaStr =
      schemaProperties.length > 0 ? `{${this.name()}: {${schemaProperties.join(', ')}}}` : `{${this.name()}: {}}`;

    return `${this.schema.description}:\n${schemaStr}`;
  }

  /**
   * Get the index argument from the input if this action has an index
   * @param input The input to extract the index from
   * @returns The index value if found, null otherwise
   */
  getIndexArg(input: unknown): number | null {
    if (!this.hasIndex) {
      return null;
    }
    if (input && typeof input === 'object' && 'index' in input) {
      return (input as { index: number }).index;
    }
    return null;
  }

  /**
   * Set the index argument in the input if this action has an index
   * @param input The input to update the index in
   * @param newIndex The new index value to set
   * @returns Whether the index was set successfully
   */
  setIndexArg(input: unknown, newIndex: number): boolean {
    if (!this.hasIndex) {
      return false;
    }
    if (input && typeof input === 'object') {
      (input as { index: number }).index = newIndex;
      return true;
    }
    return false;
  }
}

// TODO: can not make every action optional, don't know why
export function buildDynamicActionSchema(actions: Action[]): z.ZodType {
  let schema = z.object({});
  for (const action of actions) {
    // create a schema for the action, it could be action.schema.schema or null
    // but don't use default: null as it causes issues with Google Generative AI
    const actionSchema = action.schema.schema;
    schema = schema.extend({
      [action.name()]: actionSchema.nullable().optional().describe(action.schema.description),
    });
  }
  return schema;
}

export class ActionBuilder {
  private readonly context: AgentContext;
  private readonly extractorLLM: BaseChatModel;

  constructor(context: AgentContext, extractorLLM: BaseChatModel) {
    this.context = context;
    this.extractorLLM = extractorLLM;
  }

  buildDefaultActions() {
    const actions = [];

    const done = new Action(async (input: z.infer<typeof doneActionSchema.schema>) => {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, doneActionSchema.name);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, input.text);
      return new ActionResult({
        isDone: true,
        extractedContent: input.text,
      });
    }, doneActionSchema);
    actions.push(done);

    const searchGoogle = new Action(async (input: z.infer<typeof searchGoogleActionSchema.schema>) => {
      const context = this.context;
      const intent = input.intent || t('act_searchGoogle_start', [input.query]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      await context.browserContext.navigateTo(`https://www.google.com/search?q=${input.query}`);

      const msg2 = t('act_searchGoogle_ok', [input.query]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, searchGoogleActionSchema);
    actions.push(searchGoogle);

    const goToUrl = new Action(async (input: z.infer<typeof goToUrlActionSchema.schema>) => {
      const intent = input.intent || t('act_goToUrl_start', [input.url]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      await this.context.browserContext.navigateTo(input.url);
      const msg2 = t('act_goToUrl_ok', [input.url]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, goToUrlActionSchema);
    actions.push(goToUrl);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const goBack = new Action(async (input: z.infer<typeof goBackActionSchema.schema>) => {
      const intent = input.intent || t('act_goBack_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      await page.goBack();
      const msg2 = t('act_goBack_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, goBackActionSchema);
    actions.push(goBack);

    const wait = new Action(async (input: z.infer<typeof waitActionSchema.schema>) => {
      const seconds = input.seconds || 3;
      const intent = input.intent || t('act_wait_start', [seconds.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      const msg = t('act_wait_ok', [seconds.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, waitActionSchema);
    actions.push(wait);

    // Element Interaction Actions
    const clickElement = new Action(
      async (input: z.infer<typeof clickElementActionSchema.schema>) => {
        // index 现在可选（命中事实库时模型只给 xpath/selector），所以所有面向用户的标签
        // 都要能在缺 index 时退回到 locator，否则 input.index.toString() 直接 TypeError。
        const elementLabel = input.index?.toString() || input.xpath?.trim() || input.selector?.trim() || 'unknown';
        const intent = input.intent || t('act_click_start', [elementLabel]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = resolveElementNodeForAction(
          state?.selectorMap ?? new Map<number, DOMElementNode>(),
          input.index,
          input.selector,
          input.xpath,
          this.context.browserContext.getConfig().includeDynamicAttributes,
        );
        if (!elementNode) {
          const locator = input.xpath?.trim() || input.selector?.trim();
          if (locator) {
            // 记忆/用户拾取的元素不一定出现在本次渲染的可交互 selectorMap 里（例如未被
            // 打上 highlightIndex）。此时直接拿 locator 去真实 DOM 上点，而不是硬失败。
            const clicked = await page.clickBySelector(locator);
            if (clicked) {
              const msg = t('act_click_ok', [locator, input.intent || '']);
              logger.info(`click_element via direct locator: ${locator}`);
              this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
              return new ActionResult({ extractedContent: msg, includeInMemory: true });
            }
            // 连 clickBySelector 都没点到 → 这条记忆确实失效了，记一次
            await markHintStaleOnLocatorFailure(this.context, input.selector, input.xpath);
            throw new Error(
              `Failed to resolve remembered element for click_element: xpath/selector did not match the current page`,
            );
          }
          throw new Error(t('act_errors_elementNotExist', [elementLabel]));
        }

        // Check if element is a file uploader
        if (page.isFileUploader(elementNode)) {
          const msg = t('act_click_fileUploader', [elementLabel]);
          logger.info(msg);
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        }

        try {
          const initialTabIds = await this.context.browserContext.getAllTabIds();
          await page.clickElementNode(this.context.options.useVision, elementNode);
          let msg = t('act_click_ok', [elementLabel, elementNode.getAllTextTillNextClickableElement(2)]);
          logger.info(msg);

          // TODO: could be optimized by chrome extension tab api
          const currentTabIds = await this.context.browserContext.getAllTabIds();
          if (currentTabIds.size > initialTabIds.size) {
            const newTabMsg = t('act_click_newTabOpened');
            msg += ` - ${newTabMsg}`;
            logger.info(newTabMsg);
            // find the tab id that is not in the initial tab ids
            const newTabId = Array.from(currentTabIds).find(id => !initialTabIds.has(id));
            if (newTabId) {
              await this.context.browserContext.switchTab(newTabId);
            }
          }
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          await persistHintOnSuccess(this.context, elementNode, this.context.currentElementPurpose);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        } catch (error) {
          const msg = t('act_errors_elementNoLongerAvailable', [elementLabel]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
          return new ActionResult({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      clickElementActionSchema,
      true,
    );
    actions.push(clickElement);

    const inputText = new Action(
      async (input: z.infer<typeof inputTextActionSchema.schema>) => {
        const targetLabel = input.index?.toString() || input.selector || input.xpath || 'unknown';
        const intent = input.intent || t('act_inputText_start', [targetLabel]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = resolveElementNodeForAction(
          state?.selectorMap ?? new Map<number, DOMElementNode>(),
          input.index,
          input.selector,
          input.xpath,
          this.context.browserContext.getConfig().includeDynamicAttributes,
        );
        if (!elementNode) {
          const hasLocator = Boolean(input.selector?.trim() || input.xpath?.trim());
          if (hasLocator) await markHintStaleOnLocatorFailure(this.context, input.selector, input.xpath);
          const errorMsg = hasLocator
            ? `Failed to resolve remembered element for input_text: xpath/selector did not match the current page`
            : t('act_errors_elementNotExist', [targetLabel]);
          throw new Error(errorMsg);
        }

        await page.inputTextElementNode(this.context.options.useVision, elementNode, input.text);
        const msg = t('act_inputText_ok', [input.text, targetLabel]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        await persistHintOnSuccess(this.context, elementNode, this.context.currentElementPurpose);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      },
      inputTextActionSchema,
      true,
    );
    actions.push(inputText);

    // Tab Management Actions
    const switchTab = new Action(async (input: z.infer<typeof switchTabActionSchema.schema>) => {
      const intent = input.intent || t('act_switchTab_start', [input.tab_id.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      await this.context.browserContext.switchTab(input.tab_id);
      const msg = t('act_switchTab_ok', [input.tab_id.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, switchTabActionSchema);
    actions.push(switchTab);

    const openTab = new Action(async (input: z.infer<typeof openTabActionSchema.schema>) => {
      const intent = input.intent || t('act_openTab_start', [input.url]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      await this.context.browserContext.openTab(input.url);
      const msg = t('act_openTab_ok', [input.url]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, openTabActionSchema);
    actions.push(openTab);

    const closeTab = new Action(async (input: z.infer<typeof closeTabActionSchema.schema>) => {
      const intent = input.intent || t('act_closeTab_start', [input.tab_id.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      await this.context.browserContext.closeTab(input.tab_id);
      const msg = t('act_closeTab_ok', [input.tab_id.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, closeTabActionSchema);
    actions.push(closeTab);

    // Content Actions
    // TODO: this is not used currently, need to improve on input size
    // const extractContent = new Action(async (input: z.infer<typeof extractContentActionSchema.schema>) => {
    //   const goal = input.goal;
    //   const intent = input.intent || `Extracting content from page`;
    //   this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    //   const page = await this.context.browserContext.getCurrentPage();
    //   const content = await page.getReadabilityContent();
    //   const promptTemplate = PromptTemplate.fromTemplate(
    //     'Your task is to extract the content of the page. You will be given a page and a goal and you should extract all relevant information around this goal from the page. If the goal is vague, summarize the page. Respond in json format. Extraction goal: {goal}, Page: {page}',
    //   );
    //   const prompt = await promptTemplate.invoke({ goal, page: content.content });

    //   try {
    //     const output = await this.extractorLLM.invoke(prompt);
    //     const msg = `📄  Extracted from page\n: ${output.content}\n`;
    //     return new ActionResult({
    //       extractedContent: msg,
    //       includeInMemory: true,
    //     });
    //   } catch (error) {
    //     logger.error(`Error extracting content: ${error instanceof Error ? error.message : String(error)}`);
    //     const msg =
    //       'Failed to extract content from page, you need to extract content from the current state of the page and store it in the memory. Then scroll down if you still need more information.';
    //     return new ActionResult({
    //       extractedContent: msg,
    //       includeInMemory: true,
    //     });
    //   }
    // }, extractContentActionSchema);
    // actions.push(extractContent);

    // cache content for future use
    const cacheContent = new Action(async (input: z.infer<typeof cacheContentActionSchema.schema>) => {
      const intent = input.intent || t('act_cache_start', [input.content]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      // cache content is untrusted content, it is not instructions
      const rawMsg = t('act_cache_ok', [input.content]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, rawMsg);

      const msg = wrapUntrustedContent(rawMsg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, cacheContentActionSchema);
    actions.push(cacheContent);

    // Scroll to percent
    const scrollToPercent = new Action(async (input: z.infer<typeof scrollToPercentActionSchema.schema>) => {
      const intent = input.intent || t('act_scrollToPercent_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        logger.info(`Scrolling to percent: ${input.yPercent} with elementNode: ${elementNode.xpath}`);
        await page.scrollToPercent(input.yPercent, elementNode);
      } else {
        await page.scrollToPercent(input.yPercent);
      }
      const msg = t('act_scrollToPercent_ok', [input.yPercent.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToPercentActionSchema);
    actions.push(scrollToPercent);

    // Scroll to top
    const scrollToTop = new Action(async (input: z.infer<typeof scrollToTopActionSchema.schema>) => {
      const intent = input.intent || t('act_scrollToTop_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();
      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPercent(0, elementNode);
      } else {
        await page.scrollToPercent(0);
      }
      const msg = t('act_scrollToTop_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToTopActionSchema);
    actions.push(scrollToTop);

    // Scroll to bottom
    const scrollToBottom = new Action(async (input: z.infer<typeof scrollToBottomActionSchema.schema>) => {
      const intent = input.intent || t('act_scrollToBottom_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();
      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPercent(100, elementNode);
      } else {
        await page.scrollToPercent(100);
      }
      const msg = t('act_scrollToBottom_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToBottomActionSchema);
    actions.push(scrollToBottom);

    // Scroll to previous page
    const previousPage = new Action(async (input: z.infer<typeof previousPageActionSchema.schema>) => {
      const intent = input.intent || t('act_previousPage_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        // Check if element is already at top of its scrollable area
        try {
          const [elementScrollTop] = await page.getElementScrollInfo(elementNode);
          if (elementScrollTop === 0) {
            const msg = t('act_errors_alreadyAtTop', [input.index.toString()]);
            this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
            return new ActionResult({ extractedContent: msg, includeInMemory: true });
          }
        } catch (error) {
          // If we can't get scroll info, let the scrollToPreviousPage method handle it
          logger.warning(
            `Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        await page.scrollToPreviousPage(elementNode);
      } else {
        // Check if page is already at top
        const [initialScrollY] = await page.getScrollInfo();
        if (initialScrollY === 0) {
          const msg = t('act_errors_pageAlreadyAtTop');
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }

        await page.scrollToPreviousPage();
      }
      const msg = t('act_previousPage_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, previousPageActionSchema);
    actions.push(previousPage);

    // Scroll to next page
    const nextPage = new Action(async (input: z.infer<typeof nextPageActionSchema.schema>) => {
      const intent = input.intent || t('act_nextPage_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        // Check if element is already at bottom of its scrollable area
        try {
          const [elementScrollTop, elementClientHeight, elementScrollHeight] =
            await page.getElementScrollInfo(elementNode);
          if (elementScrollTop + elementClientHeight >= elementScrollHeight) {
            const msg = t('act_errors_alreadyAtBottom', [input.index.toString()]);
            this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
            return new ActionResult({ extractedContent: msg, includeInMemory: true });
          }
        } catch (error) {
          // If we can't get scroll info, let the scrollToNextPage method handle it
          logger.warning(
            `Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        await page.scrollToNextPage(elementNode);
      } else {
        // Check if page is already at bottom
        const [initialScrollY, initialVisualViewportHeight, initialScrollHeight] = await page.getScrollInfo();
        if (initialScrollY + initialVisualViewportHeight >= initialScrollHeight) {
          const msg = t('act_errors_pageAlreadyAtBottom');
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }

        await page.scrollToNextPage();
      }
      const msg = t('act_nextPage_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, nextPageActionSchema);
    actions.push(nextPage);

    // Scroll to text
    const scrollToText = new Action(async (input: z.infer<typeof scrollToTextActionSchema.schema>) => {
      const intent = input.intent || t('act_scrollToText_start', [input.text, input.nth.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      try {
        const scrolled = await page.scrollToText(input.text, input.nth);
        const msg = scrolled
          ? t('act_scrollToText_ok', [input.text, input.nth.toString()])
          : t('act_scrollToText_notFound', [input.text, input.nth.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      } catch (error) {
        const msg = t('act_scrollToText_failed', [error instanceof Error ? error.message : String(error)]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
    }, scrollToTextActionSchema);
    actions.push(scrollToText);

    // Keyboard Actions
    const sendKeys = new Action(async (input: z.infer<typeof sendKeysActionSchema.schema>) => {
      const intent = input.intent || t('act_sendKeys_start', [input.keys]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      await page.sendKeys(input.keys);
      const msg = t('act_sendKeys_ok', [input.keys]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, sendKeysActionSchema);
    actions.push(sendKeys);

    // Get all options from a native dropdown
    const getDropdownOptions = new Action(
      async (input: z.infer<typeof getDropdownOptionsActionSchema.schema>) => {
        const intent = input.intent || t('act_getDropdownOptions_start', [input.index.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        try {
          // Use the existing getDropdownOptions method
          const options = await page.getDropdownOptions(input.index);

          if (options && options.length > 0) {
            // Format options for display
            const formattedOptions: string[] = options.map(opt => {
              // Encoding ensures AI uses the exact string in select_dropdown_option
              const encodedText = JSON.stringify(opt.text);
              return `${opt.index}: text=${encodedText}`;
            });

            let msg = formattedOptions.join('\n');
            msg += '\n' + t('act_getDropdownOptions_useExactText');
            this.context.emitEvent(
              Actors.NAVIGATOR,
              ExecutionState.ACT_OK,
              t('act_getDropdownOptions_ok', [options.length.toString()]),
            );
            return new ActionResult({
              extractedContent: msg,
              includeInMemory: true,
            });
          }

          // This code should not be reached as getDropdownOptions throws an error when no options found
          // But keeping as fallback
          const msg = t('act_getDropdownOptions_noOptions');
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        } catch (error) {
          const errorMsg = t('act_getDropdownOptions_failed', [error instanceof Error ? error.message : String(error)]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }
      },
      getDropdownOptionsActionSchema,
      true,
    );
    actions.push(getDropdownOptions);

    // Select dropdown option for interactive element index by the text of the option you want to select'
    const selectDropdownOption = new Action(
      async (input: z.infer<typeof selectDropdownOptionActionSchema.schema>) => {
        const intent = input.intent || t('act_selectDropdownOption_start', [input.text, input.index.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = resolveElementNodeForAction(
          state?.selectorMap ?? new Map<number, DOMElementNode>(),
          input.index,
          input.selector,
          input.xpath,
          this.context.browserContext.getConfig().includeDynamicAttributes,
        );
        if (!elementNode) {
          const hasLocator = Boolean(input.selector?.trim() || input.xpath?.trim());
          if (hasLocator) await markHintStaleOnLocatorFailure(this.context, input.selector, input.xpath);
          const errorMsg = hasLocator
            ? 'Failed to resolve remembered element for select_dropdown_option: xpath/selector did not match the current page'
            : t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        // Validate that we're working with a select element
        if (!elementNode.tagName || elementNode.tagName.toLowerCase() !== 'select') {
          const errorMsg = t('act_selectDropdownOption_notSelect', [
            input.index.toString(),
            elementNode.tagName || 'unknown',
          ]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        logger.debug(`Attempting to select '${input.text}' using xpath: ${elementNode.xpath}`);

        try {
          const result = await page.selectDropdownOption(input.index, input.text);
          const msg = t('act_selectDropdownOption_ok', [input.text, input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          await persistHintOnSuccess(this.context, elementNode, this.context.currentElementPurpose);
          return new ActionResult({
            extractedContent: result,
            includeInMemory: true,
          });
        } catch (error) {
          const errorMsg = t('act_selectDropdownOption_failed', [
            error instanceof Error ? error.message : String(error),
          ]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }
      },
      selectDropdownOptionActionSchema,
      true,
    );
    actions.push(selectDropdownOption);

    // Get full HTML content action
    const getFullHtml = new Action(
      async (input: z.infer<typeof getFullHtmlActionSchema.schema>) => {
        const intent = input.intent || t('act_getFullHtml_start');
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const maxLength = input.max_length || 5000;

        try {
          let html: string;

          if (input.index) {
            // Get HTML for specific element
            const state = await page.getState();
            const elementNode = state?.selectorMap.get(input.index);
            if (!elementNode) {
              const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
              this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
              return new ActionResult({
                error: errorMsg,
                includeInMemory: true,
              });
            }

            html = await page.getFullHtml(elementNode, maxLength);
            const msg = t('act_getFullHtml_element_ok', [input.index.toString(), html.length.toString()]);
            this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          } else {
            // Get full page HTML
            html = await page.getFullHtml(undefined, maxLength);
            const msg = t('act_getFullHtml_page_ok', [html.length.toString()]);
            this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          }

          // Wrap the HTML content as untrusted content to prevent prompt injection
          const wrappedHtml = wrapUntrustedContent(html);
          return new ActionResult({
            extractedContent: wrappedHtml,
            includeInMemory: true,
          });
        } catch (error) {
          const errorMsg = t('act_getFullHtml_failed', [error instanceof Error ? error.message : String(error)]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }
      },
      getFullHtmlActionSchema,
      true, // hasIndex (optional)
    );
    actions.push(getFullHtml);

    // 用户澄清动作 —— 暂停任务、弹窗、等用户回应
    const askUser = new Action(async (input: z.infer<typeof askUserActionSchema.schema>) => {
      const requestId = crypto.randomUUID();
      const payload: AskUserPayload = {
        requestId,
        source: 'navigator',
        question: input.question,
        context: input.context || undefined,
        options: input.options && input.options.length ? input.options : undefined,
        allowFreeText: input.allow_free_text,
        allowElementPick: input.allow_element_pick,
      };
      const intent = input.intent || `Asking user: ${input.question}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ASK_USER, JSON.stringify(payload));
      await this.context.pause();
      let resp: ClarifyResponse;
      try {
        resp = await this.context.waitForClarification(requestId);
      } finally {
        await this.context.resume();
      }
      if (resp.pickedSelector || resp.pickedXpath) {
        this.context.pendingPickedHints.push({
          purpose: input.intent || input.question || 'User picked element',
          selector: resp.pickedSelector,
          stableSelector: resp.pickedStableSelector,
          xpath: resp.pickedXpath,
          textContent: resp.pickedText,
        });
        this.context.skipNextElementGateForPickedHint = true;
      }
      const summary = summarizeClarifyResponse(resp, input.options);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ASK_USER_RESOLVED, summary);
      if (resp.abortTask) {
        // 用户选择终止：标记 ActionResult.isDone 让 navigator 不再继续；同时 stop context
        await this.context.stop();
        return new ActionResult({
          extractedContent: summary,
          includeInMemory: true,
          isDone: true,
        });
      }
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, summary);
      return new ActionResult({
        extractedContent: summary,
        includeInMemory: true,
      });
    }, askUserActionSchema);
    actions.push(askUser);

    return actions;
  }

  /**
   * Build MCP-related actions
   * These actions allow the agent to interact with MCP servers and tools
   */
  buildMCPActions(): Action[] {
    const actions: Action[] = [];
    const context = this.context;

    // MCP Tool execution action
    const mcpTool = new Action(async (input: z.infer<typeof mcpToolActionSchema.schema>) => {
      const intent = input.intent || `Executing MCP tool: ${input.tool_name}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      // Note: Actual MCP execution is handled by MCPService
      // This action will communicate with the service via context
      try {
        // Placeholder - actual implementation connects to MCPService
        const result = await context.executeMCPTool?.(input.server_id, input.tool_name, input.arguments);

        if (result?.isError) {
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, result.error ?? 'MCP tool failed');
          return new ActionResult({
            error: result.error,
            includeInMemory: true,
          });
        }

        const msg = `MCP tool ${input.tool_name} executed successfully`;
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({
          extractedContent: result?.content ? JSON.stringify(result.content) : msg,
          includeInMemory: true,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'MCP tool execution failed';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({
          error: errorMsg,
          includeInMemory: true,
        });
      }
    }, mcpToolActionSchema);
    actions.push(mcpTool);

    // List MCP tools action
    const mcpListTools = new Action(async (input: z.infer<typeof mcpListToolsActionSchema.schema>) => {
      const intent = input.intent || 'Listing MCP tools';
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        const tools = await context.listMCPTools?.(input.server_id);
        const toolList =
          tools?.map(t => `${t.serverId}/${t.name}: ${t.description}`).join('\n') ?? 'No tools available';

        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Found ${tools?.length ?? 0} MCP tools`);
        return new ActionResult({
          extractedContent: toolList,
          includeInMemory: true,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to list MCP tools';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({
          error: errorMsg,
          includeInMemory: true,
        });
      }
    }, mcpListToolsActionSchema);
    actions.push(mcpListTools);

    // Get MCP status action
    const mcpGetStatus = new Action(async (input: z.infer<typeof mcpGetStatusActionSchema.schema>) => {
      const intent = input.intent || 'Getting MCP server status';
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        const status = await context.getMCPStatus?.(input.server_id);
        const statusStr = JSON.stringify(status, null, 2);

        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, 'MCP status retrieved');
        return new ActionResult({
          extractedContent: statusStr,
          includeInMemory: true,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to get MCP status';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({
          error: errorMsg,
          includeInMemory: true,
        });
      }
    }, mcpGetStatusActionSchema);
    actions.push(mcpGetStatus);

    return actions;
  }

  /**
   * Build Skill-related actions
   * These actions allow the agent to invoke predefined skill templates
   */
  buildSkillActions(): Action[] {
    const actions: Action[] = [];
    const context = this.context;

    // Skill invoke action
    const skillInvoke = new Action(async (input: z.infer<typeof skillInvokeActionSchema.schema>) => {
      const intent = input.intent || `Invoking skill: ${input.skill_id}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        // Note: Actual skill execution is handled by SkillsService
        const result = await context.executeSkill?.(input.skill_id, input.parameters, input.execution_mode);

        if (!result?.success) {
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, result?.error ?? 'Skill execution failed');
          return new ActionResult({
            error: result?.error,
            includeInMemory: true,
          });
        }

        const msg = `Skill ${input.skill_id} completed successfully`;
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({
          extractedContent: result.output ? JSON.stringify(result.output) : msg,
          includeInMemory: true,
          isDone: false, // Skills don't mark task as done
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Skill invocation failed';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({
          error: errorMsg,
          includeInMemory: true,
        });
      }
    }, skillInvokeActionSchema);
    actions.push(skillInvoke);

    // List skills action
    const skillList = new Action(async (input: z.infer<typeof skillListActionSchema.schema>) => {
      const intent = input.intent || 'Listing available skills';
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        const skills = await context.listSkills?.(input.category);
        const skillList = skills?.map(s => `${s.id}: ${s.name} - ${s.description}`).join('\n') ?? 'No skills available';

        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Found ${skills?.length ?? 0} skills`);
        return new ActionResult({
          extractedContent: skillList,
          includeInMemory: true,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to list skills';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({
          error: errorMsg,
          includeInMemory: true,
        });
      }
    }, skillListActionSchema);
    actions.push(skillList);

    // Get skill info action
    const skillGetInfo = new Action(async (input: z.infer<typeof skillGetInfoActionSchema.schema>) => {
      const intent = input.intent || `Getting skill info: ${input.skill_id}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        const skill = await context.getSkillInfo?.(input.skill_id);

        if (!skill) {
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, `Skill not found: ${input.skill_id}`);
          return new ActionResult({
            error: `Skill not found: ${input.skill_id}`,
            includeInMemory: true,
          });
        }

        const skillInfo = JSON.stringify(skill, null, 2);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Skill info retrieved`);
        return new ActionResult({
          extractedContent: skillInfo,
          includeInMemory: true,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to get skill info';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({
          error: errorMsg,
          includeInMemory: true,
        });
      }
    }, skillGetInfoActionSchema);
    actions.push(skillGetInfo);

    const skillCreate = new Action(async (input: z.infer<typeof skillCreateActionSchema.schema>) => {
      const intent = input.intent || `Creating skill: ${input.name}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        const result = await context.createSkill?.(
          {
            name: input.name,
            description: input.description,
            category: input.category,
            parameters: input.parameters,
            instructions: input.instructions,
          },
          context.skillsCreatedThisTask,
        );

        if (!result) {
          const errorMsg = '当前环境不支持创建技能';
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        if (!result.success) {
          const errorMsg = (result.errors ?? ['创建技能失败']).join('\n');
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        context.skillsCreatedThisTask += 1;

        const msg = `已创建技能「${input.name}」(${result.skillId})，之后可以用 skill_invoke 调用。`;
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true, isDone: false });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Skill creation failed';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({ error: errorMsg, includeInMemory: true });
      }
    }, skillCreateActionSchema);
    actions.push(skillCreate);

    return actions;
  }

  /**
   * 工作流动作。只在 background 注入了 workflowService 时注册。
   *
   * 四个动作都是「看」和「写」，**没有执行** —— 工作流是固定图，执行时不再逐节点
   * 决策，让 AI 自己触发等于交给它一个不可中途纠偏的脚本去操作用户的浏览器。
   * 执行入口只有用户在 UI 上点。
   *
   * 动作本身刻意都很薄：真正的策略（哪些工作流可见、创建/修改的上限、改完退回未确认）
   * 都在 services/workflow 里，因为它们需要访问 store。
   */
  buildWorkflowActions(): Action[] {
    const actions: Action[] = [];
    const context = this.context;

    const workflowList = new Action(async (input: z.infer<typeof workflowListActionSchema.schema>) => {
      const intent = input.intent || 'Listing available workflows';
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        const workflows = (await context.listWorkflows?.()) ?? [];
        if (workflows.length === 0) {
          // 明确说「没有」而不是返回空串：空结果会让 AI 以为动作失败并重试
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, 'No workflows available');
          return new ActionResult({
            extractedContent: '当前没有可用的工作流（用户尚未创建或确认任何工作流）',
            includeInMemory: true,
          });
        }

        // 标出未确认的：AI 需要知道哪些是它（或之前的会话）刚建的、用户还没过目的，
        // 否则会跟用户说「这个可以用了」
        const listing = workflows
          .map(
            w =>
              `${w.id}: ${w.name}${w.description ? ` - ${w.description}` : ''}${w.reviewed ? '' : ' [未确认，用户需先在编辑器里确认]'}`,
          )
          .join('\n');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Found ${workflows.length} workflows`);
        return new ActionResult({ extractedContent: listing, includeInMemory: true });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to list workflows';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({ error: errorMsg, includeInMemory: true });
      }
    }, workflowListActionSchema);
    actions.push(workflowList);

    const workflowGetInfo = new Action(async (input: z.infer<typeof workflowGetInfoActionSchema.schema>) => {
      const intent = input.intent || `Getting workflow info: ${input.workflow_id}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        const summary = await context.getWorkflowSummary?.(input.workflow_id);
        if (!summary) {
          const errorMsg = `工作流不存在: ${input.workflow_id}`;
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        // 手写文本而不是 JSON.stringify(summary)：必填/可选和有无默认值是 AI 唯一需要
        // 据此行动的信息（决定要不要追问用户），铺成一行行比嵌套 JSON 更难被忽略。
        const varLines =
          summary.variables.length > 0
            ? summary.variables
                .map(v => {
                  const flags = [v.required ? '必填' : '可选', v.hasDefault ? '有默认值' : null]
                    .filter(Boolean)
                    .join('、');
                  return `  - ${v.name} (${v.type}, ${flags})${v.description ? `: ${v.description}` : ''}`;
                })
                .join('\n')
            : '  （无入参）';

        const text = [
          `工作流: ${summary.name} (${summary.id})`,
          summary.description ? `说明: ${summary.description}` : null,
          summary.reviewed ? null : '状态: 未确认，用户需先在工作流编辑器里确认才能执行',
          '入参:',
          varLines,
          `步骤(${summary.steps.length}): ${summary.steps.join(' → ')}`,
        ]
          .filter(Boolean)
          .join('\n');

        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Workflow info retrieved: ${summary.name}`);
        return new ActionResult({ extractedContent: text, includeInMemory: true });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to get workflow info';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({ error: errorMsg, includeInMemory: true });
      }
    }, workflowGetInfoActionSchema);
    actions.push(workflowGetInfo);

    const workflowCreate = new Action(async (input: z.infer<typeof workflowCreateActionSchema.schema>) => {
      const intent = input.intent || `Creating workflow: ${input.name}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        const result = await context.createWorkflow?.(
          {
            name: input.name,
            description: input.description,
            variables: input.variables,
            steps: input.steps,
          },
          context.workflowsCreatedThisTask,
        );

        if (!result) {
          const errorMsg = '当前环境不支持创建工作流';
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        if (!result.success) {
          // 逐条错误原样回给 AI —— 这些是它能据此改正的具体信息（哪个动作名不存在、
          // 哪个变量名不合法），比一句「创建失败」有用得多
          const errorMsg = (result.errors ?? ['创建工作流失败']).join('\n');
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        context.workflowsCreatedThisTask += 1;

        // 明确写出「未确认、要用户去确认」：否则 AI 会把创建当成任务完成，
        // 用户拿到一个「已经建好了」的答复却不知道还得去点确认
        const msg =
          `已创建工作流「${input.name}」(${result.workflowId})，共 ${input.steps.length} 个步骤。` +
          `该工作流尚未确认，请告诉用户去设置页的工作流编辑器里检查并确认，确认后即可执行。`;
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true, isDone: false });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Workflow creation failed';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({ error: errorMsg, includeInMemory: true });
      }
    }, workflowCreateActionSchema);
    actions.push(workflowCreate);

    const workflowUpdate = new Action(async (input: z.infer<typeof workflowUpdateActionSchema.schema>) => {
      const intent = input.intent || `Updating workflow: ${input.workflow_id}`;
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      try {
        const result = await context.updateWorkflow?.(
          {
            workflowId: input.workflow_id,
            name: input.name,
            description: input.description,
            variables: input.variables,
            steps: input.steps,
          },
          context.workflowsUpdatedThisTask,
        );

        if (!result) {
          const errorMsg = '当前环境不支持修改工作流';
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        if (!result.success) {
          const errorMsg = (result.errors ?? ['修改工作流失败']).join('\n');
          context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        context.workflowsUpdatedThisTask += 1;

        const changed = [
          input.steps ? `${input.steps.length} 个步骤` : null,
          input.name ? '名称' : null,
          input.description !== undefined ? '说明' : null,
          input.variables ? '入参' : null,
        ].filter(Boolean);
        const msg =
          `已修改工作流 ${result.workflowId}（${changed.join('、')}）。` +
          `修改后该工作流回到未确认状态，请告诉用户去工作流编辑器里检查并重新确认。`;
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true, isDone: false });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Workflow update failed';
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
        return new ActionResult({ error: errorMsg, includeInMemory: true });
      }
    }, workflowUpdateActionSchema);
    actions.push(workflowUpdate);

    return actions;
  }
}
