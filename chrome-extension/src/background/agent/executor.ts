import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import { type ActionResult, AgentContext, type AgentOptions, type AgentOutput } from './types';
import { t } from '@extension/i18n';
import { NavigatorAgent, NavigatorActionRegistry } from './agents/navigator';
import { PlannerAgent, type PlannerOutput } from './agents/planner';
import { NavigatorPrompt } from './prompts/navigator';
import { PlannerPrompt } from './prompts/planner';
import { analyzeUserImageWithVisionModel } from './prompts/base';
import { createLogger } from '@src/background/log';
import MessageManager from './messages/service';
import type BrowserContext from '../browser/context';
import { ActionBuilder } from './actions/builder';
import { EventManager } from './event/manager';
import {
  Actors,
  type EventCallback,
  EventType,
  ExecutionState,
  type ClarifyResponse,
  type AskUserPayload,
} from '@extension/shared';
import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  ExtensionConflictError,
  RequestCancelledError,
  MaxStepsReachedError,
  MaxFailuresReachedError,
  ResponseParseError,
} from './agents/errors';
import { URLNotAllowedError } from '../browser/views';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import type { AgentStepHistory } from './history';
import { diagnoseTaskFailure } from './diagnose';
import type { GeneralSettingsConfig } from '@extension/storage';
import { analytics } from '../services/analytics';
import type { ToolExecutionResult, MCPTool } from '@extension/mcp-client';
import type { Skill, SkillExecutionResult } from '@extension/skills';
import type { SkillCreateInput, SkillCreateResult } from '../services/skills/createFromAI';
import type { OrchestrationFrame } from '../services/workflow/orchestrationDepth';
import type {
  WorkflowCreateInput,
  WorkflowCreateResult,
  WorkflowSummary,
  WorkflowUpdateInput,
  WorkflowUpdateResult,
} from '../services/workflow/types';
import { summarizeClarifyResponse } from './clarify';
import { extractJsonFromModelOutput } from './messages/utils';

const logger = createLogger('Executor');

export interface ExecutorExtraArgs {
  plannerLLM?: BaseChatModel;
  visionLLM?: BaseChatModel;
  extractorLLM?: BaseChatModel;
  agentOptions?: Partial<AgentOptions>;
  generalSettings?: GeneralSettingsConfig;
  navigatorProvider?: string;
  navigatorModelName?: string;
  plannerProvider?: string;
  plannerModelName?: string;
  visionProvider?: string;
  visionModelName?: string;
  mcpService?: {
    executeTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>;
    listTools: (serverId?: string) => Promise<MCPTool[]>;
    getStatus: (serverId?: string) => Record<string, unknown>;
  };
  skillsService?: {
    executeSkill: (skillId: string, params: Record<string, unknown>, mode?: string) => Promise<SkillExecutionResult>;
    listSkills: (category?: string) => Skill[];
    getSkillInfo: (skillId: string) => Skill | undefined;
    createSkill: (input: SkillCreateInput, createdCount: number) => Promise<SkillCreateResult>;
  };
  /**
   * 工作流能力。由 background 注入，因为要访问 store。
   *
   * 只有「读」和「写」，没有 executeWorkflow —— AI 不执行工作流。
   */
  workflowService?: {
    listWorkflows: () => Promise<WorkflowSummary[]>;
    getWorkflowSummary: (workflowId: string) => Promise<WorkflowSummary | undefined>;
    createWorkflow: (input: WorkflowCreateInput, createdCount: number) => Promise<WorkflowCreateResult>;
    updateWorkflow: (input: WorkflowUpdateInput, updatedCount: number) => Promise<WorkflowUpdateResult>;
  };
  /**
   * 本 Executor 在编排链上的位置。顶层对话不传（等价于空链）；
   * 工作流 ai 节点唤起的 Executor 必须把调用方的链传进来，否则这个 Executor 里
   * 再触发的工作流执行会以为自己是顶层调用，深度守卫失效。
   */
  orchestrationStack?: OrchestrationFrame[];
  // 用户上传的图片
  images?: { name: string; base64: string }[];
}

