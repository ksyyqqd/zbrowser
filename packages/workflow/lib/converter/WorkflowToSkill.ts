import type { Skill, SkillStep, SkillParameter } from '@extension/skills';
import type { Workflow, WorkflowNode } from '../types';

/**
 * Convert Workflow to Skill
 * Traverse workflow nodes in execution order and create SkillSteps
 */
export function convertWorkflowToSkill(workflow: Workflow): Skill {
  const steps: SkillStep[] = [];

  // Traverse workflow graph in execution order
  const visitedNodes = new Set<string>();
  const startNode = workflow.nodes.find(n => n.type === 'start');

  if (startNode) {
    traverseWorkflow(workflow, startNode, steps, visitedNodes);
  }

  // Convert Workflow variables to Skill parameters
  const parameters: SkillParameter[] = workflow.variables.map(v => ({
    name: v.name,
    type: v.type as 'string' | 'number' | 'boolean' | 'array' | 'object',
    description: v.description || '',
    required: v.required ?? false,
    default: v.default,
  }));

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    // 通用文本格式的正文：把节点序列渲染成人类可读的编号清单。
    // steps 同时保留，因为 SkillToWorkflow 反向转换要靠它还原节点。
    instructions: renderStepsAsInstructions(steps),
    version: workflow.version,
    category: 'custom', // Default category for workflow-generated skills
    author: 'workflow-converter',
    tags: [],
    parameters,
    steps,
    executionMode: 'expanded',
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

/**
 * 把步骤渲染成 skill 正文。带上 selector/xpath/url 等定位信息——
 * 只写描述的话，LLM 拿到正文根本不知道该点页面上的哪个元素。
 */
function renderStepsAsInstructions(steps: SkillStep[], depth = 0): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    lines.push(`${indent}${i + 1}. ${step.description?.trim() || step.action}`);

    const detail: string[] = [];
    for (const key of ['url', 'selector', 'xpath', 'text'] as const) {
      const v = step.parameters?.[key];
      if (typeof v === 'string' && v) detail.push(`${key}=${v}`);
    }
    if (detail.length) lines.push(`${indent}   （${detail.join('，')}）`);

    // 条件分支要展开，否则正文里会缺掉整条支路
    const cond = step.condition;
    if (cond) {
      lines.push(`${indent}   判断：${cond.expression}`);
      if (cond.thenSteps?.length) {
        lines.push(`${indent}   若成立：`);
        lines.push(renderStepsAsInstructions(cond.thenSteps, depth + 2));
      }
      if (cond.elseSteps?.length) {
        lines.push(`${indent}   否则：`);
        lines.push(renderStepsAsInstructions(cond.elseSteps, depth + 2));
      }
      for (const branch of cond.branches ?? []) {
        lines.push(`${indent}   分支「${branch.name}」：`);
        lines.push(renderStepsAsInstructions(branch.steps, depth + 2));
      }
    }
  }

  return lines.filter(Boolean).join('\n');
}

/**
 * Traverse workflow nodes and convert to SkillSteps
 */
