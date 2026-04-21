import { WorkflowSchema, type Workflow } from '../types';

/**
 * Workflow Registry
 * Manages workflow definitions and provides lookup operations
 */
export class WorkflowRegistry {
  private workflows: Map<string, Workflow> = new Map();

  /**
   * Register a workflow
   * Validates the workflow against schema before adding
   */
  registerWorkflow(workflow: Workflow): void {
    const validated = WorkflowSchema.parse(workflow);
    this.workflows.set(validated.id, validated);
  }

  /**
   * Unregister a workflow by ID
   */
  unregisterWorkflow(id: string): void {
    this.workflows.delete(id);
  }

  /**
   * Get a workflow by ID
   */
  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  /**
   * Get all registered workflows
   */
  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get workflows by category
   */
  getWorkflowsByCategory(category: string): Workflow[] {
    return this.getAllWorkflows().filter(w => w.category === category);
  }

  /**
   * Search workflows by name or description
   */
  searchWorkflows(query: string): Workflow[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllWorkflows().filter(
      w => w.name.toLowerCase().includes(lowerQuery) || w.description.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Validate workflow variables against workflow definition
   */
  validateVariables(workflow: Workflow, variables: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required variables
    for (const varDef of workflow.variables) {
      if (varDef.required && !(varDef.name in variables)) {
        errors.push(`Required variable '${varDef.name}' is missing`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check if workflow has valid structure (start node, connected edges)
   */
  validateStructure(workflow: Workflow): { valid: boolean; errors: string[] } {
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

    // Check edge connectivity
    const nodeIds = new Set(workflow.nodes.map(n => n.id));
    for (const edge of workflow.edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push(`Edge '${edge.id}' has invalid source node '${edge.source}'`);
      }
      if (!nodeIds.has(edge.target)) {
        errors.push(`Edge '${edge.id}' has invalid target node '${edge.target}'`);
      }
    }

    // Check condition nodes have true/false branches
    for (const node of workflow.nodes) {
      if (node.type === 'condition') {
        if (!node.data.trueNodeId) {
          errors.push(`Condition node '${node.id}' missing trueNodeId`);
        }
        if (!node.data.falseNodeId) {
          errors.push(`Condition node '${node.id}' missing falseNodeId`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Clear all workflows
   */
  clear(): void {
    this.workflows.clear();
  }

  /**
   * Get workflow count
   */
  size(): number {
    return this.workflows.size;
  }
}

// Default singleton instance
export const workflowRegistry = new WorkflowRegistry();
