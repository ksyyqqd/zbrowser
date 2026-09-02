import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AI 创建 / 修改工作流和 skill 的防线。
 *
 * 这些都不是「功能」而是防线，所以每一条都值得单独锁住：
 *  1. AI 写过的工作流必须是未确认状态（执行入口据此拦下未经审核的图）
 *  2. 撞 id 时必须新增而不是覆盖（store 是按 id 覆盖写入的，撞了就静默吃掉用户的工作流）
 *  3. 每轮任务有创建/修改上限（AI 卡住时会反复「换个方式再来一次」）
 *  4. 修改必须保持 id 不变（书签和快速执行入口都按 id 记录）
 */

// store 是模块级单例且直接读写 chrome.storage，这里换成内存实现，
// 只保留被测逻辑真正依赖的那几个方法。
const workflows: Record<string, Record<string, unknown>> = {};
const skills: Record<string, unknown> = {};

vi.mock('@extension/storage', () => ({
  userWorkflowsStore: {
    getAllWorkflows: vi.fn(async () => Object.values(workflows)),
    getWorkflow: vi.fn(async (id: string) => workflows[id]),
    addWorkflow: vi.fn(async (w: { id: string }) => {
      workflows[w.id] = w as Record<string, unknown>;
    }),
    updateWorkflow: vi.fn(async (id: string, updates: Record<string, unknown>) => {
      if (!workflows[id]) throw new Error(`Workflow not found: ${id}`);
      workflows[id] = { ...workflows[id], ...updates, updatedAt: Date.now() };
    }),
  },
  userSkillsStore: {
    getAllSkills: vi.fn(async () => Object.values(skills)),
    importSkillPackages: vi.fn(async (pkgs: Array<{ skill: { id: string } }>) => {
      for (const p of pkgs) skills[p.skill.id] = p.skill;
      return { imported: pkgs.length, errors: [], importedIds: pkgs.map(p => p.skill.id), packages: [] };
    }),
  },
}));

// vi.mock 被 vitest 提到文件顶部执行，所以这里用普通静态 import 就能拿到 mock 后的 store
import { createWorkflowFromAI, MAX_WORKFLOW_CREATES_PER_TASK } from '../createFromAI';
import { updateWorkflowFromAI, MAX_WORKFLOW_UPDATES_PER_TASK } from '../updateFromAI';
import { createSkillFromAI, MAX_SKILL_CREATES_PER_TASK } from '../../skills/createFromAI';

function wfInput(over: Record<string, unknown> = {}) {
  return {
    name: 'Daily Report',
    description: '打开报表页读出总额',
    steps: [{ kind: 'automation' as const, action: 'go_to_url', parameters: { url: 'https://example.com' } }],
    ...over,
  };
}

function skillInput(over: Record<string, unknown> = {}) {
  return {
    name: 'Track Parcel',
    description: '查快递单号状态',
    parameters: [{ name: 'trackingNo', type: 'string' as const, required: true, description: '快递单号' }],
    instructions: '1. 打开快递官网\n2. 把 {{trackingNo}} 填进查询框\n3. 读出最新状态',
    ...over,
  };
}

beforeEach(() => {
  for (const k of Object.keys(workflows)) delete workflows[k];
  for (const k of Object.keys(skills)) delete skills[k];
});

describe('createWorkflowFromAI', () => {
  it('存为未确认状态，AI 不能立刻执行自己的产出', async () => {
    const r = await createWorkflowFromAI(wfInput(), 0);

    expect(r.success).toBe(true);
    const saved = workflows[r.workflowId!] as { reviewed: boolean; source: string };
    expect(saved.reviewed).toBe(false);
    expect(saved.source).toBe('ai_created');
  });

  it('id 撞车时新增一条，不覆盖已有工作流', async () => {
    // store 按 id 覆盖写入，而 id 由名字 slug 化而来 —— 同名创建会静默吃掉用户手工调过的那个
    const first = await createWorkflowFromAI(wfInput(), 0);
    const second = await createWorkflowFromAI(wfInput(), 1);

    expect(second.success).toBe(true);
    expect(second.workflowId).not.toBe(first.workflowId);
    expect(Object.keys(workflows)).toHaveLength(2);
  });

  it('编造的动作名被拦下，错误里点名那个动作', async () => {
    const r = await createWorkflowFromAI(wfInput({ steps: [{ kind: 'automation', action: 'fill_form' }] }), 0);

    expect(r.success).toBe(false);
    expect(r.errors?.join()).toContain('fill_form');
    expect(Object.keys(workflows)).toHaveLength(0);
  });

  it('达到上限后拒绝创建', async () => {
    const r = await createWorkflowFromAI(wfInput(), MAX_WORKFLOW_CREATES_PER_TASK);

    expect(r.success).toBe(false);
    expect(r.errors?.join()).toContain('上限');
    expect(Object.keys(workflows)).toHaveLength(0);
  });
});

