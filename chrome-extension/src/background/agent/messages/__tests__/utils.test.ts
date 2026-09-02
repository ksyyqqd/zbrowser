import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import {
  extractJsonCandidatesFromModelOutput,
  extractJsonFromModelOutput,
  normalizeToolCallMessageSequence,
} from '../utils';

describe('extractJsonFromModelOutput', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonFromModelOutput('{"done": true}')).toEqual({ done: true });
  });

  it('parses a fenced json block', () => {
    const content = 'Here is the plan:\n```json\n{"done": false, "next_steps": "click"}\n```';
    expect(extractJsonFromModelOutput(content)).toEqual({ done: false, next_steps: 'click' });
  });

  it('parses a fenced block with no language tag', () => {
    expect(extractJsonFromModelOutput('```\n{"done": true}\n```')).toEqual({ done: true });
  });

  it('recovers the payload when prose contains stray braces first', () => {
    const content = 'I will use the {placeholder} syntax. Result: {"done": true}';
    expect(extractJsonFromModelOutput(content)).toEqual({ done: true });
  });

  it('keeps braces that appear inside string values', () => {
    const content = '{"memory": "use {braces} here", "done": false}';
    expect(extractJsonFromModelOutput(content)).toEqual({ memory: 'use {braces} here', done: false });
  });

  it('throws a parse error when there is no JSON at all', () => {
    expect(() => extractJsonFromModelOutput('I cannot help with that.')).toThrow(/Could not manually extract JSON/);
  });
});

describe('extractJsonCandidatesFromModelOutput', () => {
  it('returns an empty list instead of throwing when nothing is parseable', () => {
    expect(extractJsonCandidatesFromModelOutput('no json here')).toEqual([]);
  });

  it('returns later candidates so the caller can pick the schema-matching one', () => {
    const content = 'Thinking: {"scratch": 1}\n\nFinal:\n{"current_state": {}, "action": []}';
    const candidates = extractJsonCandidatesFromModelOutput(content);

    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates).toContainEqual({ current_state: {}, action: [] });
  });

  it('prefers fenced blocks over surrounding prose objects', () => {
    const content = 'Note {"scratch": 1} aside\n```json\n{"done": true}\n```';
    expect(extractJsonCandidatesFromModelOutput(content)[0]).toEqual({ done: true });
  });

  it('finds the payload in a later fenced block', () => {
    const content = '```text\nnot json\n```\n```json\n{"done": true}\n```';
    expect(extractJsonCandidatesFromModelOutput(content)).toContainEqual({ done: true });
  });

  it('deduplicates identical candidates', () => {
    const candidates = extractJsonCandidatesFromModelOutput('```json\n{"done": true}\n```');
    expect(candidates).toEqual([{ done: true }]);
  });

  it('handles an unterminated code fence', () => {
    expect(extractJsonCandidatesFromModelOutput('```json\n{"done": true}')).toContainEqual({ done: true });
  });

  it('recovers a payload whose string values contain unescaped ASCII quotes', () => {
    // 中文输出里模型常用 ASCII 双引号引述页面文字，这会提前终止 JSON 字符串。
    const content =
      '{"current_state": {"evaluation_previous_goal": "成功 - 已在输入框中输入了"今日天气"，标题为"DeepSeek - 探索未至之境"。", "memory": "已完成导航"}, "action": [{"click_element": {"index": 27}}]}';
    const candidates = extractJsonCandidatesFromModelOutput(content);

    expect(candidates.length).toBeGreaterThan(0);
    const state = candidates[0].current_state as Record<string, unknown>;
    expect(state.evaluation_previous_goal).toContain('今日天气');
    expect(candidates[0].action).toEqual([{ click_element: { index: 27 } }]);
  });

  it('does not corrupt a well-formed payload with adjacent quotes', () => {
    const content = '{"memory": "", "next_goal": "click \\"OK\\"", "action": []}';
    expect(extractJsonCandidatesFromModelOutput(content)).toContainEqual({
      memory: '',
      next_goal: 'click "OK"',
      action: [],
    });
  });

  it('salvages a response genuinely cut off mid-string', () => {
    const content = '{"current_state": {"evaluation_previous_goal": "成功", "memory": "已完成：导航到 https://c';

    expect(extractJsonCandidatesFromModelOutput(content)).toContainEqual({
      current_state: { evaluation_previous_goal: '成功', memory: '已完成：导航到 https://c' },
    });
  });

  it('leaves a complete payload untouched by the truncation salvage', () => {
    const content = '{"current_state": {"memory": "ok"}, "action": [{"done": {"success": true}}]}';
    const candidates = extractJsonCandidatesFromModelOutput(content);

    // 内容完整时补齐分支返回 null，候选里不应出现重复/变形的副本
    expect(candidates).toEqual([{ current_state: { memory: 'ok' }, action: [{ done: { success: true } }] }]);
  });

  it('salvages truncation that lands on a dangling key', () => {
    // 内层片段也会被圈成候选，所以完整载荷不一定排第一 —— base.ts 会逐个做 schema 校验，
    // 这里同样只要求它出现在候选里。
    const content = '{"current_state": {"memory": "abc"}, "action": [{"click_element": {"index": 3}}], "next":';

    expect(extractJsonCandidatesFromModelOutput(content)).toContainEqual({
      current_state: { memory: 'abc' },
      action: [{ click_element: { index: 3 } }],
    });
  });

  it('still returns nothing when the content has no JSON at all', () => {
    expect(extractJsonCandidatesFromModelOutput('I cannot help with that.')).toEqual([]);
  });
});

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
