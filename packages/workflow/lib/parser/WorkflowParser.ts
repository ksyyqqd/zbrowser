import { z } from 'zod';
import { WorkflowSchema, type Workflow } from '../types';

/**
 * Parse and validate workflow from JSON
 */
export function parseWorkflow(json: unknown): Workflow {
  return WorkflowSchema.parse(json);
}

/**
 * Parse multiple workflows from JSON array
 */
export function parseWorkflows(json: unknown): Workflow[] {
  const schema = z.array(WorkflowSchema);
  return schema.parse(json);
}

/**
 * Safe parse workflow - returns result object instead of throwing
 */
export function safeParseWorkflow(json: unknown): { success: boolean; data?: Workflow; error?: string } {
  const result = WorkflowSchema.safeParse(json);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('\n'),
  };
}

/**
 * Validate workflow structure (edges, nodes connectivity)
 */
export function validateWorkflowStructure(workflow: Workflow): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for start node
  const startNode = workflow.nodes.find(n => n.type === 'start');
  if (!startNode) {
    errors.push('Workflow must have a start node');
  }

  // Check for end node
  const endNode = workflow.nodes.find(n => n.type === 'end');
  if (!endNode) {
    errors.push('Workflow must have an end node');
  }

  // Check that all nodes have unique IDs
  const nodeIds = new Set<string>();
  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node ID: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  // Check that all edge sources and targets exist
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge '${edge.id}' references non-existent source node '${edge.source}'`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge '${edge.id}' references non-existent target node '${edge.target}'`);
    }
  }

  // Check condition nodes have valid branch targets
  for (const node of workflow.nodes) {
    if (node.type === 'condition') {
      if (!node.data.trueNodeId) {
        errors.push(`Condition node '${node.id}' missing trueNodeId`);
      } else if (!nodeIds.has(node.data.trueNodeId)) {
        errors.push(`Condition node '${node.id}' trueNodeId '${node.data.trueNodeId}' does not exist`);
      }
      if (!node.data.falseNodeId) {
        errors.push(`Condition node '${node.id}' missing falseNodeId`);
      } else if (!nodeIds.has(node.data.falseNodeId)) {
        errors.push(`Condition node '${node.id}' falseNodeId '${node.data.falseNodeId}' does not exist`);
      }
    }
  }

  // Check that there's a path from start to end
  if (startNode && endNode) {
    const reachable = findReachableNodes(workflow, startNode.id);
    if (!reachable.has(endNode.id)) {
      errors.push('No path from start node to end node');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Find all nodes reachable from a given node
 */
function findReachableNodes(workflow: Workflow, startNodeId: string): Set<string> {
  const reachable = new Set<string>();
  const stack = [startNodeId];

  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);

    // Find edges from this node
    for (const edge of workflow.edges) {
      if (edge.source === nodeId) {
        stack.push(edge.target);
      }
    }

    // For condition nodes, also check branches
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (node?.type === 'condition') {
      if (node.data.trueNodeId) stack.push(node.data.trueNodeId);
      if (node.data.falseNodeId) stack.push(node.data.falseNodeId);
    }
  }

  return reachable;
}

/**
 * Serialize workflow to JSON string
 */
export function serializeWorkflow(workflow: Workflow): string {
  return JSON.stringify(workflow, null, 2);
}

/**
 * Serialize multiple workflows to JSON string
 */
export function serializeWorkflows(workflows: Workflow[]): string {
  return JSON.stringify(workflows, null, 2);
}
