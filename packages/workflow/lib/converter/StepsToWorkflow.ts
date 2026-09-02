import type { Workflow, WorkflowEdge, WorkflowNode, WorkflowVariable } from '../types';

/**
 * 线性步骤 → 工作流图。
 *
 * 存在的理由：`Workflow` 是给画布用的结构，节点带 `position: {x, y}`、边要手写
 * `{id, source, target}` 数组。让 LLM 直接产出它是在浪费能力——坐标它算不准（生成的
 * 节点会重叠），边它会漏、id 会写错，而这两样都是纯机械推导得出的。
 *
 * 所以 AI 只需要产出一条**线性步骤列表**（`WorkflowStepSpec[]`），由这里补 start/end、
 * 串边、算坐标。分支（condition）和循环（loop）不在 AI 的输出范围内：那需要它同时
 * 想清楚拓扑和布局，第一版不做，用户在编辑器里自己加。
 *
 * 布局常量与 `SkillToWorkflow` 保持一致，否则两条来路生成的工作流在画布上疏密不同，
 * 看起来像两个功能。
 */

const NODE_WIDTH = 180;
const START_END_SIZE = 50;
const HORIZONTAL_SPACING = 200;
const BASE_X = 100;
const BASE_Y = 200;

/** AI 可以产出的节点种类。刻意不含 condition / loop / subflow / note —— 见文件头注释。 */
export type WorkflowStepKind = 'automation' | 'ai' | 'output';

/**
 * 单个线性步骤。字段按 kind 区分必填项，校验见 `validateStepSpecs`。
 */
export interface WorkflowStepSpec {
  kind: WorkflowStepKind;
  /** 节点显示名。空时回退到 action / kind，保证画布上不出现无名节点。 */
  name?: string;
  description?: string;

  // kind === 'automation'
  /** 浏览器动作名，必须是运行时真实注册过的 action。 */
  action?: string;
  parameters?: Record<string, unknown>;
  delayAfter?: number;

  // kind === 'ai'
  prompt?: string;
  /** AI 节点的产出变量名，后续步骤用 {{name}} 引用。 */
  outputVariable?: string;

  // kind === 'output'
  /** 输出模板，支持 {{变量名}} 插值。 */
  content?: string;
  label?: string;
}

export interface StepsToWorkflowInput {
  name: string;
  description?: string;
  version?: string;
  variables?: WorkflowVariable[];
  steps: WorkflowStepSpec[];
}

export interface StepsToWorkflowOptions {
  /** 工作流 id。不传则由名字派生（见 `deriveWorkflowId`）。 */
  id?: string;
  /**
   * 允许的 automation action 白名单。
   *
   * 强烈建议传：LLM 很擅长编出 `click_button`、`fill_form` 这类听起来合理但并不存在
   * 的动作名，而这种工作流要等到真正执行时才报错，届时用户已经存下并信任它了。
   * 动作注册表在 chrome-extension 侧，所以这里作为参数注入而不是硬编码。
   */
  allowedActions?: readonly string[];
}

export class StepsToWorkflowError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'StepsToWorkflowError';
  }
}

/**
 * 校验 AI 产出的步骤列表。
 *
 * 与 `validateWorkflowStructure` 的分工：那个查图的拓扑（start/end 是否存在、边是否
 * 悬空、start 能否到达 end），而这些在本函数生成的图里天然成立。这里查的是**语义**：
 * 动作名是否真实存在、AI 节点有没有 prompt、变量名能不能用在 {{}} 里。
 */
