import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
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
});
