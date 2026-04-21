import type { Skill, SkillStep, SkillParameter, StepCondition } from '@extension/skills';
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowVariable,
  WorkflowCategory,
  NodeData,
  NodePosition,
} from '../types';

/**
 * Convert Skill to Workflow
 * Each SkillStep becomes an Automation node (or Condition node if it has conditions)
 */
export function convertSkillToWorkflow(skill: Skill): Workflow {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const variables: WorkflowVariable[] = [];

  // Convert Skill parameters to Workflow variables
  for (const param of skill.parameters) {
    variables.push({
      name: param.name,
      type: param.type,
      description: param.description,
      required: param.required,
      default: param.default,
    });
  }

  // Create start node
  const startNode: WorkflowNode = {
    id: 'start',
    type: 'start',
    name: 'Start',
    position: { x: 0, y: 0 },
    data: {},
  };
  nodes.push(startNode);

  // Track last node ID for edge creation
  let lastNodeId = 'start';
  let yOffset = 100;

  // Convert each SkillStep
  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i];
    const nodeId = `step-${i}`;

    // Check if step has condition
    if (step.condition) {
      // Create condition node
      const conditionNode = createConditionNode(step, nodeId, yOffset);
      nodes.push(conditionNode);

      // Edge from last node to condition node
      edges.push({
        id: `edge-${lastNodeId}-${nodeId}`,
        source: lastNodeId,
        target: nodeId,
      });

      // Process thenSteps
      if (step.condition.thenSteps && step.condition.thenSteps.length > 0) {
        const thenNodeIds = processConditionSteps(step.condition.thenSteps, nodes, edges, nodeId, 'true', yOffset);
        lastNodeId = thenNodeIds[thenNodeIds.length - 1];
      }

      // Process elseSteps
      if (step.condition.elseSteps && step.condition.elseSteps.length > 0) {
        const elseNodeIds = processConditionSteps(
          step.condition.elseSteps,
          nodes,
          edges,
          nodeId,
          'false',
          yOffset + 100,
        );
        // Connect else branch back to main flow
        // Note: This is simplified - real workflow would merge back
      }

      yOffset += 200;
    } else {
      // Create automation node
      const automationNode: WorkflowNode = {
        id: nodeId,
        type: 'automation',
        name: step.description || step.action,
        description: step.description,
        position: { x: 0, y: yOffset },
        data: {
          action: step.action,
          parameters: step.parameters,
          delayAfter: step.delay,
        },
      };
      nodes.push(automationNode);

      // Edge from last node to this node
      edges.push({
        id: `edge-${lastNodeId}-${nodeId}`,
        source: lastNodeId,
        target: nodeId,
      });

      lastNodeId = nodeId;
      yOffset += 100;
    }
  }

  // Create end node
  const endNode: WorkflowNode = {
    id: 'end',
    type: 'end',
    name: 'End',
    position: { x: 0, y: yOffset },
    data: {},
  };
  nodes.push(endNode);

  // Edge from last node to end
  edges.push({
    id: `edge-${lastNodeId}-end`,
    source: lastNodeId,
    target: 'end',
  });

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    category: mapSkillCategoryToWorkflow(skill.category),
    nodes,
    edges,
    variables,
    executionConfig: {
      onError: 'stop',
    },
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

/**
 * Create condition node from SkillStep with condition
 */
function createConditionNode(step: SkillStep, nodeId: string, yOffset: number): WorkflowNode {
  const condition = step.condition!;
  const conditionExpression = condition.expression;

  // Determine true and false node IDs
  const trueNodeId =
    condition.thenSteps && condition.thenSteps.length > 0
      ? `${nodeId}-then-0`
      : `step-${parseInt(nodeId.split('-')[1]) + 1}`;

  const falseNodeId =
    condition.elseSteps && condition.elseSteps.length > 0
      ? `${nodeId}-else-0`
      : `step-${parseInt(nodeId.split('-')[1]) + 1}`;

  return {
    id: nodeId,
    type: 'condition',
    name: `Condition: ${conditionExpression.slice(0, 30)}...`,
    position: { x: 0, y: yOffset },
    data: {
      conditionExpression,
      trueNodeId,
      falseNodeId,
      evaluateWithAI: true, // Default to AI evaluation for Skill conditions
    },
  };
}

/**
 * Process condition branch steps (thenSteps or elseSteps)
 */
function processConditionSteps(
  steps: SkillStep[],
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  conditionNodeId: string,
  branch: 'true' | 'false',
  yOffset: number,
): string[] {
  const nodeIds: string[] = [];
  let lastNodeId = conditionNodeId;
  let localYOffset = yOffset;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = `${conditionNodeId}-${branch}-${i}`;

    const automationNode: WorkflowNode = {
      id: nodeId,
      type: 'automation',
      name: step.description || step.action,
      description: step.description,
      position: { x: branch === 'true' ? 0 : 300, y: localYOffset },
      data: {
        action: step.action,
        parameters: step.parameters,
        delayAfter: step.delay,
      },
    };
    nodes.push(automationNode);
    nodeIds.push(nodeId);

    // Edge from last node to this node
    edges.push({
      id: `edge-${lastNodeId}-${nodeId}`,
      source: lastNodeId,
      target: nodeId,
      condition: branch,
    });

    lastNodeId = nodeId;
    localYOffset += 100;
  }

  return nodeIds;
}

/**
 * Map Skill category to Workflow category
 */
function mapSkillCategoryToWorkflow(category: string): WorkflowCategory {
  const validCategories: WorkflowCategory[] = [
    'navigation',
    'data-extraction',
    'form-interaction',
    'analysis',
    'automation',
    'custom',
  ];
  if (validCategories.includes(category as WorkflowCategory)) {
    return category as WorkflowCategory;
  }
  return 'custom';
}
