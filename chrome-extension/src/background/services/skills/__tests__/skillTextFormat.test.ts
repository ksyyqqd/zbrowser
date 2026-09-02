import { describe, it, expect } from 'vitest';
import { MarkdownParser, renderSkillBody, renderSkillAsTask, builtInSkills } from '@extension/skills';
import type { Skill } from '@extension/skills';

/**
 * Skill 通用文本格式（frontmatter + 正文）的解析 / 序列化 / 注入渲染。
 *
 * 重点覆盖三件事：
 * 1. frontmatter 能正确读出元信息，正文原样成为 instructions
 * 2. 旧的章节式格式（`# 名称` + `## Steps`）仍能解析——存量数据不能读挂
 * 3. 注入渲染会替换 {{param}}，未提供的参数要显式提示而不是静默留占位符
 */

const parser = new MarkdownParser();

describe('MarkdownParser - frontmatter 格式', () => {
  const doc = `---
name: 查快递
description: 在快递官网查询单号状态
category: navigation
version: 2.1.0
author: zhangsan
tags: [物流, 查询]
parameters:
  - name: trackingNo
    type: string
    required: true
    description: 快递单号
  - name: carrier
    type: string
    required: false
    default: 顺丰
---

1. 打开 https://www.kuaidi100.com
2. 把 {{trackingNo}} 填进查询框
3. 读出最新一条物流状态`;

  it('读出 frontmatter 元信息', () => {
    const skill = parser.parse(doc);
    expect(skill.name).toBe('查快递');
    expect(skill.description).toBe('在快递官网查询单号状态');
    expect(skill.category).toBe('navigation');
    expect(skill.version).toBe('2.1.0');
    expect(skill.author).toBe('zhangsan');
    expect(skill.tags).toEqual(['物流', '查询']);
  });

  it('正文原样成为 instructions，且不含 frontmatter', () => {
    const skill = parser.parse(doc);
    expect(skill.instructions).toContain('打开 https://www.kuaidi100.com');
    expect(skill.instructions).toContain('{{trackingNo}}');
    expect(skill.instructions).not.toContain('---');
    expect(skill.instructions).not.toContain('name: 查快递');
  });

  it('解析 parameters 列表（含类型、必填、默认值）', () => {
    const skill = parser.parse(doc);
    expect(skill.parameters).toHaveLength(2);
    expect(skill.parameters[0]).toMatchObject({
      name: 'trackingNo',
      type: 'string',
      required: true,
      description: '快递单号',
    });
    expect(skill.parameters[1]).toMatchObject({ name: 'carrier', required: false, default: '顺丰' });
  });

  it('文本格式不产生结构化 steps', () => {
    expect(parser.parse(doc).steps).toEqual([]);
  });

  it('中文名生成的 id 不为空', () => {
    // slug 化中文会得到空串，必须退回到时间戳，否则 storage 会以 '' 为 key 互相覆盖
    const skill = parser.parse(doc);
    expect(skill.id).toBeTruthy();
  });

  it('缺 name 时报错', () => {
    expect(() => parser.parse('---\ndescription: 只有描述\n---\n正文')).toThrow(/name/i);
  });

  it('toMarkdown → parse 往返保持内容', () => {
    const original = parser.parse(doc);
    const round = parser.parse(parser.toMarkdown(original));

    expect(round.name).toBe(original.name);
    expect(round.description).toBe(original.description);
    expect(round.category).toBe(original.category);
    expect(round.version).toBe(original.version);
    expect(round.tags).toEqual(original.tags);
    expect(round.instructions.trim()).toBe(original.instructions.trim());
    expect(round.parameters).toEqual(original.parameters);
  });

  it('含冒号的字段被引号包住，往返不破格式', () => {
    const skill: Skill = {
      id: 'x',
      name: '标题: 带冒号',
      description: '说明中有: 冒号 和 #井号',
      instructions: '正文',
      version: '1.0.0',
      category: 'custom',
      author: 'me',
      tags: [],
      parameters: [],
      steps: [],
      executionMode: 'both',
    };
    const round = parser.parse(parser.toMarkdown(skill));
    expect(round.name).toBe('标题: 带冒号');
    expect(round.description).toBe('说明中有: 冒号 和 #井号');
  });

  it('parseMultiple 按 frontmatter 起始切分（不会被 --- 分隔符搞混）', () => {
    const multi = `---
name: 技能一
description: 第一个
---

正文一

---
name: 技能二
description: 第二个
---

正文二`;
    const skills = parser.parseMultiple(multi);
    expect(skills).toHaveLength(2);
    expect(skills[0].name).toBe('技能一');
    expect(skills[0].instructions.trim()).toBe('正文一');
    expect(skills[1].name).toBe('技能二');
    expect(skills[1].instructions.trim()).toBe('正文二');
  });
});

