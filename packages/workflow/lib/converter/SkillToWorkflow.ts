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

// Layout constants
const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const START_END_SIZE = 50;
const HORIZONTAL_SPACING = 200;
const VERTICAL_SPACING = 100;
const BRANCH_OFFSET = 250;

/**
 * Convert Skill to Workflow
 * Each SkillStep becomes an Automation node (or Condition node if it has conditions)
 * Uses improved layout algorithm for better visual presentation
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

  // Layout state tracking
  let currentX = 100;
  let currentY = 200;
  let lastNodeId = 'start';

  // Create start node
  const startNode: WorkflowNode = {
    id: 'start',
    type: 'start',
    name: 'Start',
    position: { x: currentX, y: currentY },
    data: {},
  };
  nodes.push(startNode);

  // Move to first automation node position
  currentX += HORIZONTAL_SPACING + START_END_SIZE / 2;

  // Process steps with layout tracking
  const processedSteps = processSteps(skill.steps, nodes, edges, currentX, currentY);

  // Find the end position based on the farthest node
  const maxXNode = nodes.reduce((max, node) => (node.position.x > max.position.x ? node : max), nodes[0]);
  currentX = maxXNode.position.x + HORIZONTAL_SPACING;

  // Get the last processed node ID
  lastNodeId = processedSteps.lastNodeId;

  // Create end node
  const endNode: WorkflowNode = {
    id: 'end',
    type: 'end',
    name: 'End',
    position: { x: currentX, y: currentY },
    data: {},
  };
  nodes.push(endNode);

  // Edge from last node to end
  edges.push({
    id: `edge-${lastNodeId}-end`,
    source: lastNodeId,
    target: 'end',
    marker: 'block',
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
 * Process steps and create nodes with proper layout
 */
function processSteps(
  steps: SkillStep[],
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  startX: number,
  centerY: number,
): { lastNodeId: string; maxX: number } {
  let currentX = startX;
  let lastNodeId = 'start';
  let branchMaxX = currentX;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = `step-${i}`;

    if (step.condition) {
      // Process condition step with branching layout
      const result = processConditionStep(step, nodeId, nodes, edges, lastNodeId, currentX, centerY, i, steps.length);
      lastNodeId = result.lastNodeId;
      currentX = result.maxX + HORIZONTAL_SPACING;
      branchMaxX = Math.max(branchMaxX, result.maxX);
    } else {
      // Create automation node in main flow
      const automationNode: WorkflowNode = {
        id: nodeId,
        type: 'automation',
        name: step.description || step.action,
        description: step.description,
        position: { x: currentX, y: centerY },
        data: {
          action: step.action,
          parameters: step.parameters,
          delayAfter: step.delay,
          name: step.description || step.action,
        },
      };
      nodes.push(automationNode);

      // Edge from last node to this node
      edges.push({
        id: `edge-${lastNodeId}-${nodeId}`,
        source: lastNodeId,
        target: nodeId,
        marker: 'block',
      });

      lastNodeId = nodeId;
      currentX += HORIZONTAL_SPACING + NODE_WIDTH;
      branchMaxX = currentX;
    }
  }

  return { lastNodeId, maxX: branchMaxX };
}

/**
 * Process condition step with branching layout
 */
