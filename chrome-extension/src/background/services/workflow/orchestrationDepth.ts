/**
 * 编排深度守卫 —— 拦住「工作流 ↔ AI」互相调用形成的无界递归。
 *
 * `WorkflowExecutor` 自己有 `_subflowStack`（环检测 + 8 层上限），但它只看得见
 * **同一次 execute() 调用链里的 subflow 节点**。真正危险的那条链它追不到：
 *
 *   工作流 A 的 ai 节点 → 起一个新 Executor（完整 Planner/Navigator 管线）
 *     → AI 决定调 workflow_invoke → 又进 WorkflowExecutor.execute()
 *       → 里面又有 ai 节点 → 再起一个 Executor → ...
 *
 * 每跨一次边界就是一个全新的 `WorkflowExecutionContext`，`_subflowStack` 从空开始，
 * 所以这条链既不会被环检测发现、也不受 8 层上限约束。而它每一层都在真实烧钱：
 * 一个带 loop 的工作流套 ai 节点，几分钟就能把用户的 API 额度打空。
 *
 * 所以这里维护一条**跨边界的显式调用链**，由 background 手动往下传：
 * `handleExecuteWorkflow` 收到 depth → 它构造的 aiInvoker 用 depth+1 起 Executor
 * → 那个 Executor 的 workflow_invoke 再用 depth+1 回调 handleExecuteWorkflow。
 *
 * 链上带 id 而不只是计数，是为了能同时做环检测：AI 被工作流 A 唤起后又去调 A
 * 是很自然的失误（提示词里刚描述过 A），计数上可能还没到顶，但语义上已经是死循环。
 */

/** 编排链上的一帧。`ai` 帧只用于生成可读的错误信息，不参与上限计算。 */
export interface OrchestrationFrame {
  kind: 'workflow' | 'ai';
  /** workflow 帧是工作流 id；ai 帧是所属工作流的节点名或 id。 */
  id: string;
}

/**
 * 一条编排链上最多能嵌套几层工作流。
 *
 * 取 3 而不是复用 subflow 的 8：跨边界的每一层都要起完整的 Planner/Navigator 管线
 * （多轮 LLM 往返 + 页面截图），成本比 subflow 递归高一个量级。真实场景里
 * 「工作流 → AI → 工作流」两层已经够用，第三层留作余量。
 */
export const MAX_ORCHESTRATION_DEPTH = 3;

export interface OrchestrationGuardOk {
  ok: true;
  /** 加上新帧后的链，调用方需要把它继续往下传。 */
  stack: OrchestrationFrame[];
}

export interface OrchestrationGuardBlocked {
  ok: false;
  /** 面向用户/AI 的中文错误信息，含完整调用链，便于定位是哪一环失控。 */
  error: string;
}

export type OrchestrationGuardResult = OrchestrationGuardOk | OrchestrationGuardBlocked;

/** 把链渲染成 `A → (AI:读取总额) → B` 形式，用在错误信息里。 */
export function formatOrchestrationChain(stack: readonly OrchestrationFrame[]): string {
  return stack.map(f => (f.kind === 'ai' ? `(AI:${f.id})` : f.id)).join(' → ');
}

/** 链上已经嵌套了几层工作流。ai 帧不计入 —— 它是过程，不是嵌套层级。 */
export function countWorkflowFrames(stack: readonly OrchestrationFrame[]): number {
  return stack.filter(f => f.kind === 'workflow').length;
}

/**
 * 判断能否再往编排链上压一帧。
 *
 * @param stack 当前链（顶层调用传 `[]` 或不传）
 * @param next  想要进入的下一帧
 */
export function guardOrchestration(
  stack: readonly OrchestrationFrame[] | undefined,
  next: OrchestrationFrame,
): OrchestrationGuardResult {
  const current = stack ?? [];
  const chain = [...current, next];

  // 环检测只针对 workflow 帧：同一个工作流在链上出现两次，无论中间隔了几层 AI，
  // 都是死循环。ai 帧的 id 是节点名，不同工作流里重名很正常，不能当环。
  if (next.kind === 'workflow' && current.some(f => f.kind === 'workflow' && f.id === next.id)) {
    return {
      ok: false,
      error: `检测到工作流循环调用：${formatOrchestrationChain(chain)}`,
    };
  }

  if (countWorkflowFrames(chain) > MAX_ORCHESTRATION_DEPTH) {
    return {
      ok: false,
      error: `工作流嵌套深度超过 ${MAX_ORCHESTRATION_DEPTH} 层，已中止：${formatOrchestrationChain(chain)}`,
    };
  }

  return { ok: true, stack: chain };
}