describe('updateWorkflowFromAI', () => {
  async function seed() {
    const r = await createWorkflowFromAI(wfInput(), 0);
    // 先标成已确认，才能验证「改完退回未确认」这件事真的发生了
    workflows[r.workflowId!].reviewed = true;
    return r.workflowId!;
  }

  it('id 保持不变 —— 书签和快速执行入口都按 id 记录', async () => {
    const id = await seed();

    const r = await updateWorkflowFromAI(
      { workflowId: id, name: 'Weekly Report', steps: [{ kind: 'output', content: '完成' }] },
      0,
    );

    expect(r.success).toBe(true);
    expect(r.workflowId).toBe(id);
    expect(Object.keys(workflows)).toEqual([id]);
    expect(workflows[id].name).toBe('Weekly Report');
  });

  it('改完退回未确认状态', async () => {
    const id = await seed();

    await updateWorkflowFromAI({ workflowId: id, steps: [{ kind: 'output', content: '完成' }] }, 0);

    expect(workflows[id].reviewed).toBe(false);
  });

  it('steps 是整体替换，不是追加', async () => {
    const id = await seed();

    await updateWorkflowFromAI(
      {
        workflowId: id,
        steps: [
          { kind: 'automation', action: 'go_to_url', parameters: { url: 'https://a.com' } },
          { kind: 'output', content: '完成' },
        ],
      },
      0,
    );

    const nodes = workflows[id].nodes as Array<{ type: string }>;
    // start + 2 步 + end
    expect(nodes).toHaveLength(4);
    expect(nodes.filter(n => n.type === 'output')).toHaveLength(1);
  });

  it('只改名字时不动节点，画布布局保住', async () => {
    const id = await seed();
    const nodesBefore = workflows[id].nodes;

    const r = await updateWorkflowFromAI({ workflowId: id, name: '月报' }, 0);

    expect(r.success).toBe(true);
    expect(workflows[id].name).toBe('月报');
    expect(workflows[id].nodes).toBe(nodesBefore);
  });

  it('什么都没给时报错，而不是「成功但没变化」', async () => {
    const id = await seed();

    const r = await updateWorkflowFromAI({ workflowId: id }, 0);

    expect(r.success).toBe(false);
    expect(workflows[id].reviewed).toBe(true);
  });

  it('工作流不存在时报错', async () => {
    const r = await updateWorkflowFromAI({ workflowId: 'wf-nope', name: 'x' }, 0);

    expect(r.success).toBe(false);
    expect(r.errors?.join()).toContain('wf-nope');
  });

  it('编造的动作名被拦下，且原工作流未被改动', async () => {
    const id = await seed();

    const r = await updateWorkflowFromAI({ workflowId: id, steps: [{ kind: 'automation', action: 'fill_form' }] }, 0);

    expect(r.success).toBe(false);
    expect(r.errors?.join()).toContain('fill_form');
    // 校验失败不能留下半个改动，尤其不能把 reviewed 打成 false
    expect(workflows[id].reviewed).toBe(true);
  });

  it('达到上限后拒绝修改', async () => {
    const id = await seed();

    const r = await updateWorkflowFromAI({ workflowId: id, name: 'x' }, MAX_WORKFLOW_UPDATES_PER_TASK);

    expect(r.success).toBe(false);
    expect(r.errors?.join()).toContain('上限');
    expect(workflows[id].name).toBe('Daily Report');
  });
});

describe('createSkillFromAI', () => {
  it('创建成功且立即可用（skill 不需要待确认状态）', async () => {
    // skill 是提示词模板，执行时仍由 AI 逐步判断、受同一套动作权限约束，
    // 没有「未审核的图直接操作浏览器」那种风险
    const r = await createSkillFromAI(skillInput(), 0);

    expect(r.success).toBe(true);
    expect(skills[r.skillId!]).toBeDefined();
  });

  it('正文和参数一起存下来，{{}} 引用保持原样', async () => {
    const r = await createSkillFromAI(skillInput(), 0);
    const saved = skills[r.skillId!] as { instructions?: string; parameters: Array<{ name: string }> };

    expect(saved.parameters.map(p => p.name)).toEqual(['trackingNo']);
    expect(saved.instructions).toContain('{{trackingNo}}');
  });

  it('声明了却没在正文里引用的参数被拦下', async () => {
    // 这种 skill 执行时会向用户索要一个根本不影响结果的值
    const r = await createSkillFromAI(skillInput({ instructions: '1. 打开快递官网\n2. 随便查一下' }), 0);

    expect(r.success).toBe(false);
    expect(r.errors?.join()).toContain('trackingNo');
  });

  it('非法参数名被拦下', async () => {
    const r = await createSkillFromAI(
      skillInput({
        parameters: [{ name: 'my no', type: 'string', required: true, description: '单号' }],
        instructions: '用 {{my no}} 查询',
      }),
      0,
    );

    expect(r.success).toBe(false);
    expect(r.errors?.join()).toContain('my no');
  });

  it('空正文被拦下', async () => {
    const r = await createSkillFromAI(skillInput({ instructions: '   ', parameters: [] }), 0);

    expect(r.success).toBe(false);
    expect(r.errors?.join()).toContain('instructions');
  });

  it('id 撞车时新增一条，不覆盖用户已有 skill', async () => {
    const first = await createSkillFromAI(skillInput(), 0);
    const second = await createSkillFromAI(skillInput(), 1);

    expect(second.skillId).not.toBe(first.skillId);
    expect(Object.keys(skills)).toHaveLength(2);
  });

  it('达到上限后拒绝创建', async () => {
    const r = await createSkillFromAI(skillInput(), MAX_SKILL_CREATES_PER_TASK);

    expect(r.success).toBe(false);
    expect(r.errors?.join()).toContain('上限');
    expect(Object.keys(skills)).toHaveLength(0);
  });
});
