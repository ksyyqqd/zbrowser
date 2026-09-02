import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { ActionResult, type AgentOutput } from '../types';
import type { Action } from '../actions/builder';
import { buildDynamicActionSchema, resolveElementNodeForAction } from '../actions/builder';
import { agentBrainSchema } from '../types';
import { type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { Actors, ExecutionState, type AskUserPayload, type ClarifyResponse } from '@extension/shared';
import { elementHintsStore, getHostnameFromUrl } from '@extension/storage';
import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  EXTENSION_CONFLICT_ERROR_MESSAGE,
  ExtensionConflictError,
  isAbortedError,
  isAuthenticationError,
  isBadRequestError,
  isExtensionConflictError,
  isForbiddenError,
  ResponseParseError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
import { calcBranchPathHashSet } from '@src/background/browser/dom/views';
import { type BrowserState, BrowserStateHistory, URLNotAllowedError } from '@src/background/browser/views';
import { convertZodToJsonSchema, repairJsonString } from '@src/background/utils';
import { HistoryTreeProcessor } from '@src/background/browser/dom/history/service';
import { AgentStepRecord } from '../history';
import { type DOMHistoryElement } from '@src/background/browser/dom/history/view';

const logger = createLogger('NavigatorAgent');

function getBrowserStateSignature(state: BrowserState, pathHashes?: Set<string>): Promise<string> {
  const hashesPromise = pathHashes ? Promise.resolve(pathHashes) : calcBranchPathHashSet(state);
  return hashesPromise.then(hashes => {
    const sortedHashes = Array.from(hashes).sort().join('|');
    const elementsSummaryHash = hashText(state.elementTree.clickableElementsToString());
    return [
      state.tabId,
      state.url,
      state.title,
      state.scrollY,
      state.scrollHeight,
      state.visualViewportHeight,
      sortedHashes,
      elementsSummaryHash,
    ].join('::');
  });
}

/**
 * 当前元素是否被本站事实库记住过（xpath 精确相等，或任一 css selector 变体相等）。
 *
 * 单独导出是为了可单测：闸门本身依赖 browserContext / storage，难以在单测里构造。
 */
export function matchesRememberedElement(
  hints: Array<{ xpath?: string; selector?: string }>,
  nodeXpath: string,
  nodeSelectors: Array<string | undefined | null>,
): boolean {
  const selectors = new Set(nodeSelectors.map(s => s?.trim()).filter((s): s is string => Boolean(s)));
  const xpath = nodeXpath.trim();

  return hints.some(h => {
    const hintXpath = h.xpath?.trim();
    if (hintXpath && xpath && hintXpath === xpath) return true;
    const hintSelector = h.selector?.trim();
    return Boolean(hintSelector && selectors.has(hintSelector));
  });
}

function hasLocatorFields(actionArgs: unknown): boolean {
  if (!actionArgs || typeof actionArgs !== 'object') {
    return false;
  }

  const args = actionArgs as { selector?: string | null; xpath?: string | null };
  return Boolean(args.selector?.trim() || args.xpath?.trim());
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

interface ParsedModelOutput {
  current_state?: {
    next_goal?: string;
  };
  action?: (Record<string, unknown> | null)[] | null;
}

export class NavigatorActionRegistry {
  private actions: Record<string, Action> = {};

  constructor(actions: Action[]) {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  registerAction(action: Action): void {
    this.actions[action.name()] = action;
  }

  unregisterAction(name: string): void {
    delete this.actions[name];
  }

  getAction(name: string): Action | undefined {
    return this.actions[name];
  }

  setupModelOutputSchema(): z.ZodType {
    const actionSchema = buildDynamicActionSchema(Object.values(this.actions));
    return z.object({
      current_state: agentBrainSchema,
      action: z.array(actionSchema),
    });
  }
}

export interface NavigatorResult {
  done: boolean;
  /**
   * done 动作里模型给出的最终答复文本。
   *
   * 必须一路带回 executor：Navigator 直接 done 时（任务在一步内就完成、或 planner 还没到
   * 下一个 planningInterval），planner 不会再跑，context.finalAnswer 就一直是 null，
   * TASK_OK 只好退化成 taskId —— 表现为「找到的内容没有输出出来」。
   */
  finalAnswer?: string;
}

/**
 * 从本步的 action 结果里算出 NavigatorResult。
 *
 * 单独抽出来是为了可单测：把 done 的答复文本带回 executor 是「任务跑完但内容没输出」
 * 这个 bug 的修复点，值得有回归覆盖。
 *
 * 只看**最后一条**结果：done 按约定是动作序列的最后一个动作。
 */
export function computeNavigatorResult(
  actionResults: Array<{ isDone?: boolean; extractedContent?: string | null }>,
): NavigatorResult {
  const last = actionResults.length > 0 ? actionResults[actionResults.length - 1] : undefined;
  if (!last?.isDone) return { done: false };
  return { done: true, finalAnswer: last.extractedContent ?? undefined };
}

export class NavigatorAgent extends BaseAgent<z.ZodType, NavigatorResult> {
  private actionRegistry: NavigatorActionRegistry;
  private jsonSchema: Record<string, unknown>;
  private _stateHistory: BrowserStateHistory | null = null;

  constructor(
    actionRegistry: NavigatorActionRegistry,
    options: BaseAgentOptions,
    extraOptions?: Partial<ExtraAgentOptions>,
  ) {
    super(actionRegistry.setupModelOutputSchema(), options, { ...extraOptions, id: 'navigator' });

    this.actionRegistry = actionRegistry;

    // The zod object is too complex to be used directly, so we need to convert it to json schema first for the model to use
    this.jsonSchema = convertZodToJsonSchema(this.modelOutputSchema, 'NavigatorAgentOutput', true);
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    // Use structured output
    if (this.withStructuredOutput) {
      const structuredLlm = this.chatLLM.withStructuredOutput(this.jsonSchema, {
        includeRaw: true,
        name: this.modelOutputToolName,
      });

      let response = undefined;
      try {
        response = await structuredLlm.invoke(inputMessages, {
          signal: this.context.controller.signal,
          ...this.callOptions,
        });

        if (response.parsed) {
          return response.parsed;
        }
      } catch (error) {
        if (isAbortedError(error)) {
          throw error;
        }

        // Try to extract JSON from the raw text if the structured-output path could not parse it.
        // Any parse-shaped failure is worth retrying manually, not just "is not valid JSON":
        // providers word these errors inconsistently and the raw content is often recoverable.
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (response?.raw?.content && typeof response.raw.content === 'string') {
          const parsed = this.manuallyParseResponse(response.raw.content);
          if (parsed) {
            return parsed;
          }
        }
        throw new Error(`Failed to invoke ${this.modelName} with structured output: \n${errorMessage}`);
      }

      // Use type assertion to access the properties
      const rawResponse = response.raw as BaseMessage & {
        tool_calls?: Array<{
          args: {
            currentState: typeof agentBrainSchema._type;
            action: z.infer<ReturnType<typeof buildDynamicActionSchema>>;
          };
        }>;
      };

      // sometimes LLM returns an empty content, but with one or more tool calls, so we need to check the tool calls
      if (rawResponse.tool_calls && rawResponse.tool_calls.length > 0) {
        logger.info('Navigator structuredLlm tool call with empty content', rawResponse.tool_calls);
        // only use the first tool call
        const toolCall = rawResponse.tool_calls[0];
        return {
          current_state: toolCall.args.currentState,
          action: [...toolCall.args.action],
        };
      }

      // No parsed output and no tool calls: the payload may still be recoverable from the raw text
      // (e.g. the model answered in prose or a code fence instead of calling the tool).
      const rawContent = this.stringifyResponseContent(response.raw?.content);
      if (rawContent.trim()) {
        const parsed = this.manuallyParseResponse(rawContent);
        if (parsed) {
          return parsed;
        }
      }
      throw new ResponseParseError(this.buildParseFailureMessage(rawContent));
    }

    // Fallback to parent class manual JSON extraction for models without structured output support
    return super.invoke(inputMessages);
  }

  async execute(useLiveState = true): Promise<AgentOutput<NavigatorResult>> {
    const agentOutput: AgentOutput<NavigatorResult> = {
      id: this.id,
    };

    let cancelled = false;
    let modelOutputString: string | null = null;
    let browserStateHistory: BrowserStateHistory | null = null;
    let actionResults: ActionResult[] = [];

    try {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_START, 'Navigating...');

      const messageManager = this.context.messageManager;
      // add the browser state message
      await this.addStateMessageToMemory(useLiveState);
      const currentState = await this.context.browserContext.getCachedState();
      browserStateHistory = new BrowserStateHistory(currentState);

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }

      // call the model to get the actions to take
      const inputMessages = messageManager.getMessages();
      // logger.info('Navigator input message', inputMessages[inputMessages.length - 1]);

      const modelOutput = await this.invoke(inputMessages);

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }

      const actions = this.fixActions(modelOutput);
      modelOutput.action = actions;
      modelOutputString = JSON.stringify(modelOutput);

      // ===== 把握度闸门 =====
      // 若本步动作包含需要 index 的元素交互（click_element / input_text / select_dropdown_option）
      // 且 LLM 自评 element_confidence < 0.7，则把动作丢弃、转为 ask_user with allow_element_pick=true。
      // 用户回答后 ClarifyResponse 会写入 context.pendingClarifications 并 resume；下轮 Navigator 重新决策。
      const gateTriggered = await this.maybeGateOnLowConfidence(modelOutput, actions);
      if (gateTriggered) {
        // 已经 emit ASK_USER + 走完 wait clarify 流程。本轮不执行 LLM 决定的动作，
        // 但把 modelOutput 仍记入 memory（让 LLM 下轮看见"上一步我说要点 X 但 confidence 太低被拦了"）
        this.removeLastStateMessageFromMemory();
        this.addModelOutputToMemory(modelOutput);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_OK, 'Gated by low confidence, asked user.');
        agentOutput.result = { done: false };
        return agentOutput;
      }

      // remove the last state message from memory before adding the model output
      this.removeLastStateMessageFromMemory();
      this.addModelOutputToMemory(modelOutput);

      // 把本步 LLM 声明的元素用途暂存到 context，builder 中 click/input/select 成功后用于 hint 落库 purpose
      const cs = (modelOutput as { current_state?: { element_purpose?: string; element_confidence?: number } })
        .current_state;
      this.context.currentElementPurpose = cs?.element_purpose || '';

      // 一行摘要：方便从 service worker console 直接看 confidence/purpose 走向
      const confSummary = cs?.element_confidence ?? 1;
      const purposeSummary = cs?.element_purpose || '(none)';
      const actionNames = actions
        .map(a => Object.keys(a)[0])
        .filter(Boolean)
        .join(',');
      logger.info(
        `[conf] step actions=[${actionNames}] element_confidence=${confSummary} element_purpose="${purposeSummary}"`,
      );

      // take the actions
      actionResults = await this.doMultiAction(actions);
      // logger.info('Action results', JSON.stringify(actionResults, null, 2));

      this.context.actionResults = actionResults;

      const failedResult = actionResults.find(result => result.error);
      if (failedResult) {
        const errorString = failedResult.error || 'Navigation failed';
        const navigationError = `Navigation failed: ${errorString}`;
        logger.error(navigationError);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_FAIL, navigationError);
        agentOutput.error = errorString;
        return agentOutput;
      }

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }
      // emit event
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_OK, 'Navigation done');
      agentOutput.result = computeNavigatorResult(actionResults);
      return agentOutput;
    } catch (error) {
      this.removeLastStateMessageFromMemory();
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError(errorMessage, error);
      } else if (isBadRequestError(error)) {
        throw new ChatModelBadRequestError(errorMessage, error);
      } else if (isAbortedError(error)) {
        throw new RequestCancelledError(errorMessage);
      } else if (isExtensionConflictError(error)) {
        throw new ExtensionConflictError(EXTENSION_CONFLICT_ERROR_MESSAGE, error);
      } else if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      } else if (error instanceof URLNotAllowedError) {
        throw error;
      } else if (error instanceof ResponseParseError) {
        throw error;
      }

      const errorString = `Navigation failed: ${errorMessage}`;
      logger.error(errorString);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_FAIL, errorString);
      agentOutput.error = errorMessage;
      return agentOutput;
    } finally {
      // if the task is cancelled, remove the last state message from memory and emit event
      if (cancelled) {
        this.removeLastStateMessageFromMemory();
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_CANCEL, 'Navigation cancelled');
      }
      if (browserStateHistory) {
        // Create a copy of actionResults to store in history
        const actionResultsCopy = actionResults.map(result => {
          return new ActionResult({
            isDone: result.isDone,
            success: result.success,
            extractedContent: result.extractedContent,
            error: result.error,
            includeInMemory: result.includeInMemory,
            interactedElement: result.interactedElement,
          });
        });

        const history = new AgentStepRecord(modelOutputString, actionResultsCopy, browserStateHistory);
        this.context.history.history.push(history);

        // logger.info('All history', JSON.stringify(this.context.history, null, 2));
      }
    }
  }

  /**
   * Add the state message to the memory
   */
  public async addStateMessageToMemory(useLiveState = true) {
    if (this.context.stateMessageAdded) {
      return;
    }

    const messageManager = this.context.messageManager;
    // Handle results that should be included in memory
    if (this.context.actionResults.length > 0) {
      let index = 0;
      for (const r of this.context.actionResults) {
        if (r.includeInMemory) {
          if (r.extractedContent) {
            const msg = new HumanMessage(`Action result: ${r.extractedContent}`);
            // logger.info('Adding action result to memory', msg.content);
            messageManager.addMessageWithTokens(msg);
          }
          if (r.error) {
            // Get error text and convert to string
            const errorText = r.error.toString().trim();

            // Get only the last line of the error
            const lastLine = errorText.split('\n').pop() || '';

            const msg = new HumanMessage(`Action error: ${lastLine}`);
            logger.info('Adding action error to memory', msg.content);
            messageManager.addMessageWithTokens(msg);
          }
          // reset this action result to empty, we dont want to add it again in the state message
          // NOTE: in python version, all action results are reset to empty, but in ts version, only those included in memory are reset to empty
          this.context.actionResults[index] = new ActionResult();
        }
        index++;
      }
    }

    const state = await this.prompt.getUserMessage(this.context, useLiveState);
    messageManager.addStateMessage(state);
    this.context.stateMessageAdded = true;
  }

  /**
   * Remove the last state message from the memory
   */
  protected async removeLastStateMessageFromMemory() {
    if (!this.context.stateMessageAdded) return;
    const messageManager = this.context.messageManager;
    messageManager.removeLastStateMessage();
    this.context.stateMessageAdded = false;
  }

  private async addModelOutputToMemory(modelOutput: this['ModelOutput']) {
    const messageManager = this.context.messageManager;
    messageManager.addModelOutput(modelOutput);
  }

  /**
   * Fix the actions to be an array of objects, sometimes the action is a string or an object
   * @param response
   * @returns
   */
  private fixActions(response: this['ModelOutput']): Record<string, unknown>[] {
    let actions: Record<string, unknown>[] = [];
    if (Array.isArray(response.action)) {
      // if the item is null, skip it
      actions = response.action.filter((item: unknown) => item !== null);
      if (actions.length === 0) {
        logger.warning('No valid actions found', response.action);
      }
    } else if (typeof response.action === 'string') {
      try {
        logger.warning('Unexpected action format', response.action);
        // First try to parse the action string directly
        actions = JSON.parse(response.action);
      } catch (parseError) {
        try {
          // If direct parsing fails, try to fix the JSON first
          const fixedAction = repairJsonString(response.action);
          logger.info('Fixed action string', fixedAction);
          actions = JSON.parse(fixedAction);
        } catch (error) {
          logger.error('Invalid action format even after repair attempt', response.action);
          throw new Error('Invalid action output format');
        }
      }
    } else {
      // if the action is neither an array nor a string, it should be an object
      actions = [response.action];
    }
    return actions;
  }

  private async doMultiAction(actions: Record<string, unknown>[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    logger.info('Actions', actions);

    const browserContext = this.context.browserContext;

    // 每次 getState() 都要等网络空闲（≥0.5s）+ 重建整棵 DOM 树 + 对全部可交互元素做 SHA-256，
    // 是单步里最贵的一项。原实现在一个元素动作里连着抓 3 次同一个活页面（循环前 / 动作前 /
    // 子集检查），其中两次之间没有任何操作碰过页面。这里改成「按需读取 + 脏标记」：
    // 只有真正执行过动作、页面可能变了之后，下一次读取才重新抓。
    let latestState = await browserContext.getState(this.context.options.useVision);
    let stateIsFresh = true;
    // latestState 对应的 branch-path 哈希集。计算一次要对全部可交互元素逐个 SHA-256，
    // 而子集检查和 before/after 签名用的是同一份数据 —— 缓存起来供两处复用。
    // state 一旦重抓就置 null（见 readState / 动作后的 afterState 赋值）。
    let cachedHashesForState: Set<string> | null = null;

    const readState = async (): Promise<BrowserState> => {
      if (!stateIsFresh) {
        latestState = await browserContext.getState(this.context.options.useVision);
        stateIsFresh = true;
        cachedHashesForState = null;
      }
      return latestState;
    };

    const readPathHashes = async (state: BrowserState): Promise<Set<string>> => {
      if (state === latestState && cachedHashesForState) {
        return cachedHashesForState;
      }
      const hashes = await calcBranchPathHashSet(state);
      if (state === latestState) {
        cachedHashesForState = hashes;
      }
      return hashes;
    };

    // 子集检查的基线。每执行完一个动作就刷新成「当前页面」，这样只拦真正在
    // 下一个动作之前新冒出来的元素；原实现整轮只在循环前算一次，导致填一个输入框
    // 触发联想下拉后，后续每个动作都会被这个陈旧基线判为「有新元素」而中断。
    let baselinePathHashes = await readPathHashes(latestState);
    const elementActionNames = new Set(['click_element', 'input_text', 'select_dropdown_option']);
    // 关掉可省一次完整 getState/动作，代价是「点了没反应」不再被自动发现（见 views.ts 注释）
    const verifyVisibleChange = browserContext.getConfig().verifyVisibleChange !== false;

    await browserContext.removeHighlight();

    for (const [i, action] of actions.entries()) {
      const actionName = Object.keys(action)[0];
      if (!actionName) {
        throw new Error('Empty action received');
      }
      const actionArgs = action[actionName];
      try {
        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }

        const actionInstance = this.actionRegistry.getAction(actionName);
        if (actionInstance === undefined) {
          throw new Error(`Action ${actionName} not exists`);
        }

        const indexArg = actionInstance.getIndexArg(actionArgs);
        const isElementAction =
          elementActionNames.has(actionName) && (indexArg !== null || hasLocatorFields(actionArgs));
        const preActionState = isElementAction ? await readState() : null;
        if (i > 0 && indexArg !== null) {
          const newState = await readState();
          const newPathHashes = await readPathHashes(newState);
          // next action requires index but there are new elements on the page
          if (!newPathHashes.isSubsetOf(baselinePathHashes)) {
            const msg = `Something new appeared after action ${i} / ${actions.length}`;
            logger.info(msg);
            results.push(
              new ActionResult({
                extractedContent: msg,
                includeInMemory: true,
              }),
            );
            break;
          }
          // 通过检查：把基线推进到当前页面，供后续动作比对
          baselinePathHashes = newPathHashes;
        }

        const result = await actionInstance.call(actionArgs);
        // 动作已落地，缓存的 state 现在可能过期了
        stateIsFresh = false;
        if (result === undefined) {
          throw new Error(`Action ${actionName} returned undefined`);
        }

        // if the action targets an element, record the interacted element using the remembered locator first
        if (isElementAction && preActionState) {
          const resolvedElement = resolveElementNodeForAction(
            preActionState.selectorMap,
            indexArg,
            (actionArgs as Record<string, unknown>).selector as string | undefined,
            (actionArgs as Record<string, unknown>).xpath as string | undefined,
            this.context.browserContext.getConfig().includeDynamicAttributes,
          );
          if (resolvedElement) {
            const interactedElement = HistoryTreeProcessor.convertDomElementToHistoryElement(resolvedElement);
            result.interactedElement = interactedElement;
            logger.info('Interacted element', interactedElement);
            logger.info('Result', result);
          }
        }

        if (isElementAction) {
          await browserContext.waitForPageStability();
          if (verifyVisibleChange) {
            // afterState 同时充当下一轮循环的 latestState —— 无需再抓一次。
            // skipStabilityWait: 上一行刚等过 DOM 静默，getState 内部不必再等一轮网络空闲。
            const preActionHashes = preActionState ? await readPathHashes(preActionState) : undefined;
            const afterState = await browserContext.getState(this.context.options.useVision, false, true);
            latestState = afterState;
            stateIsFresh = true;
            cachedHashesForState = null;
            const afterHashes = await readPathHashes(afterState);
            // 基线跟着页面走：下一个动作只和「刚才这次动作之后」的页面比
            baselinePathHashes = afterHashes;
            const [beforeSignature, afterSignature] = await Promise.all([
              getBrowserStateSignature(preActionState ?? afterState, preActionState ? preActionHashes : afterHashes),
              getBrowserStateSignature(afterState, afterHashes),
            ]);
            if (!result.error && beforeSignature === afterSignature) {
              const errorMessage = `Action ${actionName} on the selected element made no visible change. Do not repeat the same element; choose a different target or ask the user.`;
              logger.warning(errorMessage);
              results.push(
                new ActionResult({
                  error: errorMessage,
                  includeInMemory: true,
                }),
              );
              break;
            }
          }
          // verifyVisibleChange 关闭时不抓 afterState —— 省掉一次完整 getState。
          // 基线由下一轮子集检查自行刷新（见上面 baselinePathHashes 的赋值）。
        } else {
          // Smart wait for page stability after action (replaces fixed 1s delay)
          await browserContext.waitForPageStability();
        }

        results.push(result);

        if (result.error) {
          break;
        }

        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }
      } catch (error) {
        if (error instanceof URLNotAllowedError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          'doAction error',
          actionName,
          JSON.stringify(actionArgs, null, 2),
          JSON.stringify(errorMessage, null, 2),
        );
        // unexpected error, emit event
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMessage);
        results.push(
          new ActionResult({
            error: errorMessage,
            isDone: false,
            includeInMemory: true,
          }),
        );
        break;
      }
    }
    return results;
  }

  /**
   * Parse and validate model output from history item
   */
  private parseHistoryModelOutput(historyItem: AgentStepRecord): {
    parsedOutput: ParsedModelOutput;
    goal: string;
    actionsToReplay: (Record<string, unknown> | null)[] | null;
  } {
    if (!historyItem.modelOutput) {
      throw new Error('No model output found in history item');
    }

    let parsedOutput: ParsedModelOutput;
    try {
      parsedOutput = JSON.parse(historyItem.modelOutput) as ParsedModelOutput;
    } catch (error) {
      throw new Error(`Could not parse modelOutput: ${error}`);
    }

    // logger.info('Parsed output', JSON.stringify(parsedOutput, null, 2));

    const goal = parsedOutput?.current_state?.next_goal || '';
    const actionsToReplay = parsedOutput?.action;

    // Validate that there are actions to replay
    if (
      !parsedOutput || // No model output string at all
      !actionsToReplay || // 'action' field is missing or null after parsing
      (Array.isArray(actionsToReplay) && actionsToReplay.length === 0) || // 'action' is an empty array
      (Array.isArray(actionsToReplay) && actionsToReplay.length === 1 && actionsToReplay[0] === null) // 'action' is [null]
    ) {
      throw new Error('No action to replay');
    }

    return { parsedOutput, goal, actionsToReplay };
  }

  /**
   * Execute actions from history with element index updates
   */
  private async executeHistoryActions(
    parsedOutput: ParsedModelOutput,
    historyItem: AgentStepRecord,
    delay: number,
  ): Promise<ActionResult[]> {
    const state = await this.context.browserContext.getState(this.context.options.useVision);
    if (!state) {
      throw new Error('Invalid browser state');
    }

    const updatedActions: (Record<string, unknown> | null)[] = [];
    for (let i = 0; i < parsedOutput.action!.length; i++) {
      const result = historyItem.result[i];
      if (!result) {
        break;
      }
      const interactedElement = result.interactedElement;
      const currentAction = parsedOutput.action![i];

      // Skip null actions
      if (currentAction === null) {
        updatedActions.push(null);
        continue;
      }

      // If there's no interacted element, just use the action as is
      if (!interactedElement) {
        updatedActions.push(currentAction);
        continue;
      }

      const updatedAction = await this.updateActionIndices(interactedElement, currentAction, state);
      updatedActions.push(updatedAction);

      if (updatedAction === null) {
        throw new Error(`Could not find matching element ${i} in current page`);
      }
    }

    logger.debug('updatedActions', updatedActions);

    // Filter out null values and cast to the expected type
    const validActions = updatedActions.filter((action): action is Record<string, unknown> => action !== null);
    const result = await this.doMultiAction(validActions);

    // Wait for the specified delay
    await new Promise(resolve => setTimeout(resolve, delay));
    return result;
  }

  async executeHistoryStep(
    historyItem: AgentStepRecord,
    stepIndex: number,
    totalSteps: number,
    maxRetries = 3,
    delay = 1000,
    skipFailures = true,
  ): Promise<ActionResult[]> {
    const replayLogger = createLogger('NavigatorAgent:executeHistoryStep');
    const results: ActionResult[] = [];

    // Parse and validate model output
    let parsedData: {
      parsedOutput: ParsedModelOutput;
      goal: string;
      actionsToReplay: (Record<string, unknown> | null)[] | null;
    };
    try {
      parsedData = this.parseHistoryModelOutput(historyItem);
    } catch (error) {
      const errorMsg = `Step ${stepIndex + 1}: ${error instanceof Error ? error.message : String(error)}`;
      replayLogger.warning(errorMsg);
      return [
        new ActionResult({
          error: errorMsg,
          includeInMemory: false,
        }),
      ];
    }

    const { parsedOutput, goal, actionsToReplay } = parsedData;
    replayLogger.info(`Replaying step ${stepIndex + 1}/${totalSteps}: goal: ${goal}`);
    replayLogger.debug(`🔄 Replaying actions:`, actionsToReplay);

    // Try to execute the step with retries
    let retryCount = 0;
    let success = false;

    while (retryCount < maxRetries && !success) {
      try {
        // Check if execution should stop
        if (this.context.stopped) {
          replayLogger.info('Replay stopped by user');
          break;
        }

        // Execute the history actions
        const stepResults = await this.executeHistoryActions(parsedOutput, historyItem, delay);
        results.push(...stepResults);
        success = true;
      } catch (error) {
        retryCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (retryCount >= maxRetries) {
          const failMsg = `Step ${stepIndex + 1} failed after ${maxRetries} attempts: ${errorMessage}`;
          replayLogger.error(failMsg);

          results.push(
            new ActionResult({
              error: failMsg,
              includeInMemory: true,
            }),
          );

          if (!skipFailures) {
            throw new Error(failMsg);
          }
        } else {
          replayLogger.warning(`Step ${stepIndex + 1} failed (attempt ${retryCount}/${maxRetries}), retrying...`);
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return results;
  }

  async updateActionIndices(
    historicalElement: DOMHistoryElement,
    action: Record<string, unknown>,
    currentState: BrowserState,
  ): Promise<Record<string, unknown> | null> {
    // If no historical element or no element tree in current state, return the action unchanged
    if (!historicalElement || !currentState.elementTree) {
      return action;
    }

    // Find the current element in the tree based on the historical element
    const currentElement = await HistoryTreeProcessor.findHistoryElementInTree(
      historicalElement,
      currentState.elementTree,
    );

    // If no current element found or it doesn't have a highlight index, return null
    if (!currentElement || currentElement.highlightIndex === null) {
      return null;
    }

    // Get action name and args
    const actionName = Object.keys(action)[0];
    const actionArgs = action[actionName] as Record<string, unknown>;

    // Get the action instance to access the index
    const actionInstance = this.actionRegistry.getAction(actionName);
    if (!actionInstance) {
      return action;
    }

    // Get the index argument from the action
    const oldIndex = actionInstance.getIndexArg(actionArgs);

    // If the index has changed, update it
    if (oldIndex !== null && oldIndex !== currentElement.highlightIndex) {
      // Create a new action object with the updated index
      const updatedAction: Record<string, unknown> = { [actionName]: { ...actionArgs } };

      // Update the index in the action arguments
      actionInstance.setIndexArg(updatedAction[actionName] as Record<string, unknown>, currentElement.highlightIndex);

      logger.info(`Element moved in DOM, updated index from ${oldIndex} to ${currentElement.highlightIndex}`);
      return updatedAction;
    }

    return action;
  }

  /**
   * 把用户的 ClarifyResponse 压成一句英文摘要，用于注入 LLM 历史 + 广播给前端。
   */
  private describeClarifyResponse(resp: ClarifyResponse): string {
    const bits: string[] = [];
    if (resp.choiceId) bits.push(`User chose option id=${resp.choiceId}.`);
    if (resp.text?.trim()) bits.push(`User typed: ${resp.text.trim()}`);
    if (resp.pickedSelector || resp.pickedXpath) {
      const segs: string[] = [];
      if (resp.pickedSelector) segs.push(`selector=${resp.pickedSelector}`);
      if (resp.pickedXpath) segs.push(`xpath=${resp.pickedXpath}`);
      if (resp.pickedText) segs.push(`text="${resp.pickedText.slice(0, 80)}"`);
      bits.push(`User picked an element: ${segs.join(', ')}.`);
    }
    if (resp.cancelled) bits.push('User cancelled the question.');
    if (resp.abortTask) bits.push('User aborted the task.');
    return bits.length ? bits.join(' ') : 'User answered with no content.';
  }

  /**
   * 目标元素是否已经在本站事实库中（xpath 或 selector 精确匹配）。
   *
   * 用途：闸门放行判据。用户此前已经指认过的元素不应再被反复追问 —— 这正是
   * 「记忆里已有的元素还用 ask_user 让用户拾取」这一 bug 的根因：硬上限只看
   * 当前 DOM 证据（无文字 icon → 0.6），完全没有查过记忆。
   *
   * 失败不阻塞：任何异常都按「没命中」处理，让原有闸门逻辑继续。
   */
  private async isRememberedElement(elementIndex: number): Promise<boolean> {
    try {
      const cachedState = await this.context.browserContext.getCachedState();
      const elementNode = cachedState?.selectorMap.get(elementIndex);
      if (!elementNode) return false;

      const hostname = getHostnameFromUrl(cachedState?.url ?? '');
      if (!hostname) return false;

      const hints = await elementHintsStore.getByHostname(hostname);
      if (hints.length === 0) return false;

      const nodeXpath = elementNode.xpath?.trim() || '';
      const includeDynamic = this.context.browserContext.getConfig().includeDynamicAttributes;
      const nodeSelectors = [
        elementNode.enhancedCssSelectorForElement(includeDynamic),
        elementNode.enhancedCssSelectorForElement(!includeDynamic),
      ];

      return matchesRememberedElement(hints, nodeXpath, nodeSelectors);
    } catch (err) {
      logger.warning('[gate] memory lookup failed:', err);
      return false;
    }
  }

  /**
   * 把握度闸门：检查本步是否有元素交互动作且 element_confidence < 阈值，是则发 ask_user 并 pause 等用户。
   * 返回 true 表示已经接管这一步（调用方应 skip doMultiAction）；false 表示放行。
   *
   * 设计要点：
   *  - 阈值固定 0.7（< 0.7 = 不放心；前端无需暴露调参）
   *  - 仅对 click_element / input_text / select_dropdown_option 三种"要 index"的动作生效
   *  - allow_element_pick=true：用户可以直接在页面上点正确的元素，picker 已存在
   *  - 用户回应中的 pickedSelector/Xpath 会暂存到 context.pendingPickedHints
   *    下一次任何元素动作成功执行后，由 builder.ts 中的成功分支落库到 elementHintsStore
   *
   *  - **系统侧硬上限**：即使 LLM 自评 ≥0.7，也要做客观检查：纯 icon（无文本/aria-label）按钮、
   *    同容器多个相似兄弟等情况会被强制降到 ≤0.6 触发用户澄清，避免 LLM 虚报高分绕过闸门
   */
  private async maybeGateOnLowConfidence(
    modelOutput: this['ModelOutput'],
    actions: Record<string, unknown>[],
  ): Promise<boolean> {
    const ELEMENT_GATE_THRESHOLD = 0.7;
    const ELEMENT_ACTIONS = new Set(['click_element', 'input_text', 'select_dropdown_option']);

    const currentState = (modelOutput as { current_state?: Record<string, unknown> }).current_state;
    const llmConf = (currentState?.element_confidence as number | undefined) ?? 1;
    const purpose = (currentState?.element_purpose as string | undefined) || '';
    const nextGoal = (currentState?.next_goal as string | undefined) || '';

    // 找到本步第一个 ELEMENT 动作 + 它的 index
    let elementActionIndex: number | undefined;
    let elementActionName: string | undefined;
    for (const a of actions) {
      const name = Object.keys(a)[0];
      if (name && ELEMENT_ACTIONS.has(name)) {
        const args = a[name] as Record<string, unknown> | undefined;
        const idx = args?.index as number | undefined;
        if (typeof idx === 'number') {
          elementActionIndex = idx;
          elementActionName = name;
        }
        break;
      }
    }
    if (elementActionIndex === undefined) return false;

    if (this.context.skipNextElementGateForPickedHint) {
      this.context.skipNextElementGateForPickedHint = false;
      logger.info(
        `[gate] bypassed once after user picked an element (index=${elementActionIndex}, action=${elementActionName})`,
      );
      return false;
    }

    // 记忆命中即放行：若目标元素的 xpath/selector 已经存在于本站事实库中（尤其是
    // source='user_pick' 的条目），说明用户此前已经指认过同一个元素，再问一次纯属骚扰。
    // 放在硬上限之前 —— 无文字的 icon 按钮正是最需要记忆、也最容易被硬上限打回的一类。
    if (await this.isRememberedElement(elementActionIndex)) {
      logger.info(
        `[gate] bypassed: element already in memory (index=${elementActionIndex}, action=${elementActionName})`,
      );
      return false;
    }

    // === 系统侧硬上限检查 ===
    // 即使 LLM 给 1.0，也要看客观证据：元素本身有没有文本可识别？同容器有多少相似兄弟？
    let hardCap = 1.0;
    const capReasons: string[] = [];
    try {
      const cachedState = await this.context.browserContext.getCachedState();
      const elementNode = cachedState?.selectorMap.get(elementActionIndex);
      if (elementNode) {
        // 1. 有可识别文本吗？
        const text = (elementNode.getAllTextTillNextClickableElement(2) || '').trim();
        const attrs = elementNode.attributes || {};
        const ariaLabel = (attrs['aria-label'] || '').trim();
        const title = (attrs['title'] || '').trim();
        const placeholder = (attrs['placeholder'] || '').trim();
        const alt = (attrs['alt'] || '').trim();
        const value = (attrs['value'] || '').trim();
        const hasAnyText =
          text.length > 0 || ariaLabel.length > 0 || title.length > 0 || placeholder.length > 0 || alt.length > 0;
        if (!hasAnyText) {
          hardCap = Math.min(hardCap, 0.6);
          capReasons.push('no_text_or_aria');
        }

        // 2. 兄弟元素相似性：同父级、同 tag、可交互且都无文本的元素数量
        const parent = (elementNode as { parent?: { children?: unknown[] } | null }).parent;
        if (parent?.children && Array.isArray(parent.children)) {
          let similarSiblings = 0;
          for (const sib of parent.children) {
            const s = sib as {
              tagName?: string | null;
              isInteractive?: boolean;
              highlightIndex?: number | null;
              getAllTextTillNextClickableElement?: (d?: number) => string;
              attributes?: Record<string, string>;
            };
            if (!s || s === (elementNode as unknown)) continue;
            if (s.tagName !== elementNode.tagName) continue;
            if (!s.isInteractive) continue;
            // 兄弟无文本（同样是 icon 按钮组）
            const sText = (s.getAllTextTillNextClickableElement?.(2) || '').trim();
            const sAttrs = s.attributes || {};
            const sHasText =
              sText.length > 0 ||
              (sAttrs['aria-label'] || '').trim().length > 0 ||
              (sAttrs['title'] || '').trim().length > 0;
            if (!sHasText && !hasAnyText) {
              // 多个相邻无文字 icon → 极易混淆
              similarSiblings++;
            } else if (sHasText && hasAnyText) {
              // 都有文字也算相似（如多个 "Submit" 并存）
              similarSiblings++;
            }
          }
          if (similarSiblings >= 1 && !hasAnyText) {
            // 自己无文字且有同款无文字兄弟 → icon 群陷阱
            hardCap = Math.min(hardCap, 0.5);
            capReasons.push(`icon_group_${similarSiblings + 1}`);
          } else if (similarSiblings >= 2) {
            hardCap = Math.min(hardCap, 0.7);
            capReasons.push(`siblings_${similarSiblings + 1}`);
          }
        }

        // 3. <button> 但只含 svg/img 且无任何 aria/title/alt → 无文字 icon 按钮
        if (elementNode.tagName?.toLowerCase() === 'button' && !hasAnyText && Array.isArray(elementNode.children)) {
          const onlyMediaChildren = elementNode.children.every(c => {
            const tn = (c as { tagName?: string }).tagName?.toLowerCase();
            return tn === 'svg' || tn === 'img' || tn === 'i' || !tn;
          });
          if (onlyMediaChildren) {
            hardCap = Math.min(hardCap, 0.6);
            capReasons.push('svg_only_button');
          }
        }

        if (capReasons.length > 0) {
          logger.info(
            `[gate] hardCap=${hardCap} for index=${elementActionIndex} action=${elementActionName} reasons=[${capReasons.join(',')}] (llm_conf=${llmConf})`,
          );
        }
      }
    } catch (err) {
      // 评估失败不阻塞主流程，沿用 LLM 自评
      logger.warning('[gate] hardCap check failed:', err);
    }

    // 最终 confidence = min(LLM 自评, 硬上限)
    const effectiveConf = Math.min(llmConf, hardCap);
    if (effectiveConf >= ELEMENT_GATE_THRESHOLD) return false;

    logger.info(
      `[gate] effective_confidence=${effectiveConf} < ${ELEMENT_GATE_THRESHOLD}` +
        ` (llm=${llmConf}, cap=${hardCap}${capReasons.length ? ', reasons=' + capReasons.join(',') : ''})` +
        ` asking user for ${purpose || 'element'}`,
    );

    const requestId = crypto.randomUUID();
    const reasonHint =
      capReasons.length > 0
        ? `（系统判定：${capReasons.includes('no_text_or_aria') || capReasons.includes('svg_only_button') ? '无文字描述的图标按钮' : capReasons.find(r => r.startsWith('icon_group_')) ? '同区域多个无文字图标，容易选错' : '同区域多个相似元素'}）`
        : `（confidence=${effectiveConf.toFixed(2)}，AI 不太确定）`;
    const question = purpose
      ? `请帮我指认页面上的「${purpose}」${reasonHint}`
      : `请帮我确认接下来该操作哪个元素${reasonHint}`;
    const payload: AskUserPayload = {
      requestId,
      source: 'navigator',
      question,
      context: nextGoal ? `AI 下一步打算：${nextGoal}` : undefined,
      allowFreeText: true,
      allowElementPick: true,
    };
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ASK_USER, JSON.stringify(payload));
    await this.context.pause();
    let resp: ClarifyResponse;
    try {
      resp = await this.context.waitForClarification(requestId);
    } finally {
      await this.context.resume();
    }

    // 用户拾取了元素 → 暂存到 pendingPickedHints，等下一次元素动作成功后落库
    if (resp.pickedSelector || resp.pickedXpath) {
      this.context.pendingPickedHints.push({
        purpose: purpose || '用户拾取的元素',
        selector: resp.pickedSelector,
        stableSelector: resp.pickedStableSelector,
        xpath: resp.pickedXpath,
        textContent: resp.pickedText,
      });
      this.context.skipNextElementGateForPickedHint = true;
    }

    // 立刻把本步动作改写到用户拾取的元素上并放行执行，而不是把 xpath 塞进 prose
    // 让 LLM 下一轮自己抄。这是「用户拾取后没有按拾取结果点击」的根因：注入的只是
    // 自然语言，LLM 经常忽略它、继续用原来那个 index，于是又点回错的元素。
    const pickedLocator = resp.pickedXpath?.trim() || resp.pickedSelector?.trim();
    if (pickedLocator && !resp.cancelled && !resp.abortTask && elementActionName) {
      const targetAction = actions.find(a => Object.keys(a)[0] === elementActionName);
      const targetArgs = targetAction?.[elementActionName] as Record<string, unknown> | undefined;
      if (targetArgs) {
        if (resp.pickedXpath?.trim()) targetArgs.xpath = resp.pickedXpath.trim();
        if (resp.pickedSelector?.trim()) targetArgs.selector = resp.pickedSelector.trim();
        this.context.currentElementPurpose = purpose || '用户拾取的元素';
        logger.info(
          `[gate] retargeted ${elementActionName} to user-picked element` +
            ` (xpath=${resp.pickedXpath || '-'}, selector=${resp.pickedSelector || '-'})`,
        );
        // 摘要仍然注入历史，让后续轮次知道用户指认过什么
        this.context.messageManager.addMessageWithTokens(
          new HumanMessage({
            content: `[User clarification] ${this.describeClarifyResponse(resp)} The current step has been retargeted to that element.`,
          }),
          'clarify',
        );
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ASK_USER_RESOLVED, this.describeClarifyResponse(resp));
        return false;
      }
    }

    // 把摘要广播给前端 + 注入 message manager，让下一轮 Navigator 看到用户的回答
    const summary = this.describeClarifyResponse(resp);

    this.context.messageManager.addMessageWithTokens(
      new HumanMessage({ content: `[User clarification] ${summary}` }),
      'clarify',
    );
    this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ASK_USER_RESOLVED, summary);
    if (resp.abortTask) {
      await this.context.stop();
    }
    return true;
  }
}
