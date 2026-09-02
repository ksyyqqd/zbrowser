import { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type BrowserContext from '../browser/context';
import { DEFAULT_INCLUDE_ATTRIBUTES } from '../browser/dom/views';
import type { DOMHistoryElement } from '../browser/dom/history/view';
import type MessageManager from './messages/service';
import type { EventManager } from './event/manager';
import { type Actors, type ExecutionState, AgentEvent, type ClarifyResponse } from '@extension/shared';
import { AgentStepHistory } from './history';
import type { ToolExecutionResult, MCPTool } from '@extension/mcp-client';
import type { Skill, SkillExecutionResult } from '@extension/skills';
import type { SkillCreateInput, SkillCreateResult } from '../services/skills/createFromAI';
import type { OrchestrationFrame } from '../services/workflow/orchestrationDepth';
import type {
  WorkflowCreateInput,
  WorkflowCreateResult,
  WorkflowSummary,
  WorkflowUpdateInput,
  WorkflowUpdateResult,
} from '../services/workflow/types';

export interface AgentOptions {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  retryDelay: number;
  maxInputTokens: number;
  maxErrorLength: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  includeAttributes: string[];
  planningInterval: number;
  autonomousMode: boolean;
}

export const DEFAULT_AGENT_OPTIONS: AgentOptions = {
  maxSteps: 100,
  maxActionsPerStep: 10,
  maxFailures: 3,
  retryDelay: 10,
  maxInputTokens: 128000,
  maxErrorLength: 400,
  useVision: false,
  useVisionForPlanner: true,
  includeAttributes: DEFAULT_INCLUDE_ATTRIBUTES,
  planningInterval: 3,
  autonomousMode: false,
};

export class AgentContext {
  controller: AbortController;
  taskId: string;
  browserContext: BrowserContext;
  messageManager: MessageManager;
  eventManager: EventManager;
  options: AgentOptions;
  paused: boolean;
  stopped: boolean;
  skipRequested: boolean;
  consecutiveFailures: number;
  nSteps: number;
  stepInfo: AgentStepInfo | null;
  actionResults: ActionResult[];
  stateMessageAdded: boolean;
  history: AgentStepHistory;
  finalAnswer: string | null;
  // Provider and model info for vision capability check
  navigatorProvider: string;
  navigatorModelName: string;
  plannerProvider: string;
  plannerModelName: string;
  // Vision model info (optional - separate model for visual analysis)
  visionProvider: string;
  visionModelName: string;
  visionLLM?: BaseChatModel;

  // MCP and Skills service methods (optional - set by services)
  executeMCPTool?: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>;
  listMCPTools?: (serverId?: string) => Promise<MCPTool[]>;
  getMCPStatus?: (serverId?: string) => Promise<Record<string, unknown>>;
  executeSkill?: (skillId: string, params: Record<string, unknown>, mode?: string) => Promise<SkillExecutionResult>;
  listSkills?: (category?: string) => Promise<Skill[]>;
  getSkillInfo?: (skillId: string) => Promise<Skill | undefined>;
  /** 创建 skill。第二个参数是本轮已创建数量，见 `skillsCreatedThisTask`。 */
  createSkill?: (input: SkillCreateInput, createdCount: number) => Promise<SkillCreateResult>;

  /** 本轮任务中 AI 已创建的 skill 数量，上限见 `MAX_SKILL_CREATES_PER_TASK`。 */
  skillsCreatedThisTask = 0;

  // Workflow service methods (optional - set by WorkflowService wiring)
  // 注意这里没有 executeWorkflow：AI 只创建和修改工作流，执行入口只有用户在 UI 上点。
  listWorkflows?: () => Promise<WorkflowSummary[]>;
  getWorkflowSummary?: (workflowId: string) => Promise<WorkflowSummary | undefined>;
  /**
   * 创建工作流。第二个参数是本轮已创建数量，由 builder 从 `workflowsCreatedThisTask`
   * 读出来传入 —— 计数放在 context 上而不是 service 里，因为「一轮任务」的边界就是
   * 一个 Executor 的生命周期。
   */
  createWorkflow?: (input: WorkflowCreateInput, createdCount: number) => Promise<WorkflowCreateResult>;
  /** 修改工作流。计数同上，但和创建分开计 —— 见 `MAX_WORKFLOW_UPDATES_PER_TASK`。 */
  updateWorkflow?: (input: WorkflowUpdateInput, updatedCount: number) => Promise<WorkflowUpdateResult>;

  /**
   * 本轮任务中 AI 已创建的工作流数量。用于挡住「卡住了就再建一个」的打转行为，
   * 上限见 `MAX_WORKFLOW_CREATES_PER_TASK`。
   */
  workflowsCreatedThisTask = 0;

  /** 本轮任务中 AI 已修改的次数，上限见 `MAX_WORKFLOW_UPDATES_PER_TASK`。 */
  workflowsUpdatedThisTask = 0;

  /**
   * 本 Executor 在编排链上的位置。
   *
   * 顶层用户对话是空链；被工作流的 ai 节点唤起的 Executor 会拿到调用方的链。
   * 深度上限和环检测用它 —— 见 `services/workflow/orchestrationDepth.ts` 的文件头注释：
   * 跨 AI 边界的递归 `WorkflowExecutor._subflowStack` 追不到。
   *
   * AI 已经不能触发工作流，所以链目前只能由 subflow / ai 节点自己长出来；保留是因为
   * 「工作流 → ai 节点 → 新 Executor」这条边界依然存在，而 handleExecuteWorkflow 是
   * 唯一的执行入口，守卫放在那里对所有来路都有效。
   */
  orchestrationStack: OrchestrationFrame[] = [];

  // 用户澄清等待回调表：ask_user action / planner.ask_user 调用时挂一项，
  // background 端收到 side-panel 的回应后路由到这里 resolve 对应 promise。
  pendingClarifications: Map<string, (response: ClarifyResponse) => void> = new Map();

  // 用户拾取的待落库元素提示。askUser handler 收到 ClarifyResponse 时若带 pickedSelector/Xpath，
  // 暂存一条到这里；下一个 click_element / input_text / select_dropdown_option 成功执行后，
  // 由 builder 调 elementHintsStore.addHint 落库并清空。
  // 不立刻落库 = 规避「拾取了但是错的」污染事实库（用户拾取后 AI 试了报错则丢弃）。
  pendingPickedHints: Array<{
    purpose: string;
    selector?: string;
    /** 基于 data-testid / aria-label 等稳定属性的备用选择器（selector 依赖易变的哈希 class） */
    stableSelector?: string;
    xpath?: string;
    textContent?: string;
  }> = [];

  // Set after the user picks an element from ask_user. The next element action
  // should be attempted once instead of immediately re-opening the same gate.
  skipNextElementGateForPickedHint = false;

  /**
   * 当前 LLM 决策中声明的元素用途（来自 current_state.element_purpose）。
   * Navigator 在执行动作前从 modelOutput.current_state 抓一份放这里，
   * builder.ts 的 persistHintOnSuccess 用作落库时的 purpose 字段。
   * 每次 Navigator step 结束清空。
   */
  currentElementPurpose: string = '';

  /**
   * Planner 最近 N 次的 observation 记录，用于检测循环。
   * 存储格式：[{ observation: string, step: number }, ...]
   * 最多保留最近 5 次，用于相似度比较。
   */
  recentObservations: Array<{ observation: string; step: number }> = [];

  constructor(
    taskId: string,
    browserContext: BrowserContext,
    messageManager: MessageManager,
    eventManager: EventManager,
    options: Partial<AgentOptions>,
    navigatorProvider: string = '',
    navigatorModelName: string = '',
    plannerProvider: string = '',
    plannerModelName: string = '',
    visionProvider: string = '',
    visionModelName: string = '',
  ) {
    this.controller = new AbortController();
    this.taskId = taskId;
    this.browserContext = browserContext;
    this.messageManager = messageManager;
    this.eventManager = eventManager;
    this.options = { ...DEFAULT_AGENT_OPTIONS, ...options };
    this.navigatorProvider = navigatorProvider;
    this.navigatorModelName = navigatorModelName;
    this.plannerProvider = plannerProvider;
    this.plannerModelName = plannerModelName;
    this.visionProvider = visionProvider;
    this.visionModelName = visionModelName;

    this.paused = false;
    this.stopped = false;
    this.skipRequested = false;
    this.nSteps = 0;
    this.consecutiveFailures = 0;
    this.stepInfo = null;
    this.actionResults = [];
    this.stateMessageAdded = false;
    this.history = new AgentStepHistory();
    this.finalAnswer = null;
  }

  async emitEvent(actor: Actors, state: ExecutionState, eventDetails: string) {
    const event = new AgentEvent(actor, state, {
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.options.maxSteps,
      details: eventDetails,
    });
    await this.eventManager.emit(event);
  }

  async pause() {
    this.paused = true;
  }

  async resume() {
    this.paused = false;
  }

  async stop() {
    this.stopped = true;
    setTimeout(() => this.controller.abort(), 300);
  }

  /**
   * 等待 side-panel 那边针对给定 requestId 的回应。
   * 配合 ask_user action / planner ask_user 使用：调用方负责先发 ASK_USER 事件并 pause。
   */
  waitForClarification(requestId: string): Promise<ClarifyResponse> {
    return new Promise(resolve => {
      this.pendingClarifications.set(requestId, resolve);
    });
  }

  /**
   * Background port 收到 clarify_response 后调用，转发到对应 promise。
   * 返回是否匹配成功，未匹配时由调用方记日志（任务可能已经被取消或 service worker 被回收）。
   */
  resolveClarification(requestId: string, response: ClarifyResponse): boolean {
    const cb = this.pendingClarifications.get(requestId);
    if (!cb) return false;
    this.pendingClarifications.delete(requestId);
    cb(response);
    return true;
  }
}

export class AgentStepInfo {
  stepNumber: number;
  maxSteps: number;

  constructor(params: { stepNumber: number; maxSteps: number }) {
    this.stepNumber = params.stepNumber;
    this.maxSteps = params.maxSteps;
  }
}

export class ActionResult {
  isDone: boolean;
  success: boolean;
  extractedContent: string | null;
  error: string | null;
  includeInMemory: boolean;
  interactedElement: DOMHistoryElement | null;

  constructor(params: Partial<ActionResult> = {}) {
    this.isDone = params.isDone ?? false;
    this.success = params.success ?? false;
    this.interactedElement = params.interactedElement ?? null;
    this.extractedContent = params.extractedContent ?? null;
    this.error = params.error ?? null;
    this.includeInMemory = params.includeInMemory ?? false;
  }
}

export type WrappedActionResult = ActionResult & {
  toolCallId: string;
};

export class StepMetadata {
  stepStartTime: number;
  stepEndTime: number;
  inputTokens: number;
  stepNumber: number;

  constructor(stepStartTime: number, stepEndTime: number, inputTokens: number, stepNumber: number) {
    this.stepStartTime = stepStartTime;
    this.stepEndTime = stepEndTime;
    this.inputTokens = inputTokens;
    this.stepNumber = stepNumber;
  }

  /**
   * Calculate step duration in seconds
   */
  get durationSeconds(): number {
    return this.stepEndTime - this.stepStartTime;
  }
}

export const agentBrainSchema = z
  .object({
    evaluation_previous_goal: z.string(),
    memory: z.string(),
    next_goal: z.string(),
    // 元素把握度自评：本步打算操作的元素你有多大把握选对了？
    // 0.0 = 几乎在猜；0.7 = 比较有把握；0.9+ = 几乎肯定（如已知元素事实库里能直接匹）。
    // 当本步动作包含 click_element / input_text / select_dropdown_option 但分数 < 0.7 时，
    // executor 会自动把动作丢弃并转为 ask_user with allow_element_pick=true。
    // 不操作元素的步骤（go_to_url / scroll / wait 等）可留默认 1.0。
    element_confidence: z.number().min(0).max(1).default(1),
    // 你打算操作的元素是干什么用的，2-12 个字：「提交按钮」/「搜索框」/「展开评论」。
    // 用于 ask_user 弹窗中显示问题、以及拾取成功后持久化到元素事实库的 purpose 字段。
    // 不操作元素的步骤可留空。
    element_purpose: z.string().default(''),
  })
  .describe('Current state of the agent');

export type AgentBrain = z.infer<typeof agentBrainSchema>;

// Make AgentOutput generic with Zod schema
export interface AgentOutput<T = unknown> {
  /**
   * The unique identifier for the agent
   */
  id: string;

  /**
   * The result of the agent's step
   */
  result?: T;
  /**
   * The error that occurred during the agent's action
   */
  error?: string;
}
