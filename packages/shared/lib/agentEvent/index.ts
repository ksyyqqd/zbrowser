/**
 * 跨子项目共享的 Agent 执行事件类型。
 *
 * 之前 chrome-extension 和 side-panel 各自维护了一份 event.ts 副本，
 * 出现过 enum 漏同步导致流式事件被前端当成"未知步骤状态"丢弃的 bug。
 * 现统一收敛到此处。
 */

export enum Actors {
  SYSTEM = 'system',
  USER = 'user',
  PLANNER = 'planner',
  NAVIGATOR = 'navigator',
  VALIDATOR = 'validator',
}

export enum EventType {
  /**
   * Type of events that can be subscribed to.
   *
   * For now, only execution events are supported.
   */
  EXECUTION = 'execution',
}

export enum ExecutionState {
  /**
   * States representing different phases in the execution lifecycle.
   *
   * Format: <SCOPE>.<STATUS>
   * Scopes: task, step, act, stream
   * Statuses: start, ok, fail, cancel, delta, end
   */
  // Task level states
  TASK_START = 'task.start',
  TASK_OK = 'task.ok',
  TASK_FAIL = 'task.fail',
  TASK_PAUSE = 'task.pause',
  TASK_RESUME = 'task.resume',
  TASK_CANCEL = 'task.cancel',

  // Step level states
  STEP_START = 'step.start',
  STEP_OK = 'step.ok',
  STEP_FAIL = 'step.fail',
  STEP_CANCEL = 'step.cancel',

  // Action/Tool level states
  ACT_START = 'act.start',
  ACT_OK = 'act.ok',
  ACT_FAIL = 'act.fail',

  // 流式推理事件：planner 在做决策前会先 stream 一段推理给用户看
  // STREAM_DELTA 的 details 字段携带增量文本；STREAM_END 标志该段结束
  STREAM_DELTA = 'stream.delta',
  STREAM_END = 'stream.end',

  // 用户澄清事件：Agent 暂停任务并向用户提问
  // ASK_USER 的 details 字段是 JSON.stringify(AskUserPayload)
  // ASK_USER_RESOLVED 的 details 是给消息流展示的摘要文案
  ASK_USER = 'ask.user',
  ASK_USER_RESOLVED = 'ask.user.resolved',

  // 任务失败诊断事件：紧随 TASK_FAIL 之后发出。
  // details 字段是 JSON.stringify(TaskFailDiagnosis)，由 LLM 异步生成。
  // 失败 / 超时则不会发出（fallback 到 TASK_FAIL 单事件流程）。
  TASK_FAIL_DIAGNOSIS = 'task.fail.diagnosis',
}

/** TASK_FAIL_DIAGNOSIS 事件 details 解析后的形状 */
export interface TaskFailDiagnosis {
  /** 一句话失败原因（不超过 30 字） */
  summary: string;
  /** 3 条具体修复建议（每条不超过 25 字） */
  suggestions: string[];
}

// ===== 用户澄清相关共享类型 =====

export interface AskUserOption {
  id: string;
  label: string;
  description?: string;
}

export interface AskUserPayload {
  /** 用于回应匹配的请求 id */
  requestId: string;
  /** 给用户看的问题主体 */
  question: string;
  /** 可选附加说明 */
  context?: string;
  /** 预置单选项（可为空，仅自由文本） */
  options?: AskUserOption[];
  /** 是否允许自由文本回答（默认 true） */
  allowFreeText?: boolean;
  /** 是否在弹窗里放「在页面拾取元素」入口（默认 false） */
  allowElementPick?: boolean;
  /** 拾取目标 tab id；省略时由 side-panel 取当前 active tab */
  pickTabId?: number;
  /** 这次提问来自哪个 actor，用于弹窗展示徽章 */
  source: 'navigator' | 'planner';
}

export interface ClarifyResponse {
  requestId: string;
  /** 用户取消弹窗（Agent 自己决定下一步） */
  cancelled?: boolean;
  /** 用户希望直接终止整个任务 */
  abortTask?: boolean;
  /** 用户选中的 option id（如有 options） */
  choiceId?: string;
  /** 用户填写的自由文本（如有） */
  text?: string;
  /** 用户拾取的元素 selector */
  pickedSelector?: string;
  /** 用户拾取的元素 xpath */
  pickedXpath?: string;
  /** 拾取元素的可见文本（截断 200 字） */
  pickedText?: string;
}

export interface EventData {
  /** Data associated with an event */
  taskId: string;
  /** step is the step number of the task where the event occurred */
  step: number;
  /** max_steps is the maximum number of steps in the task */
  maxSteps: number;
  /** details is the content of the event */
  details: string;
}

export class AgentEvent {
  /**
   * Represents a state change event in the task execution system.
   * Each event has a type, a specific state that changed,
   * the actor that triggered the change, and associated data.
   */
  constructor(
    public actor: Actors,
    public state: ExecutionState,
    public data: EventData,
    public timestamp: number = Date.now(),
    public type: EventType = EventType.EXECUTION,
  ) {}
}

// The type of callback for event subscribers
export type EventCallback = (event: AgentEvent) => Promise<void>;
