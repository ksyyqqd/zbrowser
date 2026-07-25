import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import type { AgentOutput } from '../types';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Actors, ExecutionState } from '@extension/shared';
import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  isAbortedError,
  isAuthenticationError,
  isBadRequestError,
  isForbiddenError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
import { filterExternalContent } from '../messages/utils';
import { normalizeLogContent } from '../requestLogs';
const logger = createLogger('PlannerAgent');

// Define Zod schema for planner output
// 注：某些 LLM（如 qwen3.5-flash）会把多行内容输出成 string[] 而不是 string；
// 这里把所有"自然语言段落"字段都做宽容转换，避免格式不严导致整个规划失败。
const lenientText = z
  .union([
    z.string(),
    z.array(z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])).transform(arr =>
      arr
        .filter(v => v !== null && v !== undefined)
        .map(v => String(v))
        .join('\n'),
    ),
    z.number().transform(String),
    z.boolean().transform(String),
    z.null().transform(() => ''),
    z.undefined().transform(() => ''),
  ])
  .default('');

export const plannerOutputSchema = z.object({
  observation: lenientText,
  challenges: lenientText,
  done: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
  next_steps: lenientText,
  final_answer: lenientText,
  reasoning: lenientText,
  web_task: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
  // 可选：当 Planner 觉得"必须先问用户"才能继续时，结构化地表达提问。
  // 见 executor.runPlanner() 后的分支处理：触发时会暂停任务、弹窗、等用户回答。
  ask_user: z
    .object({
      question: z.string().describe('the question shown to the user'),
      context: z.string().default('').describe('optional extra context'),
      options: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            description: z.string().default(''),
          }),
        )
        .default([]),
      allow_free_text: z.boolean().default(true),
      allow_element_pick: z.boolean().default(false),
    })
    .nullable()
    .optional(),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput> {
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });
  }

  async execute(): Promise<AgentOutput<PlannerOutput>> {
    try {
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...');
      // get all messages from the message manager, state message should be the last one
      const messages = this.context.messageManager.getMessages();
      // Use full message history except the first one
      const plannerMessages = [this.prompt.getSystemMessage(), ...filterPlannerMessages(messages.slice(1))];

      // Remove images from last message if vision is not enabled for planner but vision is enabled
      if (!this.context.options.useVisionForPlanner && this.context.options.useVision) {
        const lastStateMessage = plannerMessages[plannerMessages.length - 1];
        let newMsg = '';

        if (Array.isArray(lastStateMessage.content)) {
          for (const msg of lastStateMessage.content) {
            if (msg.type === 'text') {
              newMsg += msg.text;
            }
            // Skip image_url messages
          }
        } else {
          newMsg = lastStateMessage.content;
        }

        plannerMessages[plannerMessages.length - 1] = new HumanMessage(newMsg);
      }

      let rawOutput = '';
      try {
        rawOutput = await this.streamRawModelOutput(plannerMessages, delta => {
          this.context.emitEvent(Actors.PLANNER, ExecutionState.STREAM_DELTA, delta);
        });
      } finally {
        this.context.emitEvent(Actors.PLANNER, ExecutionState.STREAM_END, '');
      }

      let modelOutput = this.manuallyParseResponse(rawOutput);
      if (modelOutput) {
        await this.recordRequestLog({
          inputMessages: plannerMessages,
          phase: 'stream',
          parseStatus: 'success',
          responseContent: rawOutput,
        });
      } else {
        await this.recordRequestLog({
          inputMessages: plannerMessages,
          phase: 'stream',
          parseStatus: 'failed',
          responseContent: rawOutput,
          error: normalizeLogContent('Failed to parse planner output from streamed response', 4000),
        });
        logger.warning('[planner] stream parse failed, retrying with structured invoke');
        try {
          modelOutput = await this.invoke(plannerMessages);
        } catch (retryError) {
          logger.warning('[planner] structured retry failed', retryError);
        }
      }
      if (!modelOutput) {
        logger.warning(`[planner] raw output preview: ${rawOutput.slice(0, 400)}`);
        throw new Error('Failed to parse planner output');
      }

      // clean the model output
      const observation = filterExternalContent(modelOutput.observation);
      const final_answer = filterExternalContent(modelOutput.final_answer);
      const next_steps = filterExternalContent(modelOutput.next_steps);
      const challenges = filterExternalContent(modelOutput.challenges);
      const reasoning = filterExternalContent(modelOutput.reasoning);

      const cleanedPlan: PlannerOutput = {
        ...modelOutput,
        observation,
        challenges,
        reasoning,
        final_answer,
        next_steps,
      };

      // If task is done, emit the final answer; otherwise emit next steps
      const eventMessage = cleanedPlan.done ? cleanedPlan.final_answer : cleanedPlan.next_steps;
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, eventMessage);
      logger.info('Planner output', JSON.stringify(cleanedPlan, null, 2));

      return {
        id: this.id,
        result: cleanedPlan,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError(errorMessage, error);
      } else if (isBadRequestError(error)) {
        throw new ChatModelBadRequestError(errorMessage, error);
      } else if (isAbortedError(error)) {
        throw new RequestCancelledError(errorMessage);
      } else if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      }

      logger.error(`Planning failed: ${errorMessage}`);
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_FAIL, `Planning failed: ${errorMessage}`);
      return {
        id: this.id,
        error: errorMessage,
      };
    }
  }
}

function filterPlannerMessages(
  messages: ReturnType<typeof Array.prototype.slice>,
): ReturnType<typeof Array.prototype.slice> {
  return messages.filter(message => {
    if (message instanceof ToolMessage) {
      return false;
    }

    if ('tool_calls' in message && Array.isArray((message as { tool_calls?: unknown[] }).tool_calls)) {
      return false;
    }

    return true;
  });
}