export function validateStepSpecs(input: StepsToWorkflowInput, allowedActions?: readonly string[]): string[] {
  const errors: string[] = [];

  if (!input.name?.trim()) {
    errors.push('工作流缺少 name');
  }

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    errors.push('工作流至少需要一个步骤');
    return errors;
  }

  for (const variable of input.variables ?? []) {
    // 变量要能出现在 {{name}} 模板里，含空格或大括号会让插值解析出错
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name ?? '')) {
      errors.push(`变量名 "${variable.name}" 不合法：只允许字母、数字、下划线，且不能以数字开头`);
    }
  }

  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];
    const at = `步骤 ${i + 1}`;

    switch (step.kind) {
      case 'automation': {
        const action = step.action?.trim();
        if (!action) {
          errors.push(`${at}（automation）缺少 action`);
          break;
        }
        if (allowedActions && !allowedActions.includes(action)) {
          errors.push(`${at} 的 action "${action}" 不是可用动作`);
        }
        break;
      }
      case 'ai': {
        if (!step.prompt?.trim()) {
          errors.push(`${at}（ai）缺少 prompt`);
        }
        if (step.outputVariable && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(step.outputVariable)) {
          errors.push(`${at} 的 outputVariable "${step.outputVariable}" 不合法`);
        }
        break;
      }
      case 'output': {
        if (!step.content?.trim()) {
          errors.push(`${at}（output）缺少 content`);
        }
        break;
      }
      default:
        errors.push(
          `${at} 的 kind "${String((step as WorkflowStepSpec).kind)}" 不支持，只能是 automation / ai / output`,
        );
    }
  }

  return errors;
}

/**
 * 把线性步骤铺成带布局的工作流图。校验不通过时抛 `StepsToWorkflowError`。
 */
export function stepsToWorkflow(input: StepsToWorkflowInput, options: StepsToWorkflowOptions = {}): Workflow {
  const errors = validateStepSpecs(input, options.allowedActions);
  if (errors.length > 0) {
    throw new StepsToWorkflowError(errors);
  }

  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  let x = BASE_X;
  nodes.push({
    id: 'start',
    type: 'start',
    name: 'Start',
    position: { x, y: BASE_Y },
    data: {},
  });

  x += HORIZONTAL_SPACING + START_END_SIZE / 2;
  let previousId = 'start';

  for (let i = 0; i < input.steps.length; i++) {
    const step = input.steps[i];
    const id = `step-${i}`;
    nodes.push({
      id,
      type: step.kind,
      name: stepName(step),
      description: step.description,
      position: { x, y: BASE_Y },
      data: stepData(step),
    });
    edges.push({
      id: `edge-${previousId}-${id}`,
      source: previousId,
      target: id,
      marker: 'block',
    });

    previousId = id;
    x += HORIZONTAL_SPACING + NODE_WIDTH;
  }

  nodes.push({
    id: 'end',
    type: 'end',
    name: 'End',
    position: { x, y: BASE_Y },
    data: {},
  });
  edges.push({
    id: `edge-${previousId}-end`,
    source: previousId,
    target: 'end',
    marker: 'block',
  });

  const now = Date.now();
  return {
    id: options.id?.trim() || deriveWorkflowId(input.name),
    name: input.name.trim(),
    description: input.description?.trim() || '',
    version: input.version?.trim() || '1.0.0',
    nodes,
    edges,
    variables: input.variables ?? [],
    executionConfig: {
      // stop 而非 continue：AI 生成的流程没人逐节点验证过，出错继续跑只会把
      // 后面的步骤建立在错误状态上，更难排查。
      onError: 'stop',
    },
    createdAt: now,
    updatedAt: now,
  };
}

function stepName(step: WorkflowStepSpec): string {
  return step.name?.trim() || step.action?.trim() || step.label?.trim() || step.kind;
}

function stepData(step: WorkflowStepSpec): WorkflowNode['data'] {
  const name = stepName(step);

  switch (step.kind) {
    case 'automation':
      return {
        name,
        action: step.action!.trim(),
        intent: step.description,
        parameters: step.parameters ?? {},
        delayAfter: step.delayAfter,
      };
    case 'ai':
      return {
        name,
        prompt: step.prompt!.trim(),
        outputVariable: step.outputVariable,
      };
    case 'output':
      return {
        name,
        content: step.content!.trim(),
        label: step.label,
      };
  }
}

/**
 * 由名字派生 id。中文名 slug 化后是空串，退回时间戳。
 *
 * 调用方仍需自行处理重名：`userWorkflowsStore` 按 id 覆盖写入，同名会静默替换掉
 * 已有工作流。
 */
export function deriveWorkflowId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
  return slug ? `wf-${slug}` : `wf-${Date.now().toString(36)}`;
}
