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
   * Hard ceiling on `maxIterations` no matter what the workflow declares —
   * a final brake against runaway prompts that demand silly loop counts.
   */
  private static readonly ABSOLUTE_LOOP_CAP = 1000;

  /**
   * Execute a workflow
   */
  async execute(workflow: Workflow, context: WorkflowExecutionContext): Promise<WorkflowResult> {
    const startTime = Date.now();
    const results: NodeResult[] = [];
    // Per-RUN loop iteration counters keyed by loop node id. Each call to
    // execute() (including recursive subflow calls) has its own map, so
    // parent and child workflows don't stomp on each other's loop state.
    const loopIterations = new Map<string, number>();

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

      // Initialize variables.
      // A `required` variable must have either a default value declared on
      // the workflow OR be provided by the caller (via `context.setVariable`
      // before .execute()) — otherwise we fail fast with a clear message so
      // the user sees exactly which input is missing.
      for (const varDef of workflow.variables) {
        if (varDef.default !== undefined) {
          context.setVariable(varDef.name, varDef.default);
        } else if (varDef.required && context.getVariable(varDef.name) === undefined) {
          throw new Error(`Required variable '${varDef.name}' is not provided`);
        }
      }

      // Execute nodes starting from start node
      let currentNode = this.findNextNode(workflow, startNode.id);
      context.currentNodeId = currentNode?.id;
      context.executedNodes = [];

      // Stack of active loop node ids. When the body of a loop runs off the
      // end of its main-flow chain (no outgoing edge), we automatically jump
      // back to the innermost loop node — the user does NOT have to draw a
      // "return" edge by hand. Manually drawn return edges still work and
      // take precedence over the implicit jump.
      const loopStack: string[] = [];

      while (currentNode && currentNode.type !== 'end') {
        const nodeResult = await this.executeNode(currentNode, workflow, context, loopIterations);
        results.push(nodeResult);

        if (!nodeResult.success && workflow.executionConfig.onError === 'stop') {
          break;
        }

        // Determine which output-node side branches to fire.
        // For condition nodes: only outputs reached via the selected branch's sourcePort.
        // Loop nodes don't expose `output` side branches — they only route to body / exit.
        // For other nodes: all directly connected outputs.
        let outputBranches: WorkflowNode[];
        if (currentNode.type === 'condition' && nodeResult.selectedBranchId) {
          outputBranches = this.findOutputBranches(workflow, currentNode.id, nodeResult.selectedBranchId);
        } else if (currentNode.type === 'condition') {
          // Condition with no selected branch — no outputs to fire (defensive)
          outputBranches = [];
        } else if (currentNode.type === 'loop') {
          outputBranches = [];
        } else {
          outputBranches = this.findOutputBranches(workflow, currentNode.id);
        }

        for (const outputNode of outputBranches) {
          const outResult = await this.executeNode(outputNode, workflow, context, loopIterations);
          results.push(outResult);
        }

        // Track loop stack:
        //  - entering a loop iteration body (loop chose `continue`)  → push
        //  - leaving a loop (loop chose `exit`)                       → pop
        if (currentNode.type === 'loop') {
          if (nodeResult.selectedBranchId === 'continue') {
            // Same loop may already be at the top after a previous iteration;
            // only push when it's not already there.
            if (loopStack[loopStack.length - 1] !== currentNode.id) {
              loopStack.push(currentNode.id);
            }
          } else if (nodeResult.selectedBranchId === 'exit') {
            // Pop matching loop. If somehow the stack disagrees, fall back to
            // popping the top — defensive against malformed graphs.
            const idx = loopStack.lastIndexOf(currentNode.id);
            if (idx >= 0) {
              loopStack.splice(idx, 1);
            }
          }
        }

        // Find next main-flow node.
        //  - condition node: use the AI-decided branch target
        //  - loop node: use the loop-back / exit edge target chosen by the loop module
        //  - everything else: first non-output outgoing edge
        let nextNode: WorkflowNode | undefined;
        if ((currentNode.type === 'condition' || currentNode.type === 'loop') && nodeResult.nextNodeId) {
          nextNode = workflow.nodes.find(n => n.id === nodeResult.nextNodeId);
        } else {
          nextNode = this.findNextNode(workflow, currentNode.id);
        }

        // Implicit loop-back: if we ran off the end of the body chain while
        // inside a loop, return control to the innermost active loop node.
        // This keeps the canvas clean — no manual return edge required.
        if (!nextNode && loopStack.length > 0 && currentNode.type !== 'loop') {
          const loopNodeId = loopStack[loopStack.length - 1];
          nextNode = workflow.nodes.find(n => n.id === loopNodeId);
        }

        currentNode = nextNode;

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
    loopIterations: Map<string, number>,
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
        case 'loop':
          result = await this.handleLoopModule(node, workflow, context, loopIterations);
          break;
        case 'note':
          // Display-only — never participates in execution.
          result = {
            nodeId: node.id,
            nodeType: 'note',
            success: true,
            duration: Date.now() - startTime,
          };
          break;
        case 'subflow':
          result = await this.handleSubflowModule(node, context);
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
   * Output mechanism:
   *  - Prompt may contain `${name}` placeholders that designate target variables.
   *    The executor injects a JSON-output instruction so the LLM returns
   *    `{name1: "...", name2: "..."}`, which is parsed and each field is written
   *    to the corresponding variable.
   *  - If no placeholders are present, the response is only stored on the node
   *    result for display; downstream consumption requires explicit `${var}` markers.
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

    // No write targets — just return the response (no variable assignment)
    if (writeTargets.length === 0) {
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
      // Fallback: regex extraction for each target, then raw response to first if all fail
      let extracted = false;
      for (const name of writeTargets) {
        const regex = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's');
        const match = regex.exec(aiResult.response || '');
        if (match) {
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

    // Persist extracted content into a variable when the node specifies one.
    // Used by cache_content / get_dropdown_options to feed page data into
    // the workflow variable system.
    const outputVar = (resolvedParams.outputVariable || resolvedParams.variable) as string | undefined;
    if (outputVar && actionResult.success && actionResult.extractedContent !== undefined) {
      context.setVariable(outputVar, actionResult.extractedContent);
    }

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

    // Check for new branch format
    const branches = node.data.branches;
    const rawPrompt = node.data.prompt || node.data.conditionExpression || '';
    // Resolve {{variableName}} template substitutions before sending to AI
    const prompt = this.resolveTemplate(rawPrompt, context);

    // Legacy format: trueNodeId/falseNodeId
    const trueNodeId = node.data.trueNodeId || '';
    const falseNodeId = node.data.falseNodeId || '';

    // Determine next node based on format
    let nextNodeId: string;

    if (branches && branches.length > 0) {
      // Multi-branch format: AI returns branch index (0-based) for precise matching
      const branchList = branches.map((b, i) => `${i}: ${b.name}`).join('\n');
      const aiPrompt = `${prompt}\n\nAvailable branches:\n${branchList}\n\nReturn ONLY the number (0, 1, 2, ...) of the most appropriate branch. Do not return anything else.`;

      // Prefer the lightweight invocation (no page context / no skills / no agent identity);
      // fall back to the full pipeline if the host did not provide it.
      const aiResult = context.invokeAILight ? await context.invokeAILight(aiPrompt) : await context.invokeAI(aiPrompt);
      const responseText = (aiResult.response || '').trim();

      // Extract the first integer from the response
      const indexMatch = responseText.match(/(\d+)/);
      const selectedIndex = indexMatch ? parseInt(indexMatch[1], 10) : 0;

      // Clamp to valid range
      const safeIndex = Math.min(Math.max(0, selectedIndex), branches.length - 1);
      const selectedBranch = branches[safeIndex];

      // Find main-flow next node for this branch (non-output target).
      // Output targets are handled separately as side branches by the main loop.
      const branchEdges = workflow.edges.filter(
        e => e.source === node.id && (e.sourcePort === selectedBranch.id || e.condition === selectedBranch.id),
      );
      const mainFlowEdge = branchEdges.find(e => {
        const target = workflow.nodes.find(n => n.id === e.target);
        return target?.type !== 'output';
      });
      // If no main-flow edge, fall back to the first edge (so workflow doesn't dead-end silently)
      nextNodeId = mainFlowEdge?.target || branchEdges[0]?.target || '';

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
        selectedBranchId: selectedBranch.id,
        duration: Date.now() - startTime,
      };
    } else if (trueNodeId || falseNodeId) {
      // Legacy format: binary true/false branches — always uses AI evaluation now.
      const aiPrompt = `Evaluate the following condition and return 'true' or 'false'. Condition: ${prompt}`;
      const aiResult = context.invokeAILight ? await context.invokeAILight(aiPrompt) : await context.invokeAI(aiPrompt);
      const conditionResult = aiResult.response?.toLowerCase().includes('true') ?? false;

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
   * Handle Loop Module execution (option A: loop-back edge)
   *
   * Two outgoing ports:
   *   - `continue`: edge back to the start of the loop body
   *   - `exit`: edge to the post-loop flow
   *
   * Decision modes:
   *   - `fixed`: increment until iter >= maxIterations, then exit
   *   - `ai_judge`: ask AI "continue" or "stop" each tick, but `maxIterations`
   *     is a HARD ceiling (defensive against AI runaways)
   *
   * Side effects on context:
   *   - Writes `<iterationVariable>_iter`  = current iteration index (0-based,
   *     value seen BY the body during this iteration)
   *   - Writes `<iterationVariable>_done`  = true when we route to `exit`
   *   - Writes `<iterationVariable>_total` = final iteration count on exit
   */
  private async handleLoopModule(
    node: WorkflowNode,
    workflow: Workflow,
    context: WorkflowExecutionContext,
    loopIterations: Map<string, number>,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const mode = (node.data.loopMode as 'fixed' | 'ai_judge' | undefined) ?? 'fixed';
    const declaredMax = Math.max(1, Number(node.data.maxIterations ?? 1));
    const maxIterations = Math.min(declaredMax, WorkflowExecutor.ABSOLUTE_LOOP_CAP);
    const varName = (node.data.iterationVariable || '').trim();

    // iter is the count of completed body executions so far (0 before the first body run).
    const iter = loopIterations.get(node.id) ?? 0;

    // Decide continue vs exit
    let shouldContinue: boolean;
    let reason: string;
    if (mode === 'fixed') {
      shouldContinue = iter < maxIterations;
      reason = `${iter}/${maxIterations}`;
    } else {
      // ai_judge: still enforce the hard cap
      if (iter >= maxIterations) {
        shouldContinue = false;
        reason = `cap reached (${maxIterations})`;
      } else {
        const rawPrompt = node.data.prompt || '';
        const resolvedPrompt = this.resolveTemplate(rawPrompt, context);
        const aiPrompt = `${resolvedPrompt}

You are deciding whether a loop should run another iteration. Current iteration index (0-based): ${iter}. Hard cap: ${maxIterations}.
Reply with exactly one word: "continue" to run another iteration, "stop" to exit. No explanation.`;
        const aiResult = context.invokeAILight
          ? await context.invokeAILight(aiPrompt)
          : await context.invokeAI(aiPrompt);
        const txt = (aiResult.response || '').trim().toLowerCase();
        // Default to STOP on ambiguous response — safer than runaway.
        shouldContinue = /continue|yes|true|next|again/.test(txt) && !/stop|no|false|end|exit|done/.test(txt);
        reason = `ai → ${shouldContinue ? 'continue' : 'stop'} (iter=${iter})`;
      }
    }

    // Locate the matching outgoing edge.
    const port = shouldContinue ? 'continue' : 'exit';
    const edge = workflow.edges.find(e => e.source === node.id && e.sourcePort === port);
    const nextNodeId = edge?.target || '';

    // Publish loop variables for the body / downstream nodes to read.
    if (varName) {
      context.setVariable(`${varName}_iter`, iter);
      context.setVariable(`${varName}_done`, !shouldContinue);
      if (!shouldContinue) {
        context.setVariable(`${varName}_total`, iter);
      }
    }

    // Bump the counter only when we are about to run the body again — the
    // iter value the body sees during this pass equals what we just published.
    if (shouldContinue) {
      loopIterations.set(node.id, iter + 1);
    }

    await this.emitEvent(context, {
      type: 'BRANCH_SELECT',
      workflowId: workflow.id,
      nodeId: node.id,
      nodeName: node.name,
      details: `Loop ${reason} → ${port}${nextNodeId ? ' → ' + nextNodeId : ' (no edge)'}`,
    });

    return {
      nodeId: node.id,
      nodeType: 'loop',
      success: true,
      output: `${port} (iter ${iter}/${maxIterations})`,
      nextNodeId,
      selectedBranchId: port,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Handle Subflow Module execution.
   *
   * Loads another saved workflow by id and runs it recursively.
   *
   *  - Variables are ISOLATED by default: the child only sees variables that
   *    were explicitly mapped via `subflowInputs`. Same way out: only
   *    `subflowOutputs` entries get copied back to the parent. This keeps
   *    sub-workflows safe to reuse without accidental cross-contamination.
   *  - Browser side effects (page navigation, clicks) share the same tab as
   *    the parent — the executor wires them through the same `executeAction`
   *    / `invokeAI` capabilities, so there's no separate "browser session"
   *    for the child.
   *  - Cycles are detected via `_subflowStack`. A workflow that (directly or
   *    transitively) calls itself fails with a clear error rather than
   *    recursing until the stack blows.
   */
  private async handleSubflowModule(node: WorkflowNode, context: WorkflowExecutionContext): Promise<NodeResult> {
    const startTime = Date.now();
    const subflowId = (node.data.subflowId as string | undefined)?.trim();
    if (!subflowId) {
      return {
        nodeId: node.id,
        nodeType: 'subflow',
        success: false,
        error: '子流程未选择目标工作流',
        duration: Date.now() - startTime,
      };
    }
    if (!context.loadWorkflowById) {
      return {
        nodeId: node.id,
        nodeType: 'subflow',
        success: false,
        error: '当前执行环境不支持加载子流程',
        duration: Date.now() - startTime,
      };
    }

    // Cycle detection — refuse to recurse into a workflow we're already inside.
    const stack = context._subflowStack ?? [];
    if (stack.includes(subflowId)) {
      return {
        nodeId: node.id,
        nodeType: 'subflow',
        success: false,
        error: `检测到子流程循环调用: ${[...stack, subflowId].join(' → ')}`,
        duration: Date.now() - startTime,
      };
    }

    // Hard depth cap (defensive — cycle detection should already cover this).
    if (stack.length >= 8) {
      return {
        nodeId: node.id,
        nodeType: 'subflow',
        success: false,
        error: `子流程嵌套深度超过 8 层`,
        duration: Date.now() - startTime,
      };
    }

    let subWorkflow: Workflow | null;
    try {
      subWorkflow = await context.loadWorkflowById(subflowId);
    } catch (err) {
      return {
        nodeId: node.id,
        nodeType: 'subflow',
        success: false,
        error: `加载子流程失败: ${err instanceof Error ? err.message : String(err)}`,
        duration: Date.now() - startTime,
      };
    }

    if (!subWorkflow) {
      return {
        nodeId: node.id,
        nodeType: 'subflow',
        success: false,
        error: `子流程 ${subflowId} 不存在`,
        duration: Date.now() - startTime,
      };
    }

    // Build the child variable map.
    //  1. Start from the child workflow's own variable defaults
    //  2. Overlay caller-provided inputs (each value is a template resolved in
    //     the parent scope, e.g. "{{topic}}" → parent variable "topic")
    const childVars: Record<string, unknown> = {};
    for (const v of subWorkflow.variables || []) {
      if (v.default !== undefined) childVars[v.name] = v.default;
    }
    const inputBindings = node.data.subflowInputs || {};
    for (const [childKey, templateOrName] of Object.entries(inputBindings)) {
      // Template syntax wins; fall back to direct variable name if no braces.
      const value = templateOrName.includes('{{')
        ? this.resolveTemplate(templateOrName, context)
        : context.getVariable(templateOrName);
      childVars[childKey] = value;
    }

    // Build a child context that shares browser/AI capabilities with the
    // parent, but has its own variable namespace and an extended subflow
    // stack (for nested cycle detection).
    const childContext: WorkflowExecutionContext = {
      executeAction: context.executeAction,
      invokeAI: context.invokeAI,
      invokeAILight: context.invokeAILight,
      getVariable: (name: string) => childVars[name],
      setVariable: (name: string, value: unknown) => {
        childVars[name] = value;
      },
      loadWorkflowById: context.loadWorkflowById,
      _subflowStack: [...stack, subflowId],
      emitEvent: context.emitEvent,
    };

    // Recurse. The child run emits its own WORKFLOW_START/_OK/_FAIL + NODE_*
    // events through the shared emitter, so the parent UI sees the full trace.
    const subResult = await this.execute(subWorkflow, childContext);

    // Copy mapped outputs back into the parent scope.
    const outputBindings = node.data.subflowOutputs || {};
    for (const [childKey, parentKey] of Object.entries(outputBindings)) {
      if (childKey in childVars) {
        context.setVariable(parentKey, childVars[childKey]);
      }
    }

    return {
      nodeId: node.id,
      nodeType: 'subflow',
      success: subResult.success,
      output: subResult.success ? `子流程 ${subWorkflow.name} 执行完成` : subResult.error,
      error: subResult.success ? undefined : subResult.error,
      duration: Date.now() - startTime,
    };
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
  private findOutputBranches(workflow: Workflow, sourceNodeId: string, sourcePort?: string): WorkflowNode[] {
    return workflow.edges
      .filter(e => {
        if (e.source !== sourceNodeId) return false;
        // If sourcePort filter is specified (condition node), only match edges from that branch
        if (sourcePort && e.sourcePort !== sourcePort) return false;
        return true;
      })
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