export class Executor {
  private readonly navigator: NavigatorAgent;
  private readonly planner: PlannerAgent;
  private readonly plannerLLM: BaseChatModel;
  private readonly context: AgentContext;
  private readonly plannerPrompt: PlannerPrompt;
  private readonly navigatorPrompt: NavigatorPrompt;
  private readonly generalSettings: GeneralSettingsConfig | undefined;
  private readonly mcpService?: ExecutorExtraArgs['mcpService'];
  private readonly skillsService?: ExecutorExtraArgs['skillsService'];
  private readonly workflowService?: ExecutorExtraArgs['workflowService'];
  private readonly userImages?: { name: string; base64: string }[]; // 用户上传的图片
  /**
   * 保留 navigator LLM 引用：失败诊断（diagnoseTaskFailure）需要一个能 invoke 的 LLM。
   * 用 navigator 而非 planner，因为 navigator 通常配的是更快/更便宜的模型，
   * 诊断对延迟敏感（用户等失败结果时不希望再等几秒）。
   */
  private readonly navigatorLLM: BaseChatModel;
  private tasks: string[] = [];
  /**
   * shouldReadCurrentPage 的结果缓存，key 为被判定的 task 文本。
   *
   * 该判定只读 task 字符串（prompt 里明确要求「不要检查页面」），而 task 在一轮任务里不变，
   * 所以每 planningInterval 步都重新问一次 LLM 是纯粹的浪费 —— 每次都多一个完整往返。
   * 按 task 缓存后，同一 task 只判定一次；follow-up task 会换 key 自然重新判定。
   */
  private readonly browserStateDecisionCache = new Map<string, boolean>();
  constructor(
    task: string,
    taskId: string,
    browserContext: BrowserContext,
    navigatorLLM: BaseChatModel,
    extraArgs?: Partial<ExecutorExtraArgs>,
  ) {
    const messageManager = new MessageManager();

    const plannerLLM = extraArgs?.plannerLLM ?? navigatorLLM;
    const extractorLLM = extraArgs?.extractorLLM ?? navigatorLLM;
    const visionLLM = extraArgs?.visionLLM ?? navigatorLLM;
    const eventManager = new EventManager();
    const context = new AgentContext(
      taskId,
      browserContext,
      messageManager,
      eventManager,
      extraArgs?.agentOptions ?? {},
      extraArgs?.navigatorProvider ?? '',
      extraArgs?.navigatorModelName ?? '',
      extraArgs?.plannerProvider ?? '',
      extraArgs?.plannerModelName ?? '',
      extraArgs?.visionProvider ?? '',
      extraArgs?.visionModelName ?? '',
    );

    // Set vision LLM on context for use in prompts
    if (visionLLM) {
      context.visionLLM = visionLLM;
    }

    this.generalSettings = extraArgs?.generalSettings;
    this.mcpService = extraArgs?.mcpService;
    this.skillsService = extraArgs?.skillsService;
    this.workflowService = extraArgs?.workflowService;
    this.userImages = extraArgs?.images; // 存储用户上传的图片
    this.plannerLLM = plannerLLM;
    this.navigatorLLM = navigatorLLM; // 用于失败诊断
    this.tasks.push(task);
    this.navigatorPrompt = new NavigatorPrompt({
      maxActionsPerStep: context.options.maxActionsPerStep,
      autonomousMode: extraArgs?.generalSettings?.autonomousMode ?? false,
    });
    this.plannerPrompt = new PlannerPrompt(extraArgs?.generalSettings?.autonomousMode ?? false);

    // Set MCP service methods on context if provided
    if (extraArgs?.mcpService) {
      context.executeMCPTool = extraArgs.mcpService.executeTool.bind(extraArgs.mcpService);
      context.listMCPTools = extraArgs.mcpService.listTools.bind(extraArgs.mcpService);
      // Wrap synchronous getStatus in async function
      context.getMCPStatus = async (serverId?: string) => extraArgs.mcpService!.getStatus(serverId);
    }

    // Set Skills service methods on context if provided
    if (extraArgs?.skillsService) {
      context.executeSkill = (skillId: string, params: Record<string, unknown>, mode?: string) =>
        extraArgs.skillsService!.executeSkill(skillId, params, mode);
      context.listSkills = async (category?: string) => extraArgs.skillsService!.listSkills(category);
      // Wrap synchronous getSkillInfo in async function
      context.getSkillInfo = async (skillId: string) => extraArgs.skillsService!.getSkillInfo(skillId);
      context.createSkill = (input, createdCount) => extraArgs.skillsService!.createSkill(input, createdCount);
    }

    // Set Workflow service methods on context if provided
    if (extraArgs?.workflowService) {
      context.listWorkflows = () => extraArgs.workflowService!.listWorkflows();
      context.getWorkflowSummary = (workflowId: string) => extraArgs.workflowService!.getWorkflowSummary(workflowId);
      context.createWorkflow = (input, createdCount) => extraArgs.workflowService!.createWorkflow(input, createdCount);
      context.updateWorkflow = (input, updatedCount) => extraArgs.workflowService!.updateWorkflow(input, updatedCount);
    }

    // 编排链：background 在起「工作流 ai 节点」的 Executor 时把调用方的链传下来。
    // 顶层对话没有链，留空数组。
    context.orchestrationStack = extraArgs?.orchestrationStack ?? [];

    const actionBuilder = new ActionBuilder(context, extractorLLM);
    const navigatorActionRegistry = new NavigatorActionRegistry(actionBuilder.buildDefaultActions());

    // Register MCP actions if MCP service is available
    if (extraArgs?.mcpService) {
      const mcpActions = actionBuilder.buildMCPActions();
      for (const action of mcpActions) {
        navigatorActionRegistry.registerAction(action);
      }
    }

    // Register Skills actions if Skills service is available
    if (extraArgs?.skillsService) {
      const skillActions = actionBuilder.buildSkillActions();
      for (const action of skillActions) {
        navigatorActionRegistry.registerAction(action);
      }
    }

    // Register Workflow actions if Workflow service is available
    if (extraArgs?.workflowService) {
      const workflowActions = actionBuilder.buildWorkflowActions();
      for (const action of workflowActions) {
        navigatorActionRegistry.registerAction(action);
      }
    }

    // Initialize agents with their respective prompts
    this.navigator = new NavigatorAgent(navigatorActionRegistry, {
      chatLLM: navigatorLLM,
      context: context,
      prompt: this.navigatorPrompt,
    });

    this.planner = new PlannerAgent({
      chatLLM: plannerLLM,
      context: context,
      prompt: this.plannerPrompt,
    });

    this.context = context;
    // Initialize message history (传递用户上传的图片和视觉模型)
    this.context.messageManager.initTaskMessages(
      this.navigatorPrompt.getSystemMessage(),
      task,
      undefined,
      this.userImages,
      visionLLM,
    );
    // Note: MCP/Skills info will be injected at the start of execute() method
  }

