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
    version: workflow.version,
    category: workflow.category as Skill['category'],
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

  // Handle condition nodes with branches
  if (currentNode.type === 'condition') {
    // Create condition structure with thenSteps and elseSteps
    const thenSteps: SkillStep[] = [];
    const elseSteps: SkillStep[] = [];

    const trueNodeId = currentNode.data.trueNodeId;
    const falseNodeId = currentNode.data.falseNodeId;

    if (trueNodeId) {
      const trueNode = workflow.nodes.find(n => n.id === trueNodeId);
      if (trueNode) {
        traverseBranch(workflow, trueNode, thenSteps, new Set<string>());
      }
    }

    if (falseNodeId) {
      const falseNode = workflow.nodes.find(n => n.id === falseNodeId);
      if (falseNode) {
        traverseBranch(workflow, falseNode, elseSteps, new Set<string>());
      }
    }

    // Add condition to step
    step.condition = {
      type: 'if',
      expression: currentNode.data.conditionExpression || '',
      thenSteps,
      elseSteps,
    };

    steps.push(step);

    // Continue from merge point (simplified - after both branches)
    // In real workflow, we'd need to find the merge point
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
      // AI module becomes a special action or uses AI invocation
      return {
        id: stepId,
        action: 'ai_invoke', // Custom action for AI
        description: node.data.prompt || node.name,
        parameters: {
          prompt: node.data.prompt,
          modelConfig: node.data.modelConfig,
          outputVariable: node.data.outputVariable,
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
          expression: node.data.conditionExpression,
          evaluateWithAI: node.data.evaluateWithAI,
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
