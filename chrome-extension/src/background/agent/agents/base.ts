import type { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentContext, AgentOutput } from '../types';
import type { BasePrompt } from '../prompts/base';
import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import { createLogger } from '@src/background/log';
import type { Action } from '../actions/builder';
import {
  convertInputMessages,
  deepParseJsonStrings,
  extractJsonFromModelOutput,
  removeThinkTags,
} from '../messages/utils';
import { isAbortedError, ResponseParseError } from './errors';
import { ProviderTypeEnum } from '@extension/storage';
import { appendAgentRequestLog, serializeMessagesForLog } from '../requestLogs';

const logger = createLogger('agent');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CallOptions = Record<string, any>;

// Update options to use Zod schema
export interface BaseAgentOptions {
  chatLLM: BaseChatModel;
  context: AgentContext;
  prompt: BasePrompt;
  provider?: string;
}
export interface ExtraAgentOptions {
  id?: string;
  toolCallingMethod?: string;
  callOptions?: CallOptions;
}

/**
 * Base class for all agents
 * @param T - The Zod schema for the model output
 * @param M - The type of the result field of the agent output
 */
export abstract class BaseAgent<T extends z.ZodType, M = unknown> {
  protected id: string;
  protected chatLLM: BaseChatModel;
  protected prompt: BasePrompt;
  protected context: AgentContext;
  protected actions: Record<string, Action> = {};
  protected modelOutputSchema: T;
  protected toolCallingMethod: string | null;
  protected chatModelLibrary: string;
  protected modelName: string;
  protected provider: string;
  protected withStructuredOutput: boolean;
  protected callOptions?: CallOptions;
  protected modelOutputToolName: string;
  declare ModelOutput: z.infer<T>;

  constructor(modelOutputSchema: T, options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    // base options
    this.modelOutputSchema = modelOutputSchema;
    this.chatLLM = options.chatLLM;
    this.prompt = options.prompt;
    this.context = options.context;
    this.provider = options.provider || '';
    // TODO: fix this, the name is not correct in production environment
    this.chatModelLibrary = this.chatLLM.constructor.name;
    this.modelName = this.getModelName();
    this.withStructuredOutput = this.setWithStructuredOutput();
    // extra options
    this.id = extraOptions?.id || 'agent';
    this.toolCallingMethod = this.setToolCallingMethod(extraOptions?.toolCallingMethod);
    this.callOptions = extraOptions?.callOptions;
    this.modelOutputToolName = `${this.id}_output`;
  }

  // Set the model name
  private getModelName(): string {
    if ('modelName' in this.chatLLM) {
      return this.chatLLM.modelName as string;
    }
    if ('model_name' in this.chatLLM) {
      return this.chatLLM.model_name as string;
    }
    if ('model' in this.chatLLM) {
      return this.chatLLM.model as string;
    }
    return 'Unknown';
  }

  // Set the tool calling method
  private setToolCallingMethod(toolCallingMethod?: string): string | null {
    if (toolCallingMethod === 'auto') {
      switch (this.chatModelLibrary) {
        case 'ChatGoogleGenerativeAI':
          return null;
        case 'ChatOpenAI':
        case 'AzureChatOpenAI':
        case 'ChatGroq':
        case 'ChatXAI':
          return 'function_calling';
        default:
          return null;
      }
    }
    return toolCallingMethod || null;
  }

  // Check if model is a Llama model (only for Llama-specific handling)
  private isLlamaModel(modelName: string): boolean {
    return modelName.includes('Llama-4') || modelName.includes('Llama-3.3') || modelName.includes('llama-3.3');
  }

  // Check if model is a Qwen model — Qwen API rejects structured output arguments format
  private isQwenModel(modelName: string): boolean {
    return modelName.toLowerCase().includes('qwen');
  }

