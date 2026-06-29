import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { ActionResult, type AgentOutput } from '../types';
import type { Action } from '../actions/builder';
import { buildDynamicActionSchema } from '../actions/builder';
import { agentBrainSchema } from '../types';
import { type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { Actors, ExecutionState, type AskUserPayload, type ClarifyResponse } from '@extension/shared';
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

        // Try to extract JSON from markdown code blocks if parsing failed
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('is not valid JSON') &&
          response?.raw?.content &&
          typeof response.raw.content === 'string'
        ) {
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
      throw new ResponseParseError('Could not parse navigator response');
    }

    // Fallback to parent class manual JSON extraction for models without structured output support
    return super.invoke(inputMessages);
  }

  async execute(): Promise<AgentOutput<NavigatorResult>> {
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
      await this.addStateMessageToMemory();
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

      // check if the task is paused or stopped
      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }
      // emit event
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_OK, 'Navigation done');
      let done = false;
      if (actionResults.length > 0 && actionResults[actionResults.length - 1].isDone) {
        done = true;
      }
      agentOutput.result = { done };
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
  public async addStateMessageToMemory() {
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

    const state = await this.prompt.getUserMessage(this.context);
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
    let errCount = 0;
    logger.info('Actions', actions);

    const browserContext = this.context.browserContext;
    const browserState = await browserContext.getState(this.context.options.useVision);
    const cachedPathHashes = await calcBranchPathHashSet(browserState);

    await browserContext.removeHighlight();

    for (const [i, action] of actions.entries()) {
      const actionName = Object.keys(action)[0];
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
        if (i > 0 && indexArg !== null) {
          const newState = await browserContext.getState(this.context.options.useVision);
          const newPathHashes = await calcBranchPathHashSet(newState);
          // next action requires index but there are new elements on the page
          if (!newPathHashes.isSubsetOf(cachedPathHashes)) {
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
        }

        const result = await actionInstance.call(actionArgs);
        if (result === undefined) {
          throw new Error(`Action ${actionName} returned undefined`);
        }

        // if the action has an index argument, record the interacted element to the result
        if (indexArg !== null) {
          const domElement = browserState.selectorMap.get(indexArg);
          if (domElement) {
            const interactedElement = HistoryTreeProcessor.convertDomElementToHistoryElement(domElement);
            result.interactedElement = interactedElement;
            logger.info('Interacted element', interactedElement);
            logger.info('Result', result);
          }
        }
        results.push(result);

        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }
        // Smart wait for page stability after action (replaces fixed 1s delay)
        await browserContext.waitForPageStability();
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
        errCount++;
        if (errCount > 3) {
          throw new Error('Too many errors in actions');
        }
        results.push(
          new ActionResult({
            error: errorMessage,
            isDone: false,
            includeInMemory: true,
          }),
        );
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
        xpath: resp.pickedXpath,
        textContent: resp.pickedText,
      });
    }

    // 把摘要广播给前端 + 注入 message manager，让下一轮 Navigator 看到用户的回答
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
    const summary = bits.length ? bits.join(' ') : 'User answered with no content.';

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