  /**
   * Inject MCP tools information into the agent context
   */
  private async injectMCPToolsInfo(mcpService: { listTools: () => Promise<unknown[]> }): Promise<void> {
    try {
      const tools = await mcpService.listTools();
      if (tools && tools.length > 0) {
        const toolsInfo = this.formatMCPToolsInfo(tools);
        // Add as a human message to inform the agent about available tools
        const mcpInfoMessage = new HumanMessage({ content: toolsInfo });
        this.context.messageManager.addMessageWithTokens(mcpInfoMessage, 'mcp_tools');
        logger.info(`Injected ${tools.length} MCP tools into agent context`);
      }
    } catch (error) {
      logger.warning('Failed to inject MCP tools info:', error);
    }
  }

  /**
   * Inject Skills information into the agent context
   */
  private async injectSkillsInfo(skillsService: { listSkills: () => unknown[] }): Promise<void> {
    try {
      const skills = skillsService.listSkills();
      if (skills && skills.length > 0) {
        const skillsInfo = this.formatSkillsInfo(skills);
        // Add as a human message to inform the agent about available skills
        const skillsInfoMessage = new HumanMessage({ content: skillsInfo });
        this.context.messageManager.addMessageWithTokens(skillsInfoMessage, 'skills');
        logger.info(`Injected ${skills.length} skills into agent context`);
      }
    } catch (error) {
      logger.warning('Failed to inject skills info:', error);
    }
  }

  /**
   * Inject Workflow information into the agent context.
   *
   * 只注入摘要（名字 + 说明），不注入入参和步骤 —— 那些由 `workflow_get_info` 按需取。
   * 一次性把所有工作流的完整信息铺进上下文，在用户有十几个工作流时是几千 token 的
   * 常驻开销，而 AI 每轮任务通常只关心其中一个。
   */
  private async injectWorkflowsInfo(workflowService: {
    listWorkflows: () => Promise<WorkflowSummary[]>;
  }): Promise<void> {
    try {
      const workflows = await workflowService.listWorkflows();
      if (workflows.length === 0) {
        return;
      }
      const listing = workflows
        .map(w => `- ${w.id}: ${w.name}${w.description ? ` - ${w.description}` : ''}`)
        .join('\n');
      const content = `<workflows_available>
用户已保存的工作流（固定步骤图，顺序已定死，执行时不再重新决策）：

${listing}

你不能执行工作流 —— 只有用户能在界面上点击运行。你能做的是：
- 用户要改某个工作流时，先 workflow_get_info 看清它现在是什么，再 workflow_update
- 用户描述了一套可重复的步骤时，用 workflow_create 存下来，然后告诉用户去确认
用户要你「跑一下某个工作流」时，不要试图调用它，也不要手工重演它的步骤，
直接告诉用户在工作流列表里点击执行。
</workflows_available>`;
      this.context.messageManager.addMessageWithTokens(new HumanMessage({ content }), 'workflows');
      logger.info(`Injected ${workflows.length} workflows into agent context`);
    } catch (error) {
      logger.warning('Failed to inject workflows info:', error);
    }
  }

  /**
   * Analyze user-uploaded images with vision model and inject analysis results
   */
  private async injectUserImagesAnalysis(): Promise<void> {
    if (!this.userImages || this.userImages.length === 0) {
      return;
    }

    if (!this.context.visionLLM) {
      // No separate vision model, images will be sent directly to Navigator
      // This is handled in MessageManager.taskInstructions
      logger.info('No separate vision model, user images will be sent directly to Navigator');
      return;
    }

    logger.info(`Analyzing ${this.userImages.length} user-uploaded images with vision model`);

    try {
      const analysisResults: string[] = [];

      for (const img of this.userImages) {
        const analysis = await analyzeUserImageWithVisionModel(img.base64, img.name, this.context.visionLLM);
        analysisResults.push(`\n[Analysis of user image: ${img.name}]\n${analysis}`);
      }

      // Add analysis results as a human message
      const analysisMessage = new HumanMessage({
        content: `The user has provided the following images for this task:\n${analysisResults.join('\n')}\n\nPlease use this visual analysis information to help complete the task.`,
      });
      this.context.messageManager.addMessageWithTokens(analysisMessage, 'user_images_analysis');
      logger.info('User images analysis injected into agent context');
    } catch (error) {
      logger.error('Failed to analyze user images:', error);
    }
  }