function processConditionStep(
  step: SkillStep,
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  lastNodeId: string,
  currentX: number,
  centerY: number,
  stepIndex: number,
  totalSteps: number,
): { lastNodeId: string; maxX: number } {
  const condition = step.condition!;

  // Create condition node at main flow position
  const conditionNode: WorkflowNode = {
    id: nodeId,
    type: 'condition',
    name: `Condition`,
    description: condition.expression,
    position: { x: currentX, y: centerY },
    data: {
      conditionExpression: condition.expression,
      evaluateWithAI: true,
    },
  };
  nodes.push(conditionNode);

  // Edge from last node to condition
  edges.push({
    id: `edge-${lastNodeId}-${nodeId}`,
    source: lastNodeId,
    target: nodeId,
    marker: 'block',
  });

  let maxX = currentX;
  let finalNodeId = nodeId;

  // Calculate branch positions
  const branchYTop = centerY - BRANCH_OFFSET / 2;
  const branchYBottom = centerY + BRANCH_OFFSET / 2;
  const branchStartX = currentX + HORIZONTAL_SPACING;

  // Process then branch (top)
  let thenLastNodeId = nodeId;
  if (condition.thenSteps && condition.thenSteps.length > 0) {
    const thenResult = processBranchSteps(
      condition.thenSteps,
      nodes,
      edges,
      nodeId,
      branchStartX,
      branchYTop,
      `${nodeId}-then`,
      'true',
    );
    thenLastNodeId = thenResult.lastNodeId;
    maxX = Math.max(maxX, thenResult.maxX);
  }

  // Process else branch (bottom)
  let elseLastNodeId = nodeId;
  if (condition.elseSteps && condition.elseSteps.length > 0) {
    const elseResult = processBranchSteps(
      condition.elseSteps,
      nodes,
      edges,
      nodeId,
      branchStartX,
      branchYBottom,
      `${nodeId}-else`,
      'false',
    );
    elseLastNodeId = elseResult.lastNodeId;
    maxX = Math.max(maxX, elseResult.maxX);
  }

  // If this is the last step, merge both branches to end
  // Otherwise, continue with the main flow
  if (stepIndex === totalSteps - 1) {
    // Both branches will connect to end node (handled by main function)
    finalNodeId = thenLastNodeId; // Use then branch as primary
    // Add merge point if both branches exist
    if (
      condition.thenSteps &&
      condition.thenSteps.length > 0 &&
      condition.elseSteps &&
      condition.elseSteps.length > 0
    ) {
      // Connect else branch to the same end (will be handled)
      // The end node connection will use the appropriate last node
    }
  } else {
    // Create a merge node to continue main flow
    const mergeX = maxX + HORIZONTAL_SPACING;
    const mergeNodeId = `${nodeId}-merge`;

    // Merge node connects both branches
    if (condition.thenSteps && condition.thenSteps.length > 0) {
      edges.push({
        id: `edge-${thenLastNodeId}-${mergeNodeId}`,
        source: thenLastNodeId,
        target: mergeNodeId,
        marker: 'block',
      });
    }
    if (condition.elseSteps && condition.elseSteps.length > 0) {
      edges.push({
        id: `edge-${elseLastNodeId}-${mergeNodeId}`,
        source: elseLastNodeId,
        target: mergeNodeId,
        marker: 'block',
      });
    }

    finalNodeId = mergeNodeId;
    maxX = mergeX;
  }

  return { lastNodeId: finalNodeId, maxX };
}

/**
 * Process branch steps (then or else)
 */
function processBranchSteps(
  steps: SkillStep[],
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  parentNodeId: string,
  startX: number,
  y: number,
  idPrefix: string,
  branch: 'true' | 'false',
): { lastNodeId: string; maxX: number } {
  let currentX = startX;
  let lastNodeId = parentNodeId;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = `${idPrefix}-${i}`;

    // Create automation node for branch
    const automationNode: WorkflowNode = {
      id: nodeId,
      type: 'automation',
      name: step.description || step.action,
      description: step.description,
      position: { x: currentX, y },
      data: {
        action: step.action,
        parameters: step.parameters,
        delayAfter: step.delay,
        name: step.description || step.action,
      },
    };
    nodes.push(automationNode);

    // Edge from parent or last branch node
    if (i === 0) {
      edges.push({
        id: `edge-${parentNodeId}-${nodeId}`,
        source: parentNodeId,
        target: nodeId,
        condition: branch,
        marker: 'block',
      });
    } else {
      edges.push({
        id: `edge-${lastNodeId}-${nodeId}`,
        source: lastNodeId,
        target: nodeId,
        marker: 'block',
      });
    }

    lastNodeId = nodeId;
    currentX += HORIZONTAL_SPACING + NODE_WIDTH;
  }

  return { lastNodeId, maxX: currentX - HORIZONTAL_SPACING };
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
