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
  extractJsonCandidatesFromModelOutput,
  removeThinkTags,
} from '../messages/utils';
import { isAbortedError, ResponseParseError } from './errors';
import { ProviderTypeEnum } from '@extension/storage';
import { appendAgentRequestLog, serializeMessagesForLog } from '../requestLogs';

const logger = createLogger('agent');

/**
 * Whether an error message looks like a response-shape problem rather than a transport,
 * auth or quota problem. Parse-shaped failures are worth retrying with a fresh completion.
 */
function isParseShapedError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('is not valid json') ||
    normalized.includes('failed to parse') ||
    normalized.includes('could not parse') ||
    normalized.includes('unexpected token') ||
    normalized.includes('json at position') ||
    normalized.includes('received tool input did not match') ||
    normalized.includes('does not match schema') ||
    normalized.includes('invalid schema')
  );
}

/**
 * Summarize a schema validation failure into a short, single-line description.
 * Zod errors carry a full issue list that is far too verbose for a user-facing message,
 * so only the first few field paths are reported.
 */
function describeSchemaError(error: unknown): string {
  const issues = (error as { issues?: Array<{ path?: unknown[]; message?: string }> })?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const described = issues
      .slice(0, 3)
      .map(issue => {
        const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `${path}: ${issue.message ?? 'invalid'}`;
      })
      .join('; ');
    const suffix = issues.length > 3 ? ` (+${issues.length - 3} more)` : '';
    return `${described}${suffix}`;
  }
  return error instanceof Error ? error.message : String(error);
}

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
  /** Why the most recent manual parse attempt failed; used to build actionable error messages. */
  protected lastParseFailureReason?: string;
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
        // Structured output produced no parsed value. The payload is often still present in the
        // raw text (prose or a code fence instead of a tool call), so try to recover it.
        const rawText = this.stringifyResponseContent(response.raw?.content);
        if (rawText.trim()) {
          const recovered = this.manuallyParseResponse(rawText);
          if (recovered) {
            await this.recordRequestLog({
              inputMessages,
              phase: 'structured',
              parseStatus: 'success',
              responseContent: rawText,
            });
            logger.debug(`[${this.modelName}] Recovered structured output from raw content`);
            return recovered;
          }
        }

        if (!this.lastParseFailureReason) {
          this.lastParseFailureReason = 'structured output returned no parsed value';
        }
        const structuredError = this.buildParseFailureMessage(rawText);
        await this.recordRequestLog({
          inputMessages,
          phase: 'structured',
          parseStatus: 'failed',
          responseContent: rawText,
          error: structuredError,
        });
        failureLogged = true;
        logger.error('Failed to parse response', response);
        throw new ResponseParseError(structuredError);
      } catch (error) {
        if (isAbortedError(error)) {
          throw error;
        }

        // Already a parse failure with a descriptive message and a recorded log entry.
        if (error instanceof ResponseParseError) {
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

        // Try to extract JSON from the raw response manually. Any parse-shaped failure is worth
        // retrying, not only "is not valid JSON": providers word these errors inconsistently.
        if (response?.raw?.content && typeof response.raw.content === 'string') {
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
        // Parse/validation failures are retryable by the executor, so keep them typed.
        // Transport, auth and rate-limit errors stay generic and are handled upstream.
        if (isParseShapedError(errorMessage)) {
          this.lastParseFailureReason = errorMessage;
          throw new ResponseParseError(
            this.buildParseFailureMessage(this.stringifyResponseContent(response?.raw?.content)),
          );
        }
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
    let rawContentForError = '';
    this.lastParseFailureReason = undefined;

    try {
      const response = await this.chatLLM.invoke(convertedInputMessages, {
        signal: this.context.controller.signal,
        ...this.callOptions,
      });

      // 1) Try parsing from response.content (normal path for most models)
      if (typeof response.content === 'string' && response.content.trim()) {
        rawContentForError = response.content;
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
        const toolCallError = `Could not validate model output from tool_calls: ${
          this.lastParseFailureReason ?? 'arguments did not match the expected schema'
        }`;
        await this.recordRequestLog({
          inputMessages,
          phase: 'manual',
          parseStatus: 'failed',
          responseContent: this.stringifyResponseContent(response.content),
          error: toolCallError,
        });
        failureLogged = true;
        throw new ResponseParseError(toolCallError);
      }

      // 3) Neither content nor tool_calls yielded valid output
      logger.error(`[${this.modelName}] Response has no parseable content or tool_calls`);
      if (!rawContentForError) {
        rawContentForError = this.stringifyResponseContent(response.content);
      }
      if (!this.lastParseFailureReason) {
        this.lastParseFailureReason = 'response had no parseable content and no tool_calls';
      }
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
    const errorMessage = this.buildParseFailureMessage(rawContentForError);
    logger.error(errorMessage);
    if (!failureLogged) {
      await this.recordRequestLog({
        inputMessages,
        phase: 'manual',
        parseStatus: 'failed',
        responseContent: rawContentForError,
        error: errorMessage,
      });
    }
    throw new ResponseParseError(errorMessage);
  }

  // Execute the agent and return the result
  abstract execute(...args: unknown[]): Promise<AgentOutput<M>>;

  // Helper method to validate metadata
  protected validateModelOutput(data: unknown): this['ModelOutput'] | undefined {
    if (!this.modelOutputSchema || !data) return undefined;
    try {
      return this.modelOutputSchema.parse(data);
    } catch (error) {
      logger.error('validateModelOutput', error);
      throw new ResponseParseError(`Could not validate model output: ${describeSchemaError(error)}`);
    }
  }

  /**
   * Manually parse the response content into model output.
   *
   * Models often wrap the payload in prose, reasoning text, or a code fence that is not the
   * first one in the message, so every plausible JSON object is validated against the schema
   * and the first that fits wins. The reason for failure is recorded in
   * {@link lastParseFailureReason} so callers can surface it instead of a bare
   * "Could not parse response".
   */
  protected manuallyParseResponse(content: string): this['ModelOutput'] | undefined {
    const cleanedContent = removeThinkTags(content);
    const candidates = extractJsonCandidatesFromModelOutput(cleanedContent);

    if (candidates.length === 0) {
      this.lastParseFailureReason = cleanedContent.trim()
        ? 'no JSON object found in model output'
        : 'model returned empty content';
      logger.warning(`[${this.modelName}] manuallyParseResponse: ${this.lastParseFailureReason}`);
      return undefined;
    }

    const validationErrors: string[] = [];
    for (const candidate of candidates) {
      try {
        const validated = this.validateModelOutput(candidate);
        if (validated) {
          this.lastParseFailureReason = undefined;
          return validated;
        }
      } catch (error) {
        validationErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    this.lastParseFailureReason = `${candidates.length} JSON candidate(s) found but none matched the expected schema${
      validationErrors.length > 0 ? ` (${validationErrors[0]})` : ''
    }`;
    logger.warning(`[${this.modelName}] manuallyParseResponse: ${this.lastParseFailureReason}`);
    return undefined;
  }

  /**
   * Build a parse-failure message that includes why parsing failed and a preview of what the
   * model actually returned, so the surfaced error is actionable.
   *
   * The preview is explicitly marked as truncated when it is cut: a bare trailing "..." reads
   * exactly like the model itself having been cut off at the output token cap, which sends
   * debugging after the wrong root cause.
   */
  protected buildParseFailureMessage(rawContent?: string): string {
    const PREVIEW_LIMIT = 600;
    const reason = this.lastParseFailureReason ?? 'could not parse response';
    const normalized = (rawContent ?? '').trim().replace(/\s+/g, ' ');
    if (!normalized) {
      return `Could not parse response from ${this.modelName}: ${reason}`;
    }

    const preview =
      normalized.length > PREVIEW_LIMIT
        ? `${normalized.slice(0, PREVIEW_LIMIT)}" [preview truncated at ${PREVIEW_LIMIT} of ${normalized.length} chars`
        : normalized;
    return `Could not parse response from ${this.modelName}: ${reason}. Model returned: "${preview}"`;
  }
}