  /**
   * Format MCP tools info as a message
   */
  private formatMCPToolsInfo(tools: unknown[]): string {
    const toolList = tools
      .map(t => {
        const tool = t as { serverId: string; name: string; description: string };
        return `- ${tool.serverId}/${tool.name}: ${tool.description}`;
      })
      .join('\n');

    return `<mcp_tools_available>
以下MCP工具已连接并可用。你可以直接使用它们来完成任务：

${toolList}

使用方法：使用 mcp_tool 动作执行MCP工具。
示例：
{"action": [{"mcp_tool": {"intent": "获取天气信息", "server_id": "server-id", "tool_name": "tool-name", "arguments": {"key": "value"}}}]}

参数说明：
- server_id: MCP服务器ID
- tool_name: 工具名称
- arguments: 工具参数（对象格式）
</mcp_tools_available>`;
  }

  /**
   * Format Skills info as a message
   */
  private formatSkillsInfo(skills: unknown[]): string {
    const skillList = skills
      .map(s => {
        const skill = s as { id: string; name: string; description: string };
        return `- ${skill.id}: ${skill.name} - ${skill.description}`;
      })
      .join('\n');

    return `<skills_available>
以下技能模板可用：

${skillList}

使用方法：使用 skill_invoke 动作执行技能。
示例：
{"action": [{"skill_invoke": {"intent": "执行技能", "skill_id": "skill-id", "parameters": {"key": "value"}}}]}

参数说明：
- skill_id: 技能ID
- parameters: 技能参数（对象格式）
- execution_mode: 可选，"expanded"或"atomic"
</skills_available>`;
  }

  subscribeExecutionEvents(callback: EventCallback): void {
    this.context.eventManager.subscribe(EventType.EXECUTION, callback);
  }

  clearExecutionEvents(): void {
    // Clear all execution event listeners
    this.context.eventManager.clearSubscribers(EventType.EXECUTION);
  }

  addFollowUpTask(task: string): void {
    this.tasks.push(task);
    this.context.messageManager.addNewTask(task);

    // need to reset previous action results that are not included in memory
    this.context.actionResults = this.context.actionResults.filter(result => result.includeInMemory);
  }

  /**
   * Check if task is complete based on planner output and handle completion
   */
  private checkTaskCompletion(planOutput: AgentOutput<PlannerOutput> | null): boolean {
    if (planOutput?.result?.done) {
      logger.info('✅ Planner confirms task completion');
      if (planOutput.result.final_answer) {
        this.context.finalAnswer = planOutput.result.final_answer;
      }
      return true;
    }
    return false;
  }

  /**
   * Execute the task
   *
   * @returns {Promise<void>}
   */
  async execute(): Promise<void> {
    logger.info(`🚀 Executing task: ${this.tasks[this.tasks.length - 1]}`);
    // reset the step counter
    const context = this.context;
    context.nSteps = 0;
    const allowedMaxSteps = this.context.options.maxSteps;
    let navigatorCompleted = false;

    try {
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_START, this.context.taskId);

      // Analyze user-uploaded images with vision model FIRST
      await this.injectUserImagesAnalysis();

      // Inject MCP tools and Skills info into agent context before starting
      if (this.mcpService) {
        await this.injectMCPToolsInfo(this.mcpService);
      }
      if (this.skillsService) {
        await this.injectSkillsInfo(this.skillsService);
      }
      if (this.workflowService) {
        await this.injectWorkflowsInfo(this.workflowService);
      }

      // Track task start
      void analytics.trackTaskStart(this.context.taskId);

      let step = 0;
      let latestPlanOutput: AgentOutput<PlannerOutput> | null = null;
      let shouldReadBrowserState = true;
      let navigatorDone = false;

      for (step = 0; step < allowedMaxSteps; step++) {
        context.stepInfo = {
          stepNumber: context.nSteps,
          maxSteps: context.options.maxSteps,
        };

        logger.info(`🔄 Step ${step + 1} / ${allowedMaxSteps}`);
        if (await this.shouldStop()) {
          break;
        }

        // 「跳过当前步」检查：用户在 UI 上按了「跳过此步」时，bg port 'skip_step' 会把
        // context.skipRequested 置 true。在这里 step 边界消费它：
        //  - 不进入 planner / navigator 调用，避免打断已派发的 LLM 请求
        //  - 仍然 nSteps++ 防止死循环（同样的 step 反复跳）
        if (context.skipRequested) {
          context.skipRequested = false;
          context.nSteps++;
          this.context.emitEvent(Actors.SYSTEM, ExecutionState.STEP_CANCEL, '⏭ 用户跳过本步');
          continue;
        }

        // Run planner periodically for guidance
        if (this.planner && (context.nSteps % context.options.planningInterval === 0 || navigatorDone)) {
          navigatorDone = false;
          const plannerRun = await this.runPlanner();
          latestPlanOutput = plannerRun.planOutput;
          shouldReadBrowserState = plannerRun.shouldReadBrowserState;
          if (!latestPlanOutput) {
            continue;
          }

          // 若 Planner 主动提出要问用户，弹窗等回应；用户回应后会作为新的 HumanMessage 注入
          // 下一轮的 message history，让 Planner 在下次迭代里能基于回答继续。
          // 自主模式下：将 ask_user 转换为 done=true + needs_clarification，不再盲目继续
          if (latestPlanOutput?.result?.ask_user) {
            if (this.generalSettings?.autonomousMode) {
              logger.info('[autonomous] Planner asked user but autonomous mode is on — marking as needs_clarification');
              // 自主模式下将 ask_user 请求转换为明确的完成状态，需要用户澄清
              latestPlanOutput.result.done = true;
              latestPlanOutput.result.done_reason = 'needs_clarification';
              latestPlanOutput.result.final_answer = `需要您的澄清：${latestPlanOutput.result.ask_user.question}`;
              latestPlanOutput.result.next_steps = '';
              // 检查任务完成（实际是等待澄清）
              if (this.checkTaskCompletion(latestPlanOutput)) {
                break;
              }
            } else {
              const handled = await this.handlePlannerAskUser(latestPlanOutput.result.ask_user);
              if (handled === 'abort') {
                break;
              }
              // 不立即 checkTaskCompletion —— 用户的回答可能让 done 失效；让下轮 planner 重新评估
              continue;
            }
          }

          // Check if task is complete after planner run
          if (this.checkTaskCompletion(latestPlanOutput)) {
            break;
          }
        }

        // Execute navigator
        navigatorDone = await this.navigate(shouldReadBrowserState);

        // If navigator indicates completion, the next periodic planner run will validate it
        if (navigatorDone) {
          logger.info('🔄 Navigator indicates completion - will be validated by next planner run');
          navigatorCompleted = true;
          break;
        }
      }

      // Determine task completion status
      const isCompleted = navigatorCompleted || latestPlanOutput?.result?.done === true;

      if (isCompleted) {
        // finalAnswer 为空时退回一句通用完成语。原来退回的是 taskId —— 那是个内部
        // 标识符，直接显示在对话流里对用户毫无意义。
        const finalMessage = this.context.finalAnswer || t('exec_task_ok');
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, finalMessage);

        // Track task completion
        void analytics.trackTaskComplete(this.context.taskId);
      } else if (step >= allowedMaxSteps) {
        logger.error('❌ Task failed: Max steps reached');
        await this.emitFailDiagnosis(t('exec_errors_maxStepsReached'));
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_errors_maxStepsReached'));

        // Track task failure with specific error category
        const maxStepsError = new MaxStepsReachedError(t('exec_errors_maxStepsReached'));
        const errorCategory = analytics.categorizeError(maxStepsError);
        void analytics.trackTaskFailed(this.context.taskId, errorCategory);
      } else if (this.context.stopped) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_task_cancel'));

