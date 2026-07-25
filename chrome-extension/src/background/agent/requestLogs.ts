import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { AgentRequestLogEntry, AgentRequestLogPhase, AgentRequestLogStatus } from '@extension/storage';
import { requestLogStore } from '@extension/storage';

const MAX_REQUEST_TEXT_LENGTH = 8000;
const MAX_RESPONSE_TEXT_LENGTH = 12000;

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item !== 'object' || item === null) {
          return String(item);
        }
        if ('type' in item && item.type === 'text' && 'text' in item) {
          return String(item.text);
        }
        if ('type' in item && item.type === 'image_url') {
          return '[image_url]';
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

export function serializeMessagesForLog(messages: BaseMessage[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    const role =
      message instanceof SystemMessage
        ? 'system'
        : message instanceof HumanMessage
          ? 'user'
          : message instanceof AIMessage
            ? 'assistant'
            : message instanceof ToolMessage
              ? 'tool'
              : message.constructor.name;
    let content = stringifyMessageContent(message.content);
    if (message instanceof AIMessage && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      content += `\n[tool_calls] ${JSON.stringify(message.tool_calls)}`;
    }
    lines.push(`[${role}] ${truncateText(content, MAX_REQUEST_TEXT_LENGTH)}`);
  }

  return lines.join('\n\n');
}

export function normalizeLogContent(content: string | undefined, maxLength: number): string {
  return truncateText(content?.trim() || '', maxLength);
}

export async function appendAgentRequestLog(params: {
  taskId: string;
  agent: string;
  modelName: string;
  phase: AgentRequestLogPhase;
  parseStatus: AgentRequestLogStatus;
  requestContent: string;
  responseContent?: string;
  error?: string;
}): Promise<void> {
  const entry: AgentRequestLogEntry = {
    id: crypto.randomUUID(),
    taskId: params.taskId,
    agent: params.agent,
    modelName: params.modelName,
    phase: params.phase,
    parseStatus: params.parseStatus,
    createdAt: Date.now(),
    requestContent: normalizeLogContent(params.requestContent, MAX_REQUEST_TEXT_LENGTH),
    responseContent: normalizeLogContent(params.responseContent, MAX_RESPONSE_TEXT_LENGTH),
    error: params.error ? normalizeLogContent(params.error, 4000) : undefined,
  };

  await requestLogStore.append(entry);
}
