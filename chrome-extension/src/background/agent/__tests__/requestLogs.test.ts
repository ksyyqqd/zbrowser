import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { serializeMessagesForLog, normalizeLogContent } from '../requestLogs';

describe('request log helpers', () => {
  it('serializes messages without leaking image payloads', () => {
    const text = serializeMessagesForLog([
      new HumanMessage({
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
        ],
      }),
      new AIMessage({
        content: 'result',
        tool_calls: [
          {
            id: 'call_1',
            name: 'AgentOutput',
            args: { done: true },
            type: 'tool_call',
          },
        ],
      }),
    ]);

    expect(text).toContain('[user] hello');
    expect(text).toContain('[image_url]');
    expect(text).toContain('[tool_calls]');
    expect(text).not.toContain('abc123');
  });

  it('truncates long content', () => {
    const text = normalizeLogContent('a'.repeat(9000), 100);
    expect(text.length).toBeGreaterThan(100);
    expect(text).toContain('[truncated');
  });

  it('repairs common GBK mojibake when possible', () => {
    const text = normalizeLogContent('\u6d63\u72b3\u69f8', 1000);
    expect(text).toContain('你是');
  });

  it('omits garbled system prompts from request logs', () => {
    const text = serializeMessagesForLog([
      new SystemMessage('\u6d63\u72b3\u69f8\u6d93\u64b3\u68ec\u9422\u3124\u7c2c\u9477\u9354\u3125'),
      new HumanMessage('正常用户输入'),
    ]);

    expect(text).toContain('[system] [system prompt omitted');
    expect(text).toContain('正常用户输入');
    expect(text).not.toContain('\u6d63\u72b3\u69f8');
  });
});