  // Some DeepSeek thinking models reject tool_choice when structured output is enabled.
  private isDeepSeekThinkingModel(modelName: string): boolean {
    const normalized = modelName.toLowerCase();
    return normalized.includes('deepseek') && (normalized.includes('flash') || normalized.includes('thinking'));
  }

  protected buildRequestLogContent(inputMessages: BaseMessage[]): string {
    return serializeMessagesForLog(convertInputMessages(inputMessages, this.modelName));
  }

  protected stringifyResponseContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map(item => {
          if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'text' && 'text' in item) {
            return String(item.text);
          }
          return JSON.stringify(item);
        })
        .join('\n');
    }

    if (content == null) {
      return '';
    }

    if (typeof content === 'object') {
      try {
        return JSON.stringify(content);
      } catch {
        return String(content);
      }
    }

    return String(content);
  }

  protected async recordRequestLog(params: {
    inputMessages: BaseMessage[];
    phase: 'stream' | 'structured' | 'manual';
    parseStatus: 'success' | 'failed';
    responseContent?: string;
    error?: string;
  }): Promise<void> {
    try {
      await appendAgentRequestLog({
        taskId: this.context.taskId,
        agent: this.id,
        modelName: this.modelName,
        phase: params.phase,
        parseStatus: params.parseStatus,
        requestContent: this.buildRequestLogContent(params.inputMessages),
        responseContent: params.responseContent ?? '',
        error: params.error,
      });
    } catch (error) {
      logger.warning(`[${this.modelName}] failed to append request log`, error);
    }
  }

  // Set whether to use structured output based on the model name
  private setWithStructuredOutput(): boolean {
    if (this.modelName === 'deepseek-reasoner' || this.modelName === 'deepseek-r1') {
      return false;
    }

    if (this.isDeepSeekThinkingModel(this.modelName)) {
      logger.debug(
        `[${this.modelName}] DeepSeek thinking model doesn't support structured output tool_choice, using manual JSON extraction`,
      );
      return false;
    }

    // Llama API models don't support json_schema response format
    if (this.provider === ProviderTypeEnum.Llama || this.isLlamaModel(this.modelName)) {
      logger.debug(`[${this.modelName}] Llama API doesn't support structured output, using manual JSON extraction`);
      return false;
    }

    // Qwen models (via DashScope/CustomOpenAI) reject the arguments format in structured output tool calls
    // Error: "The arguments parameter of the code model must be in JSON format"
    if (this.isQwenModel(this.modelName)) {
      logger.debug(`[${this.modelName}] Qwen API doesn't support structured output, using manual JSON extraction`);
      return false;
    }

    return true;
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    // Use structured output
    if (this.withStructuredOutput) {
      logger.debug(`[${this.modelName}] Preparing structured output call with schema:`, {
        schemaName: this.modelOutputToolName,
        messageCount: inputMessages.length,
        modelProvider: this.provider,
      });

      const structuredLlm = this.chatLLM.withStructuredOutput(this.modelOutputSchema, {
        includeRaw: true,
        name: this.modelOutputToolName,
      });

      let response = undefined;
      let failureLogged = false;
      try {
        logger.debug(`[${this.modelName}] Invoking LLM with structured output...`);
        response = await structuredLlm.invoke(inputMessages, {
          signal: this.context.controller.signal,
          ...this.callOptions,
        });

        logger.debug(`[${this.modelName}] LLM response received:`, {
          hasParsed: !!response.parsed,
          hasRaw: !!response.raw,
          rawContent: response.raw?.content?.slice(0, 500) + (response.raw?.content?.length > 500 ? '...' : ''),
        });

        if (response.parsed) {
          await this.recordRequestLog({
            inputMessages,
            phase: 'structured',
            parseStatus: 'success',
            responseContent: this.stringifyResponseContent(response.raw?.content),
          });
          logger.debug(`[${this.modelName}] Successfully parsed structured output`);
          return response.parsed;
        }
        await this.recordRequestLog({
          inputMessages,
          phase: 'structured',
          parseStatus: 'failed',
          responseContent: this.stringifyResponseContent(response.raw?.content),
          error: 'Could not parse response with structured output',
        });
        failureLogged = true;
        logger.error('Failed to parse response', response);
        throw new Error('Could not parse response with structured output');
      } catch (error) {
        if (isAbortedError(error)) {
          throw error;
        }

        // DeepSeek thinking models and some other providers reject tool_choice under structured output.
        // Fall back to the manual JSON path instead of surfacing a hard failure.
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('Thinking mode does not support this tool_choice') ||
          (errorMessage.includes('tool_choice') && errorMessage.includes('thinking'))
        ) {
          logger.warning(
            `[${this.modelName}] Structured output is not compatible with this model/runtime, falling back to manual JSON extraction`,
          );
          return this.invokeWithManualJsonExtraction(inputMessages);
        }

        // Try to extract JSON from raw response manually if possible
        if (
          errorMessage.includes('is not valid JSON') &&
          response?.raw?.content &&
          typeof response.raw.content === 'string'
        ) {
          const parsed = this.manuallyParseResponse(response.raw.content);
          if (parsed) {
            await this.recordRequestLog({
              inputMessages,
              phase: 'structured',
              parseStatus: 'success',
              responseContent: response.raw.content,
            });
            return parsed;
          }
        }
        if (!failureLogged) {
          await this.recordRequestLog({
            inputMessages,
            phase: 'structured',
            parseStatus: 'failed',
            responseContent: this.stringifyResponseContent(response?.raw?.content),
            error: errorMessage,
          });
        }
        logger.error(`[${this.modelName}] LLM call failed with error: \n${errorMessage}`);
        throw new Error(`Failed to invoke ${this.modelName} with structured output: \n${errorMessage}`);
      }
    }

    // Fallback: Without structured output support, need to extract JSON from model output manually
    return this.invokeWithManualJsonExtraction(inputMessages);
  }

  protected async streamRawModelOutput(
    inputMessages: BaseMessage[],
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    logger.debug(`[${this.modelName}] Streaming raw model output...`);
    const convertedInputMessages = convertInputMessages(inputMessages, this.modelName);
    const stream = await this.chatLLM.stream(convertedInputMessages, {
      signal: this.context.controller.signal,
      ...this.callOptions,
    });

    let buffer = '';
    let chunkCount = 0;
    let nonEmptyCount = 0;

    for await (const chunk of stream as AsyncIterable<{ content?: unknown }>) {
      chunkCount++;
      let delta = '';
      if (typeof chunk.content === 'string') {
        delta = chunk.content;
      } else if (Array.isArray(chunk.content)) {
        for (const part of chunk.content) {
          if (typeof part === 'object' && part !== null && 'type' in part && part.type === 'text' && 'text' in part) {
            delta += (part as { text: string }).text;
          }
        }
      }

      if (!delta) continue;
      nonEmptyCount++;
      buffer += delta;
      onDelta?.(delta);
    }

    logger.info(
      `[${this.modelName}] Stream completed: chunks=${chunkCount}, nonEmpty=${nonEmptyCount}, chars=${buffer.length}`,
    );
    return buffer;
  }

  protected async invokeWithManualJsonExtraction(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    logger.debug(`[${this.modelName}] Using manual JSON extraction fallback method`);
    const convertedInputMessages = convertInputMessages(inputMessages, this.modelName);
    let failureLogged = false;

    try {
      const response = await this.chatLLM.invoke(convertedInputMessages, {
        signal: this.context.controller.signal,
        ...this.callOptions,
      });

      // 1) Try parsing from response.content (normal path for most models)
      if (typeof response.content === 'string' && response.content.trim()) {
        const parsed = this.manuallyParseResponse(response.content);
        if (parsed) {
          await this.recordRequestLog({
            inputMessages,
            phase: 'manual',
            parseStatus: 'success',
            responseContent: response.content,
          });
          return parsed;
        }
      }

      // 2) Some models (e.g. Qwen) return content="" but put the structured data in tool_calls.
      //    LangChain's ChatOpenAI parses the arguments JSON string, but the inner fields
      //    (current_state, action, etc.) may still be double-encoded JSON strings.
      //    We shallow-parse the args and validate them against the Zod schema.
      const aiMsg = response as AIMessage;
      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        logger.debug(
          `[${this.modelName}] Response has empty content but tool_calls present, extracting from tool_calls`,
        );
        const toolCall = aiMsg.tool_calls[0];
        const args = deepParseJsonStrings(toolCall.args) as Record<string, unknown>;
        const validated = this.validateModelOutput(args);
        if (validated) {
          await this.recordRequestLog({
            inputMessages,
            phase: 'manual',
            parseStatus: 'success',
            responseContent: this.stringifyResponseContent(response.content),
          });
          return validated;
        }
        // If shallow-parse validation fails, try raw args without any JSON string parsing
        const rawValidated = this.validateModelOutput(toolCall.args);
        if (rawValidated) {
          await this.recordRequestLog({
            inputMessages,
            phase: 'manual',
            parseStatus: 'success',
            responseContent: this.stringifyResponseContent(response.content),
          });
          return rawValidated;
        }
        // Last resort: stringify the args and try manual extraction as if it were content
        const argsString = JSON.stringify(toolCall.args);
        const manualParsed = this.manuallyParseResponse(argsString);
        if (manualParsed) {
          await this.recordRequestLog({
            inputMessages,
            phase: 'manual',
            parseStatus: 'success',
            responseContent: this.stringifyResponseContent(response.content),
          });
          return manualParsed;
        }
        logger.warning(`[${this.modelName}] tool_calls args could not be validated or parsed`);
        await this.recordRequestLog({
          inputMessages,
          phase: 'manual',
          parseStatus: 'failed',
          responseContent: this.stringifyResponseContent(response.content),
          error: 'Could not validate model output from tool_calls',
        });
        failureLogged = true;
        throw new ResponseParseError('Could not validate model output from tool_calls');
      }

      // 3) Neither content nor tool_calls yielded valid output
      logger.error(`[${this.modelName}] Response has no parseable content or tool_calls`);
    } catch (error) {
      if (error instanceof ResponseParseError) {
        if (!failureLogged) {
          await this.recordRequestLog({
            inputMessages,
            phase: 'manual',
            parseStatus: 'failed',
            error: error.message,
          });
        }
        throw error;
      }
      logger.error(`[${this.modelName}] LLM call failed in manual extraction mode:`, error);
      await this.recordRequestLog({
        inputMessages,
        phase: 'manual',
        parseStatus: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const errorMessage = `Failed to parse response from ${this.modelName}`;
    logger.error(errorMessage);
    if (!failureLogged) {
      await this.recordRequestLog({
        inputMessages,
        phase: 'manual',
        parseStatus: 'failed',
        error: errorMessage,
      });
    }
    throw new ResponseParseError('Could not parse response');
  }

  // Execute the agent and return the result
  abstract execute(): Promise<AgentOutput<M>>;

  // Helper method to validate metadata
  protected validateModelOutput(data: unknown): this['ModelOutput'] | undefined {
    if (!this.modelOutputSchema || !data) return undefined;
    try {
      return this.modelOutputSchema.parse(data);
    } catch (error) {
      logger.error('validateModelOutput', error);
      throw new ResponseParseError('Could not validate model output');
    }
  }

  // Helper method to manually parse the response content
  protected manuallyParseResponse(content: string): this['ModelOutput'] | undefined {
    const cleanedContent = removeThinkTags(content);
    try {
      const extractedJson = extractJsonFromModelOutput(cleanedContent);
      return this.validateModelOutput(extractedJson);
    } catch (error) {
      logger.warning('manuallyParseResponse failed', error);
      return undefined;
    }
  }
}
