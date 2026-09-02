/**
 * AI 侧看到的工作流类型。
 *
 * 刻意不复用 `@extension/workflow` 的 `Workflow`：那是给画布用的结构，带着每个节点的
 * `position: {x, y}`、完整的 `edges` 数组和各节点的 `data`。把它 JSON 化塞进对话上下文
 * 是纯粹的浪费 —— 坐标和边对「该不该调这个工作流」这个决策毫无信息量，却能轻易占掉
 * 几千 token。所以这里定义一个**裁剪后的摘要**，只保留 AI 做决策真正需要的东西。
 */

/** 工作流的入参声明，AI 靠它决定要不要先问用户。 */
export interface WorkflowVariableSummary {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  /** 有默认值时 AI 可以不追问用户。 */
  hasDefault: boolean;
}

/**
 * 给 AI 看的工作流摘要。
 *
 * `steps` 只给节点名的有序列表而不是完整节点：AI 需要知道「这个工作流大概会做什么」
 * 来判断是否匹配用户意图，但不需要知道每个节点的参数 —— 那是执行期的事。
 */
export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  variables: WorkflowVariableSummary[];
  /** 节点名的有序列表（已剔除 start / end / note）。 */
  steps: string[];
  /**
   * 是否已被用户确认。
   *
   * AI 写过的工作流（新建或修改）都是 false —— 那份图没被任何人验证过，直接可执行
   * 等于让未经审核的脚本操作用户的浏览器。这类工作流仍然出现在 `workflow_list` 里
   * （AI 需要能接着改自己刚写的那个），但用户在 UI 上确认前不能执行、也进不了书签。
   */
  reviewed: boolean;
}

/** AI 提交的单个步骤。字段名用 snake_case 是为了对齐 action schema 里 LLM 看到的形状。 */
export interface WorkflowCreateStepInput {
  kind: 'automation' | 'ai' | 'output';
  name?: string;
  description?: string;
  action?: string;
  parameters?: Record<string, unknown>;
  prompt?: string;
  output_variable?: string;
  content?: string;
}

export interface WorkflowCreateVariableInput {
  name: string;
  type?: 'string' | 'number' | 'boolean';
  required?: boolean;
  description?: string;
  default?: string;
}

export interface WorkflowCreateInput {
  name: string;
  description?: string;
  variables?: WorkflowCreateVariableInput[];
  steps: WorkflowCreateStepInput[];
}

/** `workflow_create` 的返回。`errors` 会原样喂回 AI，让它自己改正后重试。 */
export interface WorkflowCreateResult {
  success: boolean;
  workflowId?: string;
  /** 校验失败的具体原因，逐条中文。AI 靠它自我修正。 */
  errors?: string[];
}

/**
 * AI 提交的修改。
 *
 * 只能整体替换步骤列表，不做「插入第 3 步」这类增量操作：增量语义要求 AI 和实现对
 * 「第几步」的理解完全一致，而 AI 手里只有 `workflow_get_info` 给的节点名列表，
 * 一旦错位就是改错节点。整体替换的语义是明确的 —— AI 先读摘要，再交出完整的新版本。
 *
 * `steps` 省略即表示不动步骤（只改名字/说明/入参）。
 */
export interface WorkflowUpdateInput {
  workflowId: string;
  name?: string;
  description?: string;
  variables?: WorkflowCreateVariableInput[];
  steps?: WorkflowCreateStepInput[];
}

export interface WorkflowUpdateResult {
  success: boolean;
  workflowId?: string;
  errors?: string[];
}
