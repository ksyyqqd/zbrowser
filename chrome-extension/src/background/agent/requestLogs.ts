import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { AgentRequestLogEntry, AgentRequestLogPhase, AgentRequestLogStatus } from '@extension/storage';
import { requestLogStore } from '@extension/storage';

const MAX_REQUEST_TEXT_LENGTH = 8000;
const MAX_RESPONSE_TEXT_LENGTH = 12000;

let gbkEncodeMap: Map<string, number[]> | null = null;

function getGbkEncodeMap(): Map<string, number[]> | null {
  if (gbkEncodeMap) {
    return gbkEncodeMap;
  }
  if (typeof TextDecoder === 'undefined') {
    return null;
  }

  try {
    const decoder = new TextDecoder('gbk');
    const nextMap = new Map<string, number[]>();

    for (let b = 0; b <= 0x7f; b++) {
      nextMap.set(String.fromCharCode(b), [b]);
    }

    for (let lead = 0x81; lead <= 0xfe; lead++) {
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        if (trail === 0x7f) continue;
        const decoded = decoder.decode(new Uint8Array([lead, trail]));
        if (decoded && decoded !== '\uFFFD' && !nextMap.has(decoded)) {
          nextMap.set(decoded, [lead, trail]);
        }
      }
    }

    gbkEncodeMap = nextMap;
    return gbkEncodeMap;
  } catch {
    return null;
  }
}

function countMojibakeMarkers(value: string): number {
  return (value.match(/[浣犳槸涓撻棬鐢ㄤ簬鐨锛鈥婢搴瑙鍔绱诲]/g) ?? []).length;
}

function isLikelyGarbledChinese(value: string): boolean {
  return countMojibakeMarkers(value) >= 6;
}

function repairGbkMojibakeForLog(value: string): string {
  const markerCount = countMojibakeMarkers(value);
  if (markerCount < 2) {
    return value;
  }

  const encodeMap = getGbkEncodeMap();
  if (!encodeMap || typeof TextDecoder === 'undefined') {
    return value;
  }

  const bytes: number[] = [];
  let unmapped = 0;
  for (const char of value) {
    const encoded = encodeMap.get(char);
    if (encoded) {
      bytes.push(...encoded);
    } else {
      unmapped++;
      bytes.push(...new TextEncoder().encode(char));
    }
  }

  if (unmapped / Math.max(value.length, 1) > 0.08) {
    return value;
  }

  try {
    const repaired = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    return countMojibakeMarkers(repaired) < markerCount ? repaired : value;
  } catch {
    return value;
  }
}

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
    if (message instanceof SystemMessage && isLikelyGarbledChinese(content)) {
      content = '[system prompt omitted: source text contains garbled Chinese]';
    }
    lines.push(`[${role}] ${truncateText(content, MAX_REQUEST_TEXT_LENGTH)}`);
  }

  return lines.join('\n\n');
}

export function normalizeLogContent(content: string | undefined, maxLength: number): string {
  const repaired = repairGbkMojibakeForLog(content?.trim() || '');
  if (isLikelyGarbledChinese(repaired)) {
    return '[log content omitted: source text contains garbled Chinese]';
  }
  return truncateText(repaired, maxLength);
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
