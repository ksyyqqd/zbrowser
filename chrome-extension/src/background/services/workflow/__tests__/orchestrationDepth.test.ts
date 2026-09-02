import { describe, expect, it } from 'vitest';
import {
  guardOrchestration,
  countWorkflowFrames,
  formatOrchestrationChain,
  MAX_ORCHESTRATION_DEPTH,
  type OrchestrationFrame,
} from '../orchestrationDepth';

/**
 * 编排深度守卫。
 *
 * 这个守卫存在的唯一理由是 `WorkflowExecutor._subflowStack` 看不见跨 AI 边界的递归：
 * 工作流 ai 节点起新 Executor → AI 调 workflow_invoke → 又进 executor，每跨一次边界
 * 栈就重置。所以测试重点是**跨边界的链**能被正确累计和拦截。
 */

const wf = (id: string): OrchestrationFrame => ({ kind: 'workflow', id });
const ai = (id: string): OrchestrationFrame => ({ kind: 'ai', id });

describe('guardOrchestration', () => {
  it('顶层调用放行', () => {
    const r = guardOrchestration(undefined, wf('a'));

    expect(r).toEqual({ ok: true, stack: [wf('a')] });
  });

  it('放行时返回追加后的链，供调用方继续往下传', () => {
    // 链靠调用方手动传递，守卫不持有状态 —— 返回值漏传就等于没有守卫
    const r = guardOrchestration([wf('a'), ai('读取总额')], wf('b'));

    expect(r.ok).toBe(true);
    expect(r.ok && r.stack).toEqual([wf('a'), ai('读取总额'), wf('b')]);
  });

  it('同一工作流再次进入即报环，哪怕中间隔了 AI 帧', () => {
    // 这是最容易踩的一种：提示词里刚描述过工作流 A，AI 被 A 唤起后又去调 A
    const r = guardOrchestration([wf('a'), ai('总结')], wf('a'));

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('循环调用');
    expect(r.ok === false && r.error).toContain('a → (AI:总结) → a');
  });

  it('ai 帧同名不算环', () => {
    // ai 帧的 id 是节点名，不同工作流里叫「总结」很正常
    const r = guardOrchestration([wf('a'), ai('总结'), wf('b')], ai('总结'));

    expect(r.ok).toBe(true);
  });

  it(`工作流帧超过 ${MAX_ORCHESTRATION_DEPTH} 层就拦下`, () => {
    const stack: OrchestrationFrame[] = [];
    let current: OrchestrationFrame[] = stack;

    // 连续压满上限，每层之间夹一个 ai 帧模拟真实的跨边界链
    for (let i = 0; i < MAX_ORCHESTRATION_DEPTH; i++) {
      const r = guardOrchestration(current, wf(`wf-${i}`));
      expect(r.ok).toBe(true);
      current = [...(r.ok ? r.stack : []), ai(`node-${i}`)];
    }

    const blocked = guardOrchestration(current, wf('one-too-many'));
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.error).toContain(`超过 ${MAX_ORCHESTRATION_DEPTH} 层`);
  });

  it('ai 帧不占深度额度', () => {
    // 否则一个多 ai 节点的工作流会因为「深度超限」被拦，而它根本没有嵌套
    const manyAi: OrchestrationFrame[] = [wf('a'), ai('1'), ai('2'), ai('3'), ai('4'), ai('5')];

    expect(guardOrchestration(manyAi, wf('b')).ok).toBe(true);
  });
});

describe('countWorkflowFrames', () => {
  it('只数 workflow 帧', () => {
    expect(countWorkflowFrames([wf('a'), ai('x'), wf('b'), ai('y')])).toBe(2);
  });
});

describe('formatOrchestrationChain', () => {
  it('AI 帧带前缀，方便看出是哪一环跨了边界', () => {
    expect(formatOrchestrationChain([wf('a'), ai('读表'), wf('b')])).toBe('a → (AI:读表) → b');
  });
});