describe('MarkdownParser - 旧章节格式向后兼容', () => {
  const legacy = `# Old Skill

## Description
一个旧格式的技能

## Category
automation

## Parameters
- \`query\` (string, required): 搜索词

## Steps
1. go_to_url: 打开首页 | params: {"url": "https://example.com"} | onError: stop
2. click_element: 点击搜索 | params: {"selector": "#search"} | onError: continue

## Execution Mode
expanded`;

  it('仍能解析出元信息、参数和步骤', () => {
    const skill = parser.parse(legacy);
    expect(skill.name).toBe('Old Skill');
    expect(skill.description).toBe('一个旧格式的技能');
    expect(skill.category).toBe('automation');
    expect(skill.executionMode).toBe('expanded');
    expect(skill.parameters[0]).toMatchObject({ name: 'query', type: 'string', required: true });
    expect(skill.steps).toHaveLength(2);
    expect(skill.steps[0]).toMatchObject({ action: 'go_to_url', onError: 'stop' });
    expect(skill.steps[0].parameters).toEqual({ url: 'https://example.com' });
    expect(skill.steps[1].parameters).toEqual({ selector: '#search' });
  });

  it('旧格式没有 instructions —— 由 steps 补出正文，且带上定位信息', () => {
    const skill = parser.parse(legacy);
    expect(skill.instructions).toContain('打开首页');
    expect(skill.instructions).toContain('点击搜索');
    // locator 是录制/旧数据的核心价值，不能在转换中丢掉
    expect(skill.instructions).toContain('https://example.com');
    expect(skill.instructions).toContain('#search');
  });
});

describe('renderSkillBody - 注入渲染', () => {
  const skill = {
    id: 'demo',
    name: '演示',
    description: '演示技能',
    instructions: '搜索 {{query}}，最多看 {{maxSources}} 个来源',
    parameters: [
      { name: 'query', required: true, description: '搜索词' },
      { name: 'maxSources', required: false, description: '来源数量' },
    ],
    steps: [],
  };

  it('替换已提供的占位符', () => {
    const out = renderSkillBody(skill, { query: '天气', maxSources: 3 });
    expect(out).toBe('搜索 天气，最多看 3 个来源');
    expect(out).not.toContain('{{');
  });

  it('未提供的占位符要显式列出，而不是静默留着 {{x}}', () => {
    const out = renderSkillBody(skill, { query: '天气' });
    expect(out).toContain('搜索 天气');
    // 保留原占位符 + 追加待补说明，让 LLM 知道要推断或问用户
    expect(out).toContain('{{maxSources}}');
    expect(out).toContain('尚未提供取值');
    expect(out).toContain('来源数量');
  });

  it('必填参数缺失时标注「必填」', () => {
    const out = renderSkillBody(skill, {});
    expect(out).toMatch(/\{\{query\}\}（必填）/);
  });

  it('没有 instructions 时退回渲染 steps，并保留 selector', () => {
    const out = renderSkillBody({
      id: 'rec',
      name: '录制的',
      description: '录制产物',
      steps: [
        { action: 'go_to_url', description: '打开页面', parameters: { url: 'https://a.com' } },
        { action: 'click_element', description: '点提交', parameters: { selector: '#submit' } },
      ],
    });
    expect(out).toContain('1. 打开页面');
    expect(out).toContain('url=https://a.com');
    expect(out).toContain('2. 点提交');
    expect(out).toContain('selector=#submit');
  });

  it('既无正文也无步骤时退回描述', () => {
    expect(renderSkillBody({ id: 'e', name: '空', description: '兜底描述', steps: [] })).toBe('兜底描述');
  });

  it('支持 a.b 形式的嵌套取值', () => {
    const out = renderSkillBody(
      { id: 'n', name: 'n', description: 'd', instructions: '填 {{fields.name}}' },
      {
        fields: { name: '张三' },
      },
    );
    expect(out).toBe('填 张三');
  });
});

describe('renderSkillAsTask', () => {
  it('带上技能名并注入正文', () => {
    const out = renderSkillAsTask(
      { id: 'x', name: '查快递', description: '查询物流', instructions: '查 {{no}}' },
      { no: 'SF123' },
    );
    expect(out).toContain('执行 Skill: 查快递');
    expect(out).toContain('查询物流');
    expect(out).toContain('查 SF123');
  });
});

describe('内置 skill 已迁移到文本格式', () => {
  it.each(builtInSkills.map(s => [s.id, s] as const))('%s 有正文、无硬编码 steps', (_id, skill) => {
    expect(skill.instructions.trim().length).toBeGreaterThan(0);
    // 旧版内置 skill 写着 index: 3「通常是广告之后的第一条自然结果」，
    // 换页面必错。改成文本后不应再有结构化步骤。
    expect(skill.steps).toEqual([]);
  });

  it('内置 skill 能序列化成文本并解析回来', () => {
    for (const skill of builtInSkills) {
      const round = parser.parse(parser.toMarkdown(skill));
      expect(round.name).toBe(skill.name);
      expect(round.instructions.trim()).toBe(skill.instructions.trim());
      expect(round.parameters.map(p => p.name)).toEqual(skill.parameters.map(p => p.name));
    }
  });
});
