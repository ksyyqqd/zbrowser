import {
  stepsToWorkflow,
  StepsToWorkflowError,
  type WorkflowStepSpec,
  type WorkflowVariable,
} from '@extension/workflow';
import { userWorkflowsStore, type UserWorkflowConfig } from '@extension/storage';
import { WORKFLOW_AUTOMATION_ACTIONS } from './supportedActions';
import type { WorkflowCreateInput, WorkflowCreateResult } from './types';

/**
 * AI 创建工作流。
 *
 * 三条约束，都是「AI 产出不可信」的直接推论：
 *
 *  1. **存为未确认**（`reviewed: false`）。AI 生成的图没有任何人验证过，直接可执行
 *     等于让未经审核的脚本操作用户的浏览器。执行入口会拦掉它（见 background 的
 *     `handleExecuteWorkflow`），要用户在编辑器里过一遍。
 *  2. **每轮任务有创建上限**。AI 卡在某个环节时会反复尝试「换个方式再建一个」，
 *     没有上限就是往用户的工作流列表里灌垃圾。
 *  3. **绝不覆盖已有工作流**。`userWorkflowsStore.addWorkflow` 是按 id 覆盖写入的，
 *     而 id 由名字 slug 化而来 —— AI 用一个和已有工作流同名的名字创建，就会静默
 *     replace 掉用户手工调过的那个。撞 id 时换一个带后缀的，永远只「多一条」。
 */

/**
 * 单轮任务里 AI 最多能创建几个工作流。
 *
 * 取 5 是因为正常场景下一轮对话建一两个就够了；到 5 基本可以断定 AI 在打转，
 * 再放开只会让用户回头清理。
 */
export const MAX_WORKFLOW_CREATES_PER_TASK = 5;

/** 把 AI 的 snake_case 步骤转成 `stepsToWorkflow` 的形状。 */
function toStepSpec(step: WorkflowCreateInput['steps'][number]): WorkflowStepSpec {
  return {
    kind: step.kind,
    name: step.name,
    description: step.description,
    action: step.action,
    parameters: step.parameters,
    prompt: step.prompt,
    outputVariable: step.output_variable,
    content: step.content,
  };
}

function toVariables(input: WorkflowCreateInput): WorkflowVariable[] {
  return (input.variables ?? []).map(v => ({
    name: v.name,
    type: v.type ?? 'string',
    required: v.required ?? false,
    description: v.description,
    // AI 只能给字符串默认值（schema 限制），数字/布尔在这里转回去，
    // 否则 number 类型的变量会拿到 "3" 这样的字符串默认值
    default: v.default === undefined ? undefined : coerceDefault(v.default, v.type ?? 'string'),
  }));
}

function coerceDefault(raw: string, type: 'string' | 'number' | 'boolean'): unknown {
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === 'boolean') {
    return raw === 'true';
  }
  return raw;
}

/**
 * 生成一个不与已有工作流冲突的 id。
 *
 * 不复用 `deriveWorkflowId` 的结果直接写：那个函数不知道 store 里有什么，
 * 而这里的语义是「新增」，撞了必须换。
 */
async function allocateUniqueId(preferred: string): Promise<string> {
  const existing = await userWorkflowsStore.getAllWorkflows();
  const taken = new Set(existing.map(w => w.id));
  if (!taken.has(preferred)) {
    return preferred;
  }
  return `${preferred}-${Date.now().toString(36)}`;
}

/**
 * 校验 + 落库。
 *
 * @param createdCount 本轮任务已创建的数量，由调用方维护（AgentContext 上）
 */
export async function createWorkflowFromAI(
  input: WorkflowCreateInput,
  createdCount: number,
): Promise<WorkflowCreateResult> {
  if (createdCount >= MAX_WORKFLOW_CREATES_PER_TASK) {
    return {
      success: false,
      errors: [
        `本轮任务已创建 ${createdCount} 个工作流，达到上限 ${MAX_WORKFLOW_CREATES_PER_TASK}。` +
          `不要再创建了，请直接告诉用户已创建的工作流，让他们在设置页确认。`,
      ],
    };
  }

  let workflow;
  try {
    workflow = stepsToWorkflow(
      {
        name: input.name,
        description: input.description,
        variables: toVariables(input),
        steps: input.steps.map(toStepSpec),
      },
      { allowedActions: WORKFLOW_AUTOMATION_ACTIONS },
    );
  } catch (error) {
    if (error instanceof StepsToWorkflowError) {
      // 逐条错误原样返回，AI 据此自我修正后重试
      return { success: false, errors: error.errors };
    }
    return { success: false, errors: [error instanceof Error ? error.message : '生成工作流失败'] };
  }

  const id = await allocateUniqueId(workflow.id);

  const config: UserWorkflowConfig = {
    ...workflow,
    id,
    // `Workflow.createdAt` 是可选的（画布上的草稿可能还没存过），而存储态要求必填
    createdAt: workflow.createdAt ?? Date.now(),
    source: 'ai_created',
    // 关键：AI 建的工作流默认不可执行，等用户在编辑器里确认
    reviewed: false,
  };

  try {
    await userWorkflowsStore.addWorkflow(config);
  } catch (error) {
    return { success: false, errors: [error instanceof Error ? error.message : '保存工作流失败'] };
  }

  return { success: true, workflowId: id };
}