        // Track task cancellation
        void analytics.trackTaskCancelled(this.context.taskId);
      } else {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_PAUSE, t('exec_task_pause'));
        // Note: We don't track pause as it's not a final state
      }
    } catch (error) {
      if (error instanceof RequestCancelledError) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_task_cancel'));

        // Track task cancellation
        void analytics.trackTaskCancelled(this.context.taskId);
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.emitFailDiagnosis(errorMessage);
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_task_fail', [errorMessage]));

        // Track task failure with detailed error categorization
        const errorCategory = analytics.categorizeError(error instanceof Error ? error : errorMessage);
        void analytics.trackTaskFailed(this.context.taskId, errorCategory);
      }
    } finally {
      if (import.meta.env.DEV) {
        logger.debug('Executor history', JSON.stringify(this.context.history, null, 2));
      }
      // 始终保存 agent step history，供「重播」功能回放使用
      const historyString = JSON.stringify(this.context.history);
      logger.info(`Executor history size: ${historyString.length}`);
      await chatHistoryStore.storeAgentStepHistory(this.context.taskId, this.tasks[0], historyString);
    }
  }

  /**
   * Helper method to run planner and store its output
   */
  private async runPlanner(): Promise<{
    planOutput: AgentOutput<PlannerOutput> | null;
    shouldReadBrowserState: boolean;
  }> {
    const context = this.context;
    try {
      const shouldReadBrowserState = await this.shouldReadCurrentPage();
      logger.info(`[planner] browser state required: ${shouldReadBrowserState ? 'yes' : 'no'}`);

      let positionForPlan = 0;
      if (shouldReadBrowserState) {
        await this.navigator.addStateMessageToMemory();
      }
      if (this.tasks.length > 1 || this.context.nSteps > 0) {
        positionForPlan = this.context.messageManager.length() - 1;
      } else {
        positionForPlan = this.context.messageManager.length();
      }

      // Execute planner
      const planOutput = await this.planner.execute();
      if (planOutput.result) {
        this.context.messageManager.addPlan(JSON.stringify(planOutput.result), positionForPlan);

        // 检测 observation 相似度，防止无限循环
        const observation = planOutput.result.observation || '';
        if (observation.trim()) {
          this.context.recentObservations.push({
            observation: observation.trim(),
            step: this.context.nSteps,
          });

          // 只保留最近 5 次
          if (this.context.recentObservations.length > 5) {
            this.context.recentObservations = this.context.recentObservations.slice(-5);
          }

          // 检查最近 3 次是否相似
          if (this.context.recentObservations.length >= 3) {
            const recent3 = this.context.recentObservations.slice(-3);
            const isSimilar = this.checkObservationSimilarity(recent3.map(r => r.observation));

            if (isSimilar) {
              const warningMsg = new HumanMessage({
                content: `[System warning] You've made similar observations 3 times in a row (steps ${recent3.map(r => r.step).join(', ')}). Consider a different approach or mark the task as blocked if you cannot make progress.`,
              });
              this.context.messageManager.addMessageWithTokens(warningMsg, 'system_warning');
              logger.warning(
                `[planner] loop detected - similar observations at steps: ${recent3.map(r => r.step).join(', ')}`,
              );
            }
          }
        }
      }
      return { planOutput, shouldReadBrowserState };
    } catch (error) {
      logger.error(`Failed to execute planner: ${error}`);
      if (
        error instanceof ChatModelAuthError ||
        error instanceof ChatModelBadRequestError ||
        error instanceof ChatModelForbiddenError ||
        error instanceof URLNotAllowedError ||
        error instanceof RequestCancelledError ||
        error instanceof ExtensionConflictError
      ) {
        throw error;
      }
      if (error instanceof ResponseParseError) {
        context.consecutiveFailures++;
        const errorMessage = error.message || 'Failed to parse planner output';
        const isFinalAttempt = context.consecutiveFailures >= context.options.maxFailures;
        logger.warning(
          `[planner] parse failed (attempt ${context.consecutiveFailures}/${context.options.maxFailures}): ${errorMessage}`,
        );
        if (isFinalAttempt) {
          this.context.emitEvent(
            Actors.PLANNER,
            ExecutionState.STEP_FAIL,
            `Planning failed after ${context.options.maxFailures} parse attempts: ${errorMessage}`,
          );
          throw new MaxFailuresReachedError(errorMessage);
        }
        return { planOutput: null, shouldReadBrowserState: true };
      }
      context.consecutiveFailures++;
      logger.error(`Failed to execute planner: ${error}`);
      if (context.consecutiveFailures >= context.options.maxFailures) {
        throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'));
      }
      return { planOutput: null, shouldReadBrowserState: true };
    }
  }

  private async shouldReadCurrentPage(): Promise<boolean> {
    const task = this.tasks[this.tasks.length - 1] || '';
    if (!task.trim()) return false;

    const cached = this.browserStateDecisionCache.get(task);
    if (cached !== undefined) {
      logger.info(`[planner] browser-state decision served from cache: ${cached ? 'yes' : 'no'}`);
      return cached;
    }

    const decisionPrompt = [
      'Decide whether the next planning pass needs live current page/browser state.',
      'Do not inspect the page. Judge only from the user task and conversation intent.',
      'Return only JSON with this shape:',
      '{"needs_browser_state": true, "reason": "short reason"}',
      'Rules:',
      '- true when the task depends on visible page content, element positions, page title, or browser state.',
      '- false when the task can be planned without looking at the current page yet.',
      '',
      `Task: ${task}`,
    ].join('\n');

    try {
      const response = await this.plannerLLM.invoke(decisionPrompt, {
        signal: this.context.controller.signal,
      });
      const rawContent = this.extractRawModelContent(response);
      const decision = this.parseBrowserStateDecision(rawContent, response);
      this.browserStateDecisionCache.set(task, decision);
      return decision;
    } catch (error) {
      logger.warning('[planner] browser-state decision failed, defaulting to yes:', error);
      return true;
    }
  }

  private extractRawModelContent(response: { content?: unknown; tool_calls?: unknown[] }): string {
    if (Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
      const firstToolCall = response.tool_calls[0] as { args?: unknown };
      if (firstToolCall?.args && typeof firstToolCall.args === 'object') {
        return JSON.stringify(firstToolCall.args);
      }
    }

    if (typeof response.content === 'string') {
      return response.content;
    }

    if (Array.isArray(response.content)) {
      return response.content
        .map(part =>
          typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '',
        )
        .join('');
    }

    return '';
  }

  private parseBrowserStateDecision(rawContent: string, response: { tool_calls?: unknown[] }): boolean {
    if (Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
      const firstToolCall = response.tool_calls[0] as { args?: unknown };
      const args = firstToolCall?.args;
      if (args && typeof args === 'object') {
        const needs = (args as Record<string, unknown>).needs_browser_state;
        if (typeof needs === 'boolean') return needs;
        if (typeof needs === 'string') return needs.toLowerCase() === 'true';
      }
    }

    try {
      const parsed = extractJsonFromModelOutput(rawContent);
      const needs = parsed.needs_browser_state;
      if (typeof needs === 'boolean') return needs;
      if (typeof needs === 'string') return needs.toLowerCase() === 'true';
    } catch {
      // fall through
    }

    const lower = rawContent.toLowerCase();
    if (lower.includes('needs_browser_state') && lower.includes('true')) return true;
    if (lower.includes('needs_browser_state') && lower.includes('false')) return false;
    return true;
  }

  private async navigate(useLiveState = true): Promise<boolean> {
    const context = this.context;
    try {
      // Get and execute navigation action
      // check if the task is paused or stopped
      if (context.paused || context.stopped) {
        return false;
      }
      const navOutput = await this.navigator.execute(useLiveState);
      // check if the task is paused or stopped
      if (context.paused || context.stopped) {
        return false;
      }
      context.nSteps++;
      if (navOutput.error) {
        throw new Error(navOutput.error);
      }
      context.consecutiveFailures = 0;
      if (navOutput.result?.done) {
        // Navigator 直接 done 时 planner 不会再跑，finalAnswer 只能从这里拿 —— 否则
        // TASK_OK 会退化成 taskId，用户看不到 done 里的内容。
        // 不覆盖 planner 已给出的 final_answer（planner 的结论经过校验，更可信）。
        if (navOutput.result.finalAnswer && !context.finalAnswer) {
          context.finalAnswer = navOutput.result.finalAnswer;
        }
        return true;
      }
    } catch (error) {
      logger.error(`Failed to execute step: ${error}`);
      if (
        error instanceof ChatModelAuthError ||
        error instanceof ChatModelBadRequestError ||
        error instanceof ChatModelForbiddenError ||
        error instanceof URLNotAllowedError ||
        error instanceof RequestCancelledError ||
        error instanceof ExtensionConflictError
      ) {
        throw error;
      }
      if (error instanceof ResponseParseError) {
        context.consecutiveFailures++;
        const errorMessage = error.message || 'Failed to parse navigator output';
        const isFinalAttempt = context.consecutiveFailures >= context.options.maxFailures;
        logger.warning(
          `[navigator] parse failed (attempt ${context.consecutiveFailures}/${context.options.maxFailures}): ${errorMessage}`,
        );
        if (isFinalAttempt) {
          this.context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.STEP_FAIL,
            `Navigation failed after ${context.options.maxFailures} parse attempts: ${errorMessage}`,
          );
          throw new MaxFailuresReachedError(errorMessage);
        }
        return false;
      }
      context.consecutiveFailures++;
      logger.error(`Failed to execute step: ${error}`);
      if (context.consecutiveFailures >= context.options.maxFailures) {
        throw new MaxFailuresReachedError(t('exec_errors_maxFailuresReached'));
      }
    }
    return false;
  }

  private async shouldStop(): Promise<boolean> {
    if (this.context.stopped) {
      logger.info('Agent stopped');
      return true;
    }

    while (this.context.paused) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (this.context.stopped) {
        return true;
      }
    }

    if (this.context.consecutiveFailures >= this.context.options.maxFailures) {
      logger.error(`Stopping due to ${this.context.options.maxFailures} consecutive failures`);
      return true;
    }

    return false;
  }

  async cancel(): Promise<void> {
    this.context.stop();
  }

  async resume(): Promise<void> {
    this.context.resume();
  }

  async pause(): Promise<void> {
    this.context.pause();
  }

  async cleanup(): Promise<void> {
    try {
      await this.context.browserContext.cleanup();
    } catch (error) {
      logger.error(`Failed to cleanup browser context: ${error}`);
    }
  }

  /**
   * 「跳过当前步」：把 context.skipRequested 置 true。
   * 真正生效在 execute() 主循环 step 边界（见 shouldStop 之后那段 if）。
   * 由 background port 'skip_step' 调用。
   */
  requestSkipStep(): void {
    this.context.skipRequested = true;
    logger.info('[skip] requested by user');
  }

  /**
   * 「修改下一步」：往 message history 注入一条 HumanMessage，作为 planner / navigator
   * 下一轮的额外指令。配合外部的 pause + resume 实现「暂停 → 用户输入 → 恢复」的体验。
   * 由 background port 'amend_next_step' 调用，text 来自 UI。
   */
  async amendNextStep(text: string): Promise<void> {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    this.context.messageManager.addMessageWithTokens(
      new HumanMessage({ content: `[User mid-task instruction] ${trimmed}` }),
      'amend',
    );
    // 广播给前端：消息流里展示一条用户接管痕迹，与 ask_user 摘要呼应
    this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_RESUME, `📝 用户中途指示：${trimmed}`);
    logger.info(`[amend] injected mid-task instruction: ${trimmed.slice(0, 60)}`);
  }

  /**
   * 检查最近 3 次 observation 是否相似，用于检测 Planner 陷入循环。
   * 简单策略：任意两个 observation 之间如果有 70% 以上的字符重叠，视为相似。
   */
  private checkObservationSimilarity(observations: string[]): boolean {
    if (observations.length < 3) return false;

    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalized = observations.map(normalize);

    // 检查任意两个是否相似
    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        const a = normalized[i];
        const b = normalized[j];

        // 简单相似度：计算较短字符串在较长字符串中的包含度
        const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
        if (longer.includes(shorter)) {
          return true;
        }

        // 或者计算编辑距离的相似度
        const similarity = this.calculateStringSimilarity(a, b);
        if (similarity >= 0.7) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 计算两个字符串的相似度（基于最长公共子序列）。
   * 返回 0-1 之间的值，1 表示完全相同。
   */
  private calculateStringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    // 使用简单的字符匹配率
    const setA = new Set(a.split(' '));
    const setB = new Set(b.split(' '));
    const intersection = new Set([...setA].filter(x => setB.has(x)));

    return (2 * intersection.size) / (setA.size + setB.size);
  }

  /**
   * 任务失败前发出诊断事件（TASK_FAIL_DIAGNOSIS）。
   *
   *  - 调 navigator LLM 生成 summary + 3 条建议；超时/失败/无 history 则静默退出
   *  - 紧随其后是真正的 TASK_FAIL，所以前端看到顺序是：
   *      ... → STEP_FAIL → TASK_FAIL_DIAGNOSIS → TASK_FAIL
   *  - 故意 await：诊断完成后再让 TASK_FAIL 走，前端能在同一帧拿到完整信息
   *  - 但加超时（diagnose.ts 内部 15s），避免 LLM 卡死拖延任务结束
   */
  private async emitFailDiagnosis(errorMessage: string): Promise<void> {
    try {
      const task = this.tasks[0] || '';
      if (!task) return;
      // 摘最近 5 步 history（如有）
      const recentSteps: string[] = [];
      const history = this.context.history?.history ?? [];
      for (const item of history.slice(-5)) {
        const out = item.modelOutput || '';
        if (out) recentSteps.push(out.slice(0, 200));
      }
      const diagnosis = await diagnoseTaskFailure(this.navigatorLLM, task, recentSteps, errorMessage);
      if (diagnosis) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL_DIAGNOSIS, JSON.stringify(diagnosis));
      }
    } catch (err) {
      // 诊断本身的错不能影响任务结束
      logger.warning('[emitFailDiagnosis] swallow error:', err);
    }
  }

  /**
   * 把 side-panel 发回来的澄清回应转发到 AgentContext。
   * 由 background port handler 调用。
   */
  resolveClarification(requestId: string, response: ClarifyResponse): boolean {
    return this.context.resolveClarification(requestId, response);
  }

  /**
   * Planner 主动要求向用户澄清时的处理：
   * 1) 发 ASK_USER 事件让 side-panel 弹窗
   * 2) pause executor
   * 3) await 用户回应
   * 4) resume + 把回答塞回 message history（Planner 下轮能看到）
   * 返回 'abort' 表示用户选了"终止任务"，调用方应跳出主循环
   */
  private async handlePlannerAskUser(ask: NonNullable<PlannerOutput['ask_user']>): Promise<'continue' | 'abort'> {
    const requestId = ask.id || crypto.randomUUID();
    const payload: AskUserPayload = {
      requestId,
      source: 'planner',
      question: ask.question,
      context: ask.context || undefined,
      options: ask.options?.length ? ask.options : undefined,
      allowFreeText: ask.allow_free_text,
      allowElementPick: ask.allow_element_pick,
    };
    this.context.emitEvent(Actors.PLANNER, ExecutionState.ASK_USER, JSON.stringify(payload));
    await this.context.pause();
    let resp: ClarifyResponse;
    try {
      resp = await this.context.waitForClarification(requestId);
    } finally {
      await this.context.resume();
    }
    if (resp.pickedSelector || resp.pickedXpath) {
      this.context.pendingPickedHints.push({
        purpose: ask.question || 'User picked element',
        selector: resp.pickedSelector,
        stableSelector: resp.pickedStableSelector,
        xpath: resp.pickedXpath,
        textContent: resp.pickedText,
      });
      this.context.skipNextElementGateForPickedHint = true;
    }
    const summary = summarizeClarifyResponse(resp);
    // 使用新的追踪方法，带上请求 ID 和问题
    this.context.messageManager.addClarification(requestId, summary, ask.question);
    this.context.emitEvent(Actors.PLANNER, ExecutionState.ASK_USER_RESOLVED, summary);
    if (resp.abortTask) {
      await this.context.stop();
      return 'abort';
    }
    return 'continue';
  }

  async getCurrentTaskId(): Promise<string> {
    return this.context.taskId;
  }

  /**
   * Replays a saved history of actions with error handling and retry logic.
   *
   * @param history - The history to replay
   * @param maxRetries - Maximum number of retries per action
   * @param skipFailures - Whether to skip failed actions or stop execution
   * @param delayBetweenActions - Delay between actions in seconds
   * @returns List of action results
   */
  async replayHistory(
    sessionId: string,
    maxRetries = 3,
    skipFailures = true,
    delayBetweenActions = 2.0,
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const replayLogger = createLogger('Executor:replayHistory');

    logger.info('replay task', this.tasks[0]);

    try {
      const historyFromStorage = await chatHistoryStore.loadAgentStepHistory(sessionId);
      if (!historyFromStorage) {
        throw new Error(t('exec_replay_historyNotFound'));
      }

      const history = JSON.parse(historyFromStorage.history) as AgentStepHistory;
      if (history.history.length === 0) {
        throw new Error(t('exec_replay_historyEmpty'));
      }
      logger.debug(`🔄 Replaying history: ${JSON.stringify(history, null, 2)}`);
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_START, this.context.taskId);

      for (let i = 0; i < history.history.length; i++) {
        const historyItem = history.history[i];

        // Check if execution should stop
        if (this.context.stopped) {
          replayLogger.info('Replay stopped by user');
          break;
        }

        // Execute the history step with enhanced method that handles all the logic
        const stepResults = await this.navigator.executeHistoryStep(
          historyItem,
          i,
          history.history.length,
          maxRetries,
          delayBetweenActions * 1000,
          skipFailures,
        );

        results.push(...stepResults);

        // If stopped during execution, break the loop
        if (this.context.stopped) {
          break;
        }
      }

      if (this.context.stopped) {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_CANCEL, t('exec_replay_cancel'));
      } else {
        this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_OK, t('exec_replay_ok'));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      replayLogger.error(`Replay failed: ${errorMessage}`);
      this.context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, t('exec_replay_fail', [errorMessage]));
    }

    return results;
  }
}
