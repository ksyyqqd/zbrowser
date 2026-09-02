import {
  stepsToWorkflow,
  StepsToWorkflowError,
  type WorkflowStepSpec,
  type WorkflowVariable,
} from '@extension/workflow';
import { userWorkflowsStore } from '@extension/storage';
import { WORKFLOW_AUTOMATION_ACTIONS } from './supportedActions';
import type { WorkflowUpdateInput, WorkflowUpdateResult } from './types';

/**
 * AI 修改已有工作流。
 *
 * 与创建共享同一套校验（`stepsToWorkflow`），差别在三点：
 *
 *  1. **id 保持不变**。修改的语义就是「还是那个工作流」——书签、快速执行入口都按 id
 *     记录，换 id 等于把用户的入口指向空气。
 *  2. **改完退回未确认**（`reviewed: false`）。这是这个动作唯一的安全网：工作流没有
 *     版本历史，AI 覆盖掉用户手工调过的图是不可逆的，所以至少要保证被改过的图在用户
 *     重新看过之前不会被执行。用户在编辑器里确认后才恢复可执行。
 *  3. **只整体替换步骤**，不做「插入第 3 步」这类增量操作 —— 见 `WorkflowUpdateInput`。
 *
 * 已知局限：没有 undo。用户唯一的补救手段是在编辑器里看到改动后手工调回来，或者
 * 直接删掉。真要做可靠的回退需要在存储层留一份修改前快照，那是另一个改动。
 */

/**
 * 单轮任务里 AI 最多能改几次工作流。
 *
 * 和创建的上限分开计：这两件事的失控方式不一样。创建失控是往列表里灌垃圾，
 * 修改失控是对同一个工作流反复重写 —— 每次都把它推回未确认状态，用户越确认越多。
 */
export const MAX_WORKFLOW_UPDATES_PER_TASK = 5;

function toStepSpec(step: NonNullable<WorkflowUpdateInput['steps']>[number]): WorkflowStepSpec {
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

function toVariables(input: NonNullable<WorkflowUpdateInput['variables']>): WorkflowVariable[] {
  return input.map(v => ({
    name: v.name,
    type: v.type ?? 'string',
    required: v.required ?? false,
    description: v.description,
    default: v.default === undefined ? undefined : coerceDefault(v.default, v.type ?? 'string'),
  }));
}

/**
 * 校验 + 落库。
 *
 * @param updatedCount 本轮任务已修改的次数，由调用方维护（AgentContext 上）
 */
export async function updateWorkflowFromAI(
  input: WorkflowUpdateInput,
  updatedCount: number,
): Promise<WorkflowUpdateResult> {
  if (updatedCount >= MAX_WORKFLOW_UPDATES_PER_TASK) {
    return {
      success: false,
      errors: [
        `本轮任务已修改 ${updatedCount} 次工作流，达到上限 ${MAX_WORKFLOW_UPDATES_PER_TASK}。` +
          `不要再改了，请告诉用户当前的结果，让他们在编辑器里确认。`,
      ],
    };
  }

  const existing = await userWorkflowsStore.getWorkflow(input.workflowId);
  if (!existing) {
    return { success: false, errors: [`工作流不存在: ${input.workflowId}`] };
  }

  // 没给任何要改的东西时直接拒绝，而不是「成功但什么都没变」——后者会让 AI 以为
  // 自己已经完成了用户的要求。
  if (
    input.name === undefined &&
    input.description === undefined &&
    input.variables === undefined &&
    input.steps === undefined
  ) {
    return {
      success: false,
      errors: ['没有提供任何要修改的内容（name / description / variables / steps 至少给一个）'],
    };
  }

  const name = input.name?.trim() || existing.name;
  const description = input.description === undefined ? existing.description : input.description.trim();
  const variables = input.variables === undefined ? (existing.variables ?? []) : toVariables(input.variables);

  // 只改元信息（名字/说明/入参）时不重建图：重建会重排坐标，把用户在画布上摆好的
  // 布局抹掉，而这次改动根本没碰节点。
  if (input.steps === undefined) {
    try {
      await userWorkflowsStore.updateWorkflow(existing.id, {
        name,
        description,
        variables,
        reviewed: false,
      });
    } catch (error) {
      return { success: false, errors: [error instanceof Error ? error.message : '保存工作流失败'] };
    }
    return { success: true, workflowId: existing.id };
  }

  let rebuilt;
  try {
    rebuilt = stepsToWorkflow(
      {
        name,
        description,
        version: existing.version,
        variables,
        steps: input.steps.map(toStepSpec),
      },
      // id 必须显式传原 id，否则 stepsToWorkflow 会按新名字重新派生
      { id: existing.id, allowedActions: WORKFLOW_AUTOMATION_ACTIONS },
    );
  } catch (error) {
    if (error instanceof StepsToWorkflowError) {
      return { success: false, errors: error.errors };
    }
    return { success: false, errors: [error instanceof Error ? error.message : '生成工作流失败'] };
  }

  try {
    await userWorkflowsStore.updateWorkflow(existing.id, {
      name: rebuilt.name,
      description: rebuilt.description,
      nodes: rebuilt.nodes,
      edges: rebuilt.edges,
      variables: rebuilt.variables,
      executionConfig: rebuilt.executionConfig,
      // 关键：改过的图退回未确认，用户重新看过才能再执行
      reviewed: false,
    });
  } catch (error) {
    return { success: false, errors: [error instanceof Error ? error.message : '保存工作流失败'] };
  }

  return { success: true, workflowId: existing.id };
}