function traverseWorkflow(
  workflow: Workflow,
  currentNode: WorkflowNode,
  steps: SkillStep[],
  visitedNodes: Set<string>,
): void {
  // Skip if already visited (avoid cycles)
  if (visitedNodes.has(currentNode.id)) {
    return;
  }
  visitedNodes.add(currentNode.id);

  // Skip start and end nodes
  if (currentNode.type === 'start' || currentNode.type === 'end') {
    // Find next node
    const nextNode = findNextNode(workflow, currentNode.id);
    if (nextNode) {
      traverseWorkflow(workflow, nextNode, steps, visitedNodes);
    }
    return;
  }

  // Convert node to SkillStep
  const step = convertNodeToStep(currentNode, workflow);

  // Handle condition nodes with dynamic branches
  if (currentNode.type === 'condition') {
    const branches = currentNode.data.branches || [];
    const branchStepsMap: Record<string, SkillStep[]> = {};

    // Find edges originating from this condition node
    const conditionEdges = workflow.edges.filter(e => e.source === currentNode.id);

    for (const branch of branches) {
      const branchSteps: SkillStep[] = [];
      // Find the edge for this branch (by sourcePort matching branch.id)
      const branchEdge = conditionEdges.find(e => e.sourcePort === branch.id || e.condition === branch.id);
      if (branchEdge) {
        const targetNode = workflow.nodes.find(n => n.id === branchEdge.target);
        if (targetNode) {
          traverseBranch(workflow, targetNode, branchSteps, new Set<string>());
        }
      }
      branchStepsMap[branch.id] = branchSteps;
    }

    // Legacy fallback: if no branches defined, use trueNodeId/falseNodeId
    if (branches.length === 0) {
      const thenSteps: SkillStep[] = [];
      const elseSteps: SkillStep[] = [];

      const trueNodeId = currentNode.data.trueNodeId;
      const falseNodeId = currentNode.data.falseNodeId;

      if (trueNodeId) {
        const trueNode = workflow.nodes.find(n => n.id === trueNodeId);
        if (trueNode) traverseBranch(workflow, trueNode, thenSteps, new Set<string>());
      }
      if (falseNodeId) {
        const falseNode = workflow.nodes.find(n => n.id === falseNodeId);
        if (falseNode) traverseBranch(workflow, falseNode, elseSteps, new Set<string>());
      }

      // Legacy 2-branch condition
      step.condition = {
        type: 'if',
        expression: currentNode.data.prompt || currentNode.data.conditionExpression || '',
        thenSteps,
        elseSteps,
      };
    } else {
      // New multi-branch condition
      step.condition = {
        type: 'switch',
        expression: currentNode.data.prompt || currentNode.data.conditionExpression || '',
        branches: branches.map(b => ({
          name: b.name,
          steps: branchStepsMap[b.id] || [],
        })),
      };
    }

    steps.push(step);
    return;
  }

  // Add step to array
  steps.push(step);

  // Find and traverse next node
  const nextNode = findNextNode(workflow, currentNode.id);
  if (nextNode) {
    traverseWorkflow(workflow, nextNode, steps, visitedNodes);
  }
}

/**
 * Traverse a branch for condition node
 */
function traverseBranch(workflow: Workflow, startNode: WorkflowNode, steps: SkillStep[], visited: Set<string>): void {
  if (visited.has(startNode.id) || startNode.type === 'end') {
    return;
  }
  visited.add(startNode.id);

  // Convert node to step
  const step = convertNodeToStep(startNode, workflow);

  // Don't process nested conditions recursively for simplicity
  if (startNode.type !== 'condition') {
    steps.push(step);
  }

  // Continue traversal
  const nextNode = findNextNode(workflow, startNode.id);
  if (nextNode) {
    traverseBranch(workflow, nextNode, steps, visited);
  }
}

/**
 * Convert WorkflowNode to SkillStep
 */
function convertNodeToStep(node: WorkflowNode, workflow: Workflow): SkillStep {
  const stepId = `step-${node.id}`;

  switch (node.type) {
    case 'ai':
      return {
        id: stepId,
        action: 'ai_invoke',
        description: node.data.prompt || node.name,
        parameters: {
          prompt: node.data.prompt,
          outputVariable: node.data.outputVariable,
          contextVariables: node.data.contextVariables,
        },
        onError: workflow.executionConfig.onError,
      };

    case 'automation':
      return {
        id: stepId,
        action: node.data.action || 'wait',
        description: node.name,
        parameters: node.data.parameters || {},
        onError: workflow.executionConfig.onError,
        delay: node.data.delayAfter,
      };

    case 'condition':
      return {
        id: stepId,
        action: 'condition_check',
        description: node.name,
        parameters: {
          expression: node.data.prompt || node.data.conditionExpression,
          evaluateWithAI: node.data.evaluateWithAI ?? true,
          branches: node.data.branches || [],
        },
        onError: workflow.executionConfig.onError,
      };

    default:
      return {
        id: stepId,
        action: 'wait',
        description: node.name,
        parameters: {},
        onError: workflow.executionConfig.onError,
      };
  }
}

/**
 * Find next node after given node ID
 */
function findNextNode(workflow: Workflow, nodeId: string): WorkflowNode | undefined {
  // For condition nodes, we don't follow edges directly
  const node = workflow.nodes.find(n => n.id === nodeId);
  if (node?.type === 'condition') {
    return undefined; // Branches are handled separately
  }

  const edge = workflow.edges.find(e => e.source === nodeId);
  if (!edge) return undefined;
  return workflow.nodes.find(n => n.id === edge.target);
}
