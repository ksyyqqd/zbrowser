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

        // Execute any output-node side branches connected to the current node.
        // Output nodes are side collectors — they don't affect main flow.
        const outputBranches = this.findOutputBranches(workflow, currentNode.id);
        for (const outputNode of outputBranches) {
          const outResult = await this.executeNode(outputNode, workflow, context);
          results.push(outResult);
        }

        // Find next main-flow node (for condition nodes, use the branch decision)
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
      nodeType: node.type,
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
        case 'output':
          result = this.handleOutputModule(node, context, startTime);
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
      // For output nodes, include the full resolved content; otherwise truncate to 500 chars
      const detailsText = result.output
        ? node.type === 'output'
          ? String(result.output)
          : String(result.output).slice(0, 500)
        : `Node completed: ${node.name}`;
      await this.emitEvent(context, {
        type: 'NODE_OK',
        workflowId: workflow.id,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        details: detailsText,
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
        nodeType: node.type,
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
   *
   * Supports two output modes:
   *  1) Single variable mode: writes the entire AI response to `outputVariable` (legacy)
   *  2) Structured multi-variable mode: prompt may contain `${name}` placeholders that
   *     designate target variables. The executor injects a JSON-output instruction so
   *     the LLM returns `{name1: "...", name2: "..."}`, which is parsed and each field
   *     is written to the corresponding variable.
   */
  private async handleAIModule(node: WorkflowNode, context: WorkflowExecutionContext): Promise<NodeResult> {
    const startTime = Date.now();
    const prompt = node.data.prompt || '';

    if (!prompt.trim()) {
      return {
        nodeId: node.id,
        nodeType: 'ai',
        success: false,
        error: 'AI module has no prompt configured',
        duration: Date.now() - startTime,
      };
    }

    // Build context variables (existing values to inject)
    const contextData: Record<string, unknown> = {};
    const contextVars = node.data.contextVariables || [];
    for (const varName of contextVars) {
      contextData[varName] = context.getVariable(varName);
    }

    // Detect ${varName} placeholders that designate write targets
    const writeTargets = this.extractWriteTargets(prompt);

    // Compose the actual prompt sent to the LLM
    const finalPrompt = writeTargets.length > 0 ? this.buildStructuredPrompt(prompt, writeTargets) : prompt;

    const aiResult = await context.invokeAI(finalPrompt, contextData);

    // Single-variable legacy mode
    if (writeTargets.length === 0) {
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

    // Structured mode: parse JSON and assign each field
    const parsed = this.tryParseStructuredResponse(aiResult.response || '', writeTargets);
    let summary = '';
    if (parsed) {
      for (const name of writeTargets) {
        const val = parsed[name];
        if (val !== undefined) {
          context.setVariable(name, val);
          summary += `${name}: ${typeof val === 'string' ? val : JSON.stringify(val)}\n\n`;
        }
      }
    } else {
      // Final fallback: even if JSON parse failed, try regex extraction for each target
      // then write raw response to first target if nothing else works
      let extracted = false;
      for (const name of writeTargets) {
        const regex = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's');
        const match = regex.exec(aiResult.response || '');
        if (match) {
          // Unescape JSON string escapes
          const val = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          context.setVariable(name, val);
          summary += `${name}: ${val}\n\n`;
          extracted = true;
        }
      }
      if (!extracted && aiResult.response) {
        context.setVariable(writeTargets[0], aiResult.response);
        summary = aiResult.response;
      }
    }
    // Also honor legacy outputVariable if set (e.g. for downstream conditions reading the raw response)
    if (node.data.outputVariable && aiResult.response) {
      context.setVariable(node.data.outputVariable, aiResult.response);
    }

    return {
      nodeId: node.id,
      nodeType: 'ai',
      success: aiResult.success,
      output: summary.trim() || aiResult.response,
      error: aiResult.error,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Extract `${varName}` placeholders from a prompt.
   * Returns deduplicated list in order of first appearance.
   */
  private extractWriteTargets(prompt: string): string[] {
    const re = /\$\{([a-zA-Z_][\w]*)\}/g;
    const seen = new Set<string>();
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      const name = m[1];
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
    return out;
  }

  /**
   * Wrap the user's prompt with a structured-output instruction so the LLM
   * responds with strict JSON containing the requested fields.
   */
  private buildStructuredPrompt(userPrompt: string, targets: string[]): string {
    const fields = targets.map(t => `  "${t}": "<对应内容>"`).join(',\n');
    return `${userPrompt}

---
请严格按以下 JSON 格式返回（不要包裹代码块、不要任何解释、不要额外字符）：
{
${fields}
}`;
  }

  /**
   * Best-effort JSON parsing of an LLM response.
   * Tolerates leading/trailing prose and code-block fences.
   *
   * Some agent runtimes (e.g. PlannerAgent) wrap user prompts in their own
   * schema and place the user-facing payload as a JSON-string under
   * `final_answer` / `content` / `result`. We unwrap one nesting level when
   * none of the requested target fields are present at the top level.
   */
  private tryParseStructuredResponse(response: string, targets: string[]): Record<string, unknown> | null {
    if (!response) return null;
    // Strip code fences
    const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    // Find the first {...} block
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) return null;
    const slice = cleaned.slice(start, end + 1);
    let obj: unknown;
    try {
      obj = JSON.parse(slice);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== 'object') return null;
    const record = obj as Record<string, unknown>;
    const hasAnyTarget = targets.some(t => Object.prototype.hasOwnProperty.call(record, t));
    if (hasAnyTarget) return record;

    // Unwrap one level: try common wrapper keys whose value is a JSON string
    const wrapperKeys = ['final_answer', 'content', 'result', 'answer', 'output', 'data'];
    for (const wk of wrapperKeys) {
      const wv = record[wk];
      if (typeof wv === 'string') {
        const inner = this.tryParseStructuredResponse(wv, targets);
        if (inner) return inner;
      } else if (wv && typeof wv === 'object') {
        const innerRec = wv as Record<string, unknown>;
        const innerHas = targets.some(t => Object.prototype.hasOwnProperty.call(innerRec, t));
        if (innerHas) return innerRec;
      }
    }
    return null;
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
   * Supports both legacy (trueNodeId/falseNodeId) and new (branches + sourcePort) formats
   */
  private async handleConditionModule(
    node: WorkflowNode,
    workflow: Workflow,
    context: WorkflowExecutionContext,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const evaluateWithAI = node.data.evaluateWithAI ?? true;

    // Check for new branch format
    const branches = node.data.branches;
    const prompt = node.data.prompt || node.data.conditionExpression || '';

    // Legacy format: trueNodeId/falseNodeId
    const trueNodeId = node.data.trueNodeId || '';
    const falseNodeId = node.data.falseNodeId || '';

    // Determine next node based on format
    let nextNodeId: string;

    if (branches && branches.length > 0) {
      // New multi-branch format: use AI to select branch
      const branchNames = branches.map(b => b.name).join(', ');
      const aiPrompt = `${prompt}\n\nAvailable branches: ${branchNames}\n\nSelect the most appropriate branch name. Return only the branch name, nothing else.`;

      const aiResult = await context.invokeAI(aiPrompt);
      const selectedBranchName = aiResult.response?.trim() || '';

      // Find the matching branch
      const selectedBranch =
        branches.find(b => b.name.toLowerCase() === selectedBranchName.toLowerCase() || b.id === selectedBranchName) ||
        branches[0]; // Default to first branch if no match

      // Find the edge for this branch using sourcePort
      const branchEdge = workflow.edges.find(
        e => e.source === node.id && (e.sourcePort === selectedBranch.id || e.condition === selectedBranch.id),
      );

      nextNodeId = branchEdge?.target || '';

      // Emit branch selection event
      await this.emitEvent(context, {
        type: 'BRANCH_SELECT',
        workflowId: workflow.id,
        nodeId: node.id,
        nodeName: node.name,
        details: `Branch: ${selectedBranch.name} → ${nextNodeId}`,
      });

      return {
        nodeId: node.id,
        nodeType: 'condition',
        success: true,
        output: selectedBranch.name,
        nextNodeId,
        duration: Date.now() - startTime,
      };
    } else if (trueNodeId || falseNodeId) {
      // Legacy format: binary true/false branches
      let conditionResult: boolean;

      if (evaluateWithAI) {
        const aiPrompt = `Evaluate the following condition and return 'true' or 'false'. Condition: ${prompt}`;
        const aiResult = await context.invokeAI(aiPrompt);
        conditionResult = aiResult.response?.toLowerCase().includes('true') ?? false;
      } else {
        conditionResult = this.evaluateSimpleExpression(prompt, context);
      }

      nextNodeId = conditionResult ? trueNodeId : falseNodeId;

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
        nextNodeId,
        duration: Date.now() - startTime,
      };
    } else {
      // No branch configuration - return error
      return {
        nodeId: node.id,
        nodeType: 'condition',
        success: false,
        error: 'Condition node has no branches configured',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Handle Output Module execution
   * Resolves the content template (supports {{variableName}}) and returns it as output.
   * The result is rendered as a final-output card on the execution log panel.
   */
  private handleOutputModule(node: WorkflowNode, context: WorkflowExecutionContext, startTime: number): NodeResult {
    const template = node.data.content || '';
    const resolved = template ? this.resolveTemplate(template, context) : '';
    return {
      nodeId: node.id,
      nodeType: 'output',
      success: true,
      output: resolved,
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
   * Find next main-flow node after given node ID.
   * Skips edges that target output nodes (they are handled as side branches).
   */
  private findNextNode(workflow: Workflow, nodeId: string): WorkflowNode | undefined {
    const edge = workflow.edges.find(e => {
      if (e.source !== nodeId) return false;
      const target = workflow.nodes.find(n => n.id === e.target);
      return target?.type !== 'output';
    });
    if (!edge) return undefined;
    return workflow.nodes.find(n => n.id === edge.target);
  }

  /**
   * Find all output nodes that are directly connected from a given source node.
   */
  private findOutputBranches(workflow: Workflow, sourceNodeId: string): WorkflowNode[] {
    return workflow.edges
      .filter(e => e.source === sourceNodeId)
      .map(e => workflow.nodes.find(n => n.id === e.target))
      .filter((n): n is WorkflowNode => n?.type === 'output');
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
