import { MarkdownParser, type SkillCategory } from '@extension/skills';
import { userSkillsStore } from '@extension/storage';

/**
 * AI 创建 skill（方案 A：AI 只写 frontmatter + 散文正文，不产结构化步骤）。
 *
 * 三条约束与 `createWorkflowFromAI` 同源，但取舍不同：
 *
 *  1. **不需要「待确认」状态**。skill 是提示词模板，执行时仍由 AI 逐步判断、每步都
 *     受同一套动作权限约束，没有「未经审核的图直接操作浏览器」那种风险。所以
 *     AI 建的 skill 立即可用，只在设置页标出来源。
 *  2. **每轮任务有创建上限**，理由同工作流：AI 卡住时会反复「换个写法再建一个」。
 *  3. **绝不覆盖已有 skill**。`importSkillPackages` 是按 id 覆盖写入的，而 id 由名字
 *     slug 化而来 —— AI 用一个和用户已有 skill 同名的名字创建就会静默替换掉它。
 *     撞 id 时加后缀，语义上永远只「多一条」。
 */

/** 单轮任务里 AI 最多能创建几个 skill。理由见 `MAX_WORKFLOW_CREATES_PER_TASK`。 */
export const MAX_SKILL_CREATES_PER_TASK = 5;

export interface SkillCreateInput {
  name: string;
  description: string;
  category?: SkillCategory;
  parameters?: Array<{
    name: string;
    type?: 'string' | 'number' | 'boolean';
    required?: boolean;
    description: string;
  }>;
  instructions: string;
}

export interface SkillCreateResult {
  success: boolean;
  skillId?: string;
  /** 逐条中文错误，原样喂回 AI 让它自我修正。 */
  errors?: string[];
}

/** 参数名要能安全出现在 `{{name}}` 模板里。 */
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validate(input: SkillCreateInput): string[] {
  const errors: string[] = [];

  if (!input.name?.trim()) errors.push('skill 缺少 name');
  if (!input.description?.trim()) errors.push('skill 缺少 description');
  if (!input.instructions?.trim()) errors.push('skill 缺少 instructions（正文不能为空）');

  const seen = new Set<string>();
  for (const p of input.parameters ?? []) {
    if (!PARAM_NAME_RE.test(p.name ?? '')) {
      errors.push(`参数名 "${p.name}" 不合法：只允许字母、数字、下划线，且不能以数字开头`);
      continue;
    }
    if (seen.has(p.name)) {
      errors.push(`参数名 "${p.name}" 重复`);
    }
    seen.add(p.name);
  }

  // 声明了参数却没在正文里用到，说明 AI 想岔了：要么正文漏了这一步，要么参数是多余的。
  // 这类 skill 执行时会向用户索要一个根本不影响结果的值。
  for (const p of input.parameters ?? []) {
    if (PARAM_NAME_RE.test(p.name ?? '') && !input.instructions?.includes(`{{${p.name}}}`)) {
      errors.push(`参数 "${p.name}" 在 instructions 里没有被 {{${p.name}}} 引用过`);
    }
  }

  return errors;
}

/** 把输入拼成 MarkdownParser 认识的「frontmatter + 正文」文本。 */
function toMarkdown(input: SkillCreateInput): string {
  const lines = ['---', `name: ${input.name.trim()}`, `description: ${input.description.trim()}`];
  lines.push(`category: ${input.category ?? 'custom'}`);

  const params = input.parameters ?? [];
  if (params.length > 0) {
    lines.push('parameters:');
    for (const p of params) {
      lines.push(`  - name: ${p.name}`);
      lines.push(`    type: ${p.type ?? 'string'}`);
      lines.push(`    required: ${p.required ?? true}`);
      lines.push(`    description: ${p.description}`);
    }
  }

  lines.push('---', '', input.instructions.trim(), '');
  return lines.join('\n');
}

export async function createSkillFromAI(input: SkillCreateInput, createdCount: number): Promise<SkillCreateResult> {
  if (createdCount >= MAX_SKILL_CREATES_PER_TASK) {
    return {
      success: false,
      errors: [
        `本轮任务已创建 ${createdCount} 个技能，达到上限 ${MAX_SKILL_CREATES_PER_TASK}。` +
          `不要再创建了，请直接告诉用户已创建的技能。`,
      ],
    };
  }

  const errors = validate(input);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  let parsed;
  try {
    parsed = new MarkdownParser().parse(toMarkdown(input));
  } catch (error) {
    return { success: false, errors: [error instanceof Error ? error.message : '解析 skill 失败'] };
  }

  // 撞 id 就换一个 —— 绝不覆盖用户已有的 skill
  const existing = await userSkillsStore.getAllSkills();
  const taken = new Set(existing.map(s => s.id));
  const id = taken.has(parsed.id) ? `${parsed.id}-${Date.now().toString(36)}` : parsed.id;

  const result = await userSkillsStore.importSkillPackages([
    {
      skill: { ...parsed, id },
      packageInfo: {
        hasScripts: false,
        hasReferences: false,
        hasAssets: false,
        createdAt: Date.now(),
        source: 'ai_created',
      },
    },
  ]);

  if (result.errors.length > 0) {
    return { success: false, errors: result.errors };
  }

  return { success: true, skillId: id };
}
