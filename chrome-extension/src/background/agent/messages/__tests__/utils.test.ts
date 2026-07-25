import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { normalizeToolCallMessageSequence } from '../utils';

describe('normalizeToolCallMessageSequence', () => {
  it('removes assistant tool_calls blocks that are missing tool responses', () => {
    const messages = [
      new HumanMessage('hello'),
      new AIMessage({
        content: 'tool call',
        tool_calls: [
          {
            id: 'call_1',
            name: 'AgentOutput',
            args: { done: false },
            type: 'tool_call',
          },
        ],
      }),
      new HumanMessage('next turn'),
    ];

    const result = normalizeToolCallMessageSequence(messages);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(HumanMessage);
    expect(result[1]).toBeInstanceOf(HumanMessage);
  });

  it('keeps valid assistant tool_calls blocks with matching tool messages', () => {
    const messages = [
      new HumanMessage('hello'),
      new AIMessage({
        content: 'tool call',
        tool_calls: [
          {
            id: 'call_1',
            name: 'AgentOutput',
            args: { done: false },
            type: 'tool_call',
          },
        ],
      }),
      new ToolMessage({ content: 'tool result', tool_call_id: 'call_1' }),
      new HumanMessage('next turn'),
    ];

    const result = normalizeToolCallMessageSequence(messages);

    expect(result).toHaveLength(4);
    expect(result[1]).toBeInstanceOf(AIMessage);
    expect(result[2]).toBeInstanceOf(ToolMessage);
  });
});
