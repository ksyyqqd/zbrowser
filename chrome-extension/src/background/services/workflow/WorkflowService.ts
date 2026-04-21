import {
  WorkflowRegistry,
  WorkflowExecutor,
  type Workflow,
  type WorkflowResult,
  type WorkflowExecutionContext,
  type WorkflowNode,
  type ActionResult,
  type AIResult,
} from '@extension/workflow';
import { userWorkflowsStore } from '@extension/storage';
import { createLogger } from '../../log';

const logger = createLogger('WorkflowService');

/**
 * Workflow execution context implementation
 * Bridges workflow execution to browser automation and AI agents
 */
class WorkflowExecutionContextImpl implements WorkflowExecutionContext {
  private tabId: number;
  private variables: Record<string, unknown> = {};
  private actionExecutor?: (action: string, params: Record<string, unknown>) => Promise<ActionResult>;
  private aiInvoker?: (prompt: string, context?: Record<string, unknown>) => Promise<AIResult>;

  // Execution state tracking
  currentNodeId?: string;
  executedNodes: WorkflowNode[] = [];

  constructor(
    tabId: number,
    actionExecutor?: (action: string, params: Record<string, unknown>) => Promise<ActionResult>,
    aiInvoker?: (prompt: string, context?: Record<string, unknown>) => Promise<AIResult>,
  ) {
    this.tabId = tabId;
    this.actionExecutor = actionExecutor;
    this.aiInvoker = aiInvoker;
  }

  async executeAction(actionName: string, params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.actionExecutor) {
      return {
        success: false,
        error: 'No action executor available',
      };
    }
    return this.actionExecutor(actionName, params);
  }

  async invokeAI(prompt: string, context?: Record<string, unknown>): Promise<AIResult> {
    if (!this.aiInvoker) {
      return {
        success: false,
        error: 'No AI invoker available',
      };
    }
    return this.aiInvoker(prompt, context);
  }

  getVariable(name: string): unknown {
    return this.variables[name];
  }

  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }

  async emitEvent(event: import('@extension/workflow').WorkflowEvent): Promise<void> {
    logger.info('Workflow event:', event.type, event.nodeId, event.details);
    // Events can be sent to UI via Chrome messaging if needed
  }
}

/**
 * Workflow Service - manages workflow registry and execution
 */
export class WorkflowService {
  private registry: WorkflowRegistry;
  private executor: WorkflowExecutor;
  private initialized: boolean = false;

  constructor() {
    this.registry = new WorkflowRegistry();
    this.executor = new WorkflowExecutor();
  }

  /**
   * Initialize the workflow service - load user workflows and subscribe to changes
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing Workflow service...');

    try {
      // Load user workflows
      const userWorkflows = await userWorkflowsStore.getAllWorkflows();
      for (const workflow of userWorkflows) {
        this.registry.registerWorkflow(workflow as Workflow);
      }
      logger.info(`Loaded ${userWorkflows.length} user workflows`);

      // Subscribe to storage changes to keep registry updated
      this.subscribeToStorageChanges();

      this.initialized = true;
      logger.info('Workflow service initialized');
    } catch (error) {
      logger.error('Failed to initialize Workflow service:', error);
    }
  }

  /**
   * Subscribe to storage changes to sync registry with storage
   */
  private subscribeToStorageChanges(): void {
    // Listen for chrome storage changes
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes['user-workflows']) {
        const newRecord = changes['user-workflows'].newValue as { workflows: Record<string, Workflow> };
        const oldRecord = changes['user-workflows'].oldValue as { workflows: Record<string, Workflow> } | undefined;

        logger.info('Workflow storage changed, syncing registry...');

        // Clear and reload all workflows from new storage value
        this.registry.clear();
        if (newRecord?.workflows) {
          for (const workflow of Object.values(newRecord.workflows)) {
            this.registry.registerWorkflow(workflow as Workflow);
          }
          logger.info(`Registry synced with ${Object.keys(newRecord.workflows).length} workflows`);
        }
      }
    });
  }

  /**
   * Get workflow registry
   */
  getRegistry(): WorkflowRegistry {
    return this.registry;
  }

  /**
   * Execute a workflow - always fetches latest from storage
   */
  async executeWorkflow(
    workflowId: string,
    tabId: number,
    params: Record<string, unknown> = {},
    actionExecutor?: (action: string, params: Record<string, unknown>) => Promise<ActionResult>,
    aiInvoker?: (prompt: string, context?: Record<string, unknown>) => Promise<AIResult>,
  ): Promise<WorkflowResult> {
    // Always fetch latest workflow from storage to ensure we have the most recent version
    const latestWorkflow = await userWorkflowsStore.getWorkflow(workflowId);
    if (!latestWorkflow) {
      return {
        workflowId,
        success: false,
        results: [],
        error: `Workflow not found: ${workflowId}`,
        duration: 0,
      };
    }

    // Update registry with latest version
    this.registry.registerWorkflow(latestWorkflow as Workflow);

    // Create execution context
    const context = new WorkflowExecutionContextImpl(tabId, actionExecutor, aiInvoker);

    // Set initial variables from params
    for (const [key, value] of Object.entries(params)) {
      context.setVariable(key, value);
    }

    // Execute workflow
    return this.executor.execute(latestWorkflow as Workflow, context);
  }

  /**
   * List all workflows
   */
  listWorkflows(category?: string): Workflow[] {
    if (category) {
      return this.registry.getWorkflowsByCategory(category);
    }
    return this.registry.getAllWorkflows();
  }

  /**
   * Get workflow info - always fetches latest from storage
   */
  async getWorkflowInfo(workflowId: string): Promise<Workflow | undefined> {
    // Always fetch from storage to get latest version
    const latestWorkflow = await userWorkflowsStore.getWorkflow(workflowId);
    if (latestWorkflow) {
      // Update registry with latest version
      this.registry.registerWorkflow(latestWorkflow as Workflow);
    }
    return latestWorkflow as Workflow | undefined;
  }

  /**
   * Add a user workflow
   */
  async addUserWorkflow(workflow: Workflow): Promise<void> {
    this.registry.registerWorkflow(workflow);
    await userWorkflowsStore.addWorkflow(workflow as Parameters<typeof userWorkflowsStore.addWorkflow>[0]);
  }

  /**
   * Remove a user workflow
   */
  async removeUserWorkflow(workflowId: string): Promise<void> {
    this.registry.unregisterWorkflow(workflowId);
    await userWorkflowsStore.removeWorkflow(workflowId);
  }

  /**
   * Search workflows
   */
  searchWorkflows(query: string): Workflow[] {
    return this.registry.searchWorkflows(query);
  }

  /**
   * Validate workflow structure
   */
  validateStructure(workflow: Workflow): { valid: boolean; errors: string[] } {
    return this.registry.validateStructure(workflow);
  }
}
