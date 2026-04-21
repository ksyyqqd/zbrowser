import type {
  Workflow,
  WorkflowNode,
  WorkflowExecutionContext,
  WorkflowResult,
  NodeResult,
  WorkflowEvent,
} from '../types';

/**
 * Workflow Executor
 * Executes workflow nodes in sequence, handling AI, Automation, and Condition modules
 */
export class WorkflowExecutor {
  /**
   * Execute a workflow
   */
  async execute(workflow: Workflow, context: WorkflowExecutionContext): Promise<WorkflowResult> {
    const startTime = Date.now();
    const results: NodeResult[] = [];

    // Emit workflow start event
    await this.emitEvent(context, {
      type: 'WORKFLOW_START',
      workflowId: workflow.id,
      details: `Starting workflow: ${workflow.name}`,
    });

    try {
      // Find start node
      const startNode = workflow.nodes.find(n => n.type === 'start');
      if (!startNode) {
        throw new Error('Workflow must have a start node');
      }

      // Initialize variables
      for (const varDef of workflow.variables) {
        if (varDef.default !== undefined) {
          context.setVariable(varDef.name, varDef.default);
        }
      }

      // Execute nodes starting from start node
      let currentNode = this.findNextNode(workflow, startNode.id);
      context.currentNodeId = currentNode?.id;
      context.executedNodes = [];

      while (currentNode && currentNode.type !== 'end') {
        const nodeResult = await this.executeNode(currentNode, workflow, context);
        results.push(nodeResult);

        if (!nodeResult.success && workflow.executionConfig.onError === 'stop') {
          break;
        }

        // Find next node (for condition nodes, use the branch decision)
        if (currentNode.type === 'condition' && nodeResult.nextNodeId) {
          currentNode = workflow.nodes.find(n => n.id === nodeResult.nextNodeId);
        } else {
          currentNode = this.findNextNode(workflow, currentNode.id);
        }

        context.currentNodeId = currentNode?.id;
      }

      const duration = Date.now() - startTime;
      const success = results.every(r => r.success) || workflow.executionConfig.onError === 'continue';

      // Emit workflow complete event
      await this.emitEvent(context, {
        type: success ? 'WORKFLOW_OK' : 'WORKFLOW_FAIL',
        workflowId: workflow.id,
        details: success ? 'Workflow completed successfully' : 'Workflow failed',
      });

      return {
        workflowId: workflow.id,
        success,
        results,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.emitEvent(context, {
        type: 'WORKFLOW_FAIL',
        workflowId: workflow.id,
        details: errorMessage,
      });

      return {
        workflowId: workflow.id,
        success: false,
        results,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Execute a single node
   */
  private async executeNode(
    node: WorkflowNode,
    workflow: Workflow,
    context: WorkflowExecutionContext,
  ): Promise<NodeResult> {
    const startTime = Date.now();

    // Emit node start event
    await this.emitEvent(context, {
      type: 'NODE_START',
      workflowId: workflow.id,
      nodeId: node.id,
      nodeName: node.name,
      details: `Executing node: ${node.name}`,
    });

    // Track executed nodes
    if (context.executedNodes) {
      context.executedNodes.push(node);
    }

    let result: NodeResult;

    try {
      switch (node.type) {
        case 'ai':
          result = await this.handleAIModule(node, context);
          break;
        case 'automation':
          result = await this.handleAutomationModule(node, context);
          break;
        case 'condition':
          result = await this.handleConditionModule(node, workflow, context);
          break;
        default:
          result = {
            nodeId: node.id,
            nodeType: node.type,
            success: true,
            duration: Date.now() - startTime,
          };
      }

      // Emit node complete event
      await this.emitEvent(context, {
        type: 'NODE_OK',
        workflowId: workflow.id,
        nodeId: node.id,
        nodeName: node.name,
        details: `Node completed: ${node.name}`,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Emit node fail event
      await this.emitEvent(context, {
        type: 'NODE_FAIL',
        workflowId: workflow.id,
        nodeId: node.id,
        nodeName: node.name,
        details: errorMessage,
      });

      return {
        nodeId: node.id,
        nodeType: node.type,
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Handle AI Module execution
   */
  private async handleAIModule(node: WorkflowNode, context: WorkflowExecutionContext): Promise<NodeResult> {
    const startTime = Date.now();
    const prompt = node.data.prompt || '';

    // Build context variables
    const contextData: Record<string, unknown> = {};
    const contextVars = node.data.contextVariables || [];
    for (const varName of contextVars) {
      contextData[varName] = context.getVariable(varName);
    }

    // Invoke AI
    const aiResult = await context.invokeAI(prompt, contextData);

    // Store output in variable if specified
    if (node.data.outputVariable && aiResult.response) {
      context.setVariable(node.data.outputVariable, aiResult.response);
    }

    return {
      nodeId: node.id,
      nodeType: 'ai',
      success: aiResult.success,
      output: aiResult.response,
      error: aiResult.error,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Handle Automation Module execution
   */
  private async handleAutomationModule(node: WorkflowNode, context: WorkflowExecutionContext): Promise<NodeResult> {
    const startTime = Date.now();
    const action = node.data.action || '';
    const parameters = node.data.parameters || {};

    // Resolve template variables in parameters
    const resolvedParams = this.resolveParameters(parameters, context);

    // Execute action
    const actionResult = await context.executeAction(action, resolvedParams);

    // Apply delay if specified
    if (node.data.delayAfter) {
      await this.delay(node.data.delayAfter);
    }

    return {
      nodeId: node.id,
      nodeType: 'automation',
      success: actionResult.success ?? true,
      output: actionResult.extractedContent ?? undefined,
      error: actionResult.error ?? undefined,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Handle Condition Module execution
   */
  private async handleConditionModule(
    node: WorkflowNode,
    workflow: Workflow,
    context: WorkflowExecutionContext,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const expression = node.data.conditionExpression || '';
    const evaluateWithAI = node.data.evaluateWithAI ?? false;
    const trueNodeId = node.data.trueNodeId || '';
    const falseNodeId = node.data.falseNodeId || '';

    let conditionResult: boolean;

    if (evaluateWithAI) {
      // Use AI to evaluate complex conditions
      const aiPrompt = `Evaluate the following condition and return 'true' or 'false'. Condition: ${expression}`;
      const aiResult = await context.invokeAI(aiPrompt);
      conditionResult = aiResult.response?.toLowerCase().includes('true') ?? false;
    } else {
      // Use simple expression parsing
      conditionResult = this.evaluateSimpleExpression(expression, context);
    }

    // Emit branch selection event
    await this.emitEvent(context, {
      type: 'BRANCH_SELECT',
      workflowId: workflow.id,
      nodeId: node.id,
      nodeName: node.name,
      details: conditionResult ? `Branch: true → ${trueNodeId}` : `Branch: false → ${falseNodeId}`,
    });

    return {
      nodeId: node.id,
      nodeType: 'condition',
      success: true,
      output: conditionResult,
      nextNodeId: conditionResult ? trueNodeId : falseNodeId,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Evaluate simple expression (without AI)
   */
  private evaluateSimpleExpression(expression: string, context: WorkflowExecutionContext): boolean {
    // Parse expression like "{{result.success}} === true"
    const templateRegex = /\{\{([^}]+)\}\}/g;
    let resolvedExpression = expression;

    // Replace template variables
    resolvedExpression = resolvedExpression.replace(templateRegex, (_, varPath) => {
      const value = context.getVariable(varPath.trim());
      if (typeof value === 'string') {
        return `'${value}'`;
      }
      if (typeof value === 'boolean' || typeof value === 'number') {
        return String(value);
      }
      return 'null';
    });

    // Safely evaluate simple expressions
    try {
      // Only allow safe comparison operators
      const safeOperators = ['===', '!==', '>', '<', '>=', '<=', 'includes', 'startsWith', 'endsWith'];
      let hasSafeOperator = false;
      for (const op of safeOperators) {
        if (resolvedExpression.includes(op)) {
          hasSafeOperator = true;
          break;
        }
      }

      if (!hasSafeOperator) {
        // Default to truthiness check
        const value = resolvedExpression.trim();
        return value === 'true' || (value !== 'false' && value !== 'null' && value !== '0');
      }

      // Handle .includes(), .startsWith(), .endsWith()
      if (resolvedExpression.includes('.includes(')) {
        const match = resolvedExpression.match(/'([^']*)'\.includes\('([^']*)'\)/);
        if (match) {
          return match[1].includes(match[2]);
        }
      }

      // Handle basic comparisons using Function (limited scope)
      // This is a simplified implementation - consider using a proper expression parser
      const parts = resolvedExpression.split(/===|!==|>=|<=|>|</);
      if (parts.length === 2) {
        const left = parts[0].trim().replace(/^'|'$/, '');
        const right = parts[1].trim().replace(/^'|'$/, '');
        const operator = resolvedExpression.match(/===|!==|>=|<=|>|</)?.[0] || '===';

        switch (operator) {
          case '===':
            return left === right;
          case '!==':
            return left !== right;
          case '>':
            return Number(left) > Number(right);
          case '<':
            return Number(left) < Number(right);
          case '>=':
            return Number(left) >= Number(right);
          case '<=':
            return Number(left) <= Number(right);
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Resolve template variables in parameters
   */
  private resolveParameters(
    params: Record<string, unknown>,
    context: WorkflowExecutionContext,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.includes('{{')) {
        resolved[key] = this.resolveTemplate(value, context);
      } else if (typeof value === 'object' && value !== null) {
        resolved[key] = this.resolveParameters(value as Record<string, unknown>, context);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Resolve template string
   */
  private resolveTemplate(template: string, context: WorkflowExecutionContext): string {
    const templateRegex = /\{\{([^}]+)\}\}/g;
    return template.replace(templateRegex, (_, varPath) => {
      const value = context.getVariable(varPath.trim());
      return value !== undefined ? String(value) : '';
    });
  }

  /**
   * Find next node after given node ID
   */
  private findNextNode(workflow: Workflow, nodeId: string): WorkflowNode | undefined {
    const edge = workflow.edges.find(e => e.source === nodeId);
    if (!edge) return undefined;
    return workflow.nodes.find(n => n.id === edge.target);
  }

  /**
   * Emit event through context
   */
  private async emitEvent(context: WorkflowExecutionContext, event: WorkflowEvent): Promise<void> {
    if (context.emitEvent) {
      event.timestamp = Date.now();
      await context.emitEvent(event);
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Default singleton instance
export const workflowExecutor = new WorkflowExecutor();
