import { describe, expect, it } from 'vitest';
import {
  stepsToWorkflow,
  validateStepSpecs,
  deriveWorkflowId,
  StepsToWorkflowError,
  validateWorkflowStructure,
  type StepsToWorkflowInput,
} from '@extension/workflow';

/**
 * 线性步骤 → 工作流图的转换。
 *
 * 这个函数是 AI 创建工作流的唯一入口：LLM 只产出线性步骤，图的拓扑和坐标全由它推导。
 * 所以测试重点是两件会真实出问题的事：
 *  1. 生成的图必须能过 `validateWorkflowStructure` —— 否则存下去的是坏数据，
 *     用户在编辑器里打开才发现跑不了
 *  2. 语义校验要拦住 LLM 常见的编造（不存在的 action、缺 prompt 的 ai 节点）
 */

const ALLOWED = ['go_to_url', 'click_element', 'input_text'] as const;

function input(over: Partial<StepsToWorkflowInput> = {}): StepsToWorkflowInput {
  return {
    name: '每日报表',
    description: '打开报表页并读出总额',
    steps: [{ kind: 'automation', action: 'go_to_url', parameters: { url: 'https://example.com' } }],
    ...over,
  };
}

describe('stepsToWorkflow', () => {
  it('生成的图能通过 validateWorkflowStructure', () => {
    // 这是本函数存在的全部意义：AI 不碰拓扑，图必须天然合法
    const wf = stepsToWorkflow(
      input({
        steps: [
          { kind: 'automation', action: 'go_to_url', parameters: { url: 'https://example.com' } },
          { kind: 'ai', prompt: '读出表格里的总额', outputVariable: 'total' },
          { kind: 'output', content: '总额：{{total}}' },
        ],
      }),
      { allowedActions: ALLOWED },
    );

    expect(validateWorkflowStructure(wf)).toEqual({ valid: true, errors: [] });
  });

  it('补出 start / end 并把步骤串成一条链', () => {
    const wf = stepsToWorkflow(
      input({
        steps: [
          { kind: 'automation', action: 'go_to_url', parameters: { url: 'https://a.com' } },
          { kind: 'automation', action: 'click_element', parameters: { xpath: '/html/body/button' } },
        ],
      }),
      { allowedActions: ALLOWED },
    );

    expect(wf.nodes.map(n => n.id)).toEqual(['start', 'step-0', 'step-1', 'end']);
    expect(wf.edges.map(e => `${e.source}->${e.target}`)).toEqual(['start->step-0', 'step-0->step-1', 'step-1->end']);
  });

  it('节点不重叠：x 坐标严格递增', () => {
    // LLM 自己算坐标会把节点堆在一起，画布上看起来只有一个节点
    const wf = stepsToWorkflow(
      input({
        steps: Array.from({ length: 5 }, () => ({
          kind: 'automation' as const,
          action: 'click_element',
        })),
      }),
      { allowedActions: ALLOWED },
    );

    const xs = wf.nodes.map(n => n.position.x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  it('kind 映射到对应的 NodeData 字段', () => {
    const wf = stepsToWorkflow(
      input({
        steps: [
          { kind: 'automation', action: 'input_text', parameters: { text: 'hi' }, delayAfter: 500 },
          { kind: 'ai', prompt: '总结页面', outputVariable: 'summary' },
          { kind: 'output', content: '{{summary}}', label: '报告' },
        ],
      }),
      { allowedActions: ALLOWED },
    );

    const [, automation, ai, out] = wf.nodes;
    expect(automation.data).toMatchObject({ action: 'input_text', parameters: { text: 'hi' }, delayAfter: 500 });
    expect(ai.data).toMatchObject({ prompt: '总结页面', outputVariable: 'summary' });
    expect(out.data).toMatchObject({ content: '{{summary}}', label: '报告' });
  });

  it('无名步骤回退到 action 名，画布上不出现空节点', () => {
    const wf = stepsToWorkflow(input({ steps: [{ kind: 'automation', action: 'go_to_url' }] }), {
      allowedActions: ALLOWED,
    });

    expect(wf.nodes[1].name).toBe('go_to_url');
  });

  it('onError 固定为 stop', () => {
    // AI 生成的流程没人逐节点验证过，出错继续跑会把后续步骤建在错误状态上
    const wf = stepsToWorkflow(input(), { allowedActions: ALLOWED });

    expect(wf.executionConfig.onError).toBe('stop');
  });

  it('校验失败时抛 StepsToWorkflowError 并带上全部错误', () => {
    expect(() =>
      stepsToWorkflow(input({ steps: [{ kind: 'automation', action: 'fill_form' }] }), {
        allowedActions: ALLOWED,
      }),
    ).toThrow(StepsToWorkflowError);
  });
});

describe('validateStepSpecs', () => {
  it('拦住 LLM 编造的动作名', () => {
    // `fill_form` / `click_button` 这类听起来合理但并不存在的动作是高发项，
    // 不拦的话要等到执行时才报错，那时用户已经存下并信任这个工作流了
    const errors = validateStepSpecs(input({ steps: [{ kind: 'automation', action: 'fill_form' }] }), ALLOWED);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('fill_form');
  });

  it('不传白名单时不校验动作名', () => {
    // 白名单来自 chrome-extension 侧的动作注册表，包内单独调用时可能拿不到
    expect(validateStepSpecs(input({ steps: [{ kind: 'automation', action: 'whatever' }] }))).toEqual([]);
  });

  it('automation 缺 action / ai 缺 prompt / output 缺 content 都报错', () => {
    const errors = validateStepSpecs(
      input({
        steps: [{ kind: 'automation' }, { kind: 'ai' }, { kind: 'output' }],
      }),
      ALLOWED,
    );

    expect(errors).toHaveLength(3);
  });

  it('拒绝不支持的 kind', () => {
    // condition / loop 需要 AI 同时想清楚拓扑和布局，第一版不开放
    const errors = validateStepSpecs(input({ steps: [{ kind: 'condition' } as never] }), ALLOWED);

    expect(errors[0]).toContain('condition');
  });

  it('变量名必须能安全用在 {{}} 模板里', () => {
    const errors = validateStepSpecs(input({ variables: [{ name: 'my var', type: 'string' }] }), ALLOWED);

    expect(errors[0]).toContain('my var');
  });

  it('空步骤列表直接报错，不生成只有 start/end 的空壳', () => {
    expect(validateStepSpecs(input({ steps: [] }), ALLOWED)).toContain('工作流至少需要一个步骤');
  });

  it('缺 name 报错', () => {
    expect(validateStepSpecs(input({ name: '   ' }), ALLOWED).some(e => e.includes('name'))).toBe(true);
  });
});

describe('deriveWorkflowId', () => {
  it('英文名 slug 化', () => {
    expect(deriveWorkflowId('Daily Report')).toBe('wf-daily-report');
  });

  it('中文名 slug 化后为空，退回时间戳而不是返回 "wf-"', () => {
    // 纯中文名会被 [^\w\s-] 全部剔掉；不兜底的话所有中文工作流会共用同一个 id 互相覆盖
    const id = deriveWorkflowId('每日报表');

    expect(id.startsWith('wf-')).toBe(true);
    expect(id.length).toBeGreaterThan(3);
  });
});
