import type { Skill, SkillStep } from '../types/skill';

/**
 * 把 skill 渲染成注入给 LLM 的文本。
 *
 * 通用格式下 skill 的主体是 `instructions`（自由 Markdown 正文），这里负责：
 * 1. 优先用 instructions；旧数据没有它就退回把 steps 渲染成编号清单
 * 2. 解析 `{{param}}` 占位符——已提供的参数直接替换，未提供的保留原样并在末尾
 *    列出待补参数，让 LLM 知道需要向用户确认什么
 *
 * 之前 SidePanel 和 background 各写一份「拍平 steps」的逻辑，都只取
 * `description || action`，把参数、条件、错误处理全丢了。统一到这里。
 */

/** 渲染时可接受的最小 skill 形状（storage 里的 UserSkillConfig 也满足） */
export interface RenderableSkill {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  parameters?: Array<{ name: string; required?: boolean; description?: string; default?: unknown }>;
  steps?: Array<Pick<SkillStep, 'action' | 'description' | 'parameters'>>;
}

/**
 * 把结构化步骤渲染成编号清单。录制产物没有 instructions 时用。
 */
function renderSteps(steps: RenderableSkill['steps']): string {
  if (!steps || steps.length === 0) return '';

  const lines: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const desc = step.description?.trim() || step.action;
    lines.push(`${i + 1}. ${desc}`);

    // 定位信息对复现很关键，之前的拍平逻辑把它整个丢掉了，
    // 导致录制的 skill 注入后 LLM 完全不知道该点哪里。
    const p = step.parameters ?? {};
    const detail: string[] = [];
    const pick = (key: string): string => (typeof p[key] === 'string' ? (p[key] as string) : '');
    const url = pick('url');
    const selector = pick('selector');
    const xpath = pick('xpath');
    const text = pick('text');
    if (url) detail.push(`url=${url}`);
    if (selector) detail.push(`selector=${selector}`);
    if (xpath) detail.push(`xpath=${xpath}`);
    if (text) detail.push(`输入内容=${text}`);
    if (detail.length) lines.push(`   （${detail.join('，')}）`);
  }
  return lines.join('\n');
}

/**
 * 替换 `{{param}}` 占位符。
 *
 * @returns 替换后的文本，以及仍未提供值的参数名
 */
function resolvePlaceholders(text: string, params: Record<string, unknown>): { resolved: string; missing: string[] } {
  const missing = new Set<string>();

  const resolved = text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, rawKey: string) => {
    // 支持 a.b.c 取值
    const value = rawKey.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, params as unknown);

    if (value === undefined || value === null || value === '') {
      missing.add(rawKey);
      return match;
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });

  return { resolved, missing: [...missing] };
}

/**
 * 渲染 skill 正文（不含包裹标签），供需要自定义外层格式的调用方使用。
 */
export function renderSkillBody(skill: RenderableSkill, params: Record<string, unknown> = {}): string {
  const raw = skill.instructions?.trim() || renderSteps(skill.steps);
  if (!raw) {
    // 既没正文也没步骤：至少把描述给出去，比什么都不给好
    return skill.description?.trim() || '';
  }

  const { resolved, missing } = resolvePlaceholders(raw, params);
  if (missing.length === 0) return resolved;

  // 未填参数不静默留着 {{x}} —— 明确告诉 LLM 这些要先问用户或自行推断
  const hints = missing.map(name => {
    const def = skill.parameters?.find(p => p.name === name);
    const desc = def?.description ? `：${def.description}` : '';
    const required = def?.required ? '（必填）' : '';
    return `- {{${name}}}${required}${desc}`;
  });

  return `${resolved}

以下占位符尚未提供取值，请结合用户原始请求推断，推断不出就用 ask_user 询问：
${hints.join('\n')}`;
}

/**
 * 渲染成注入用户消息的完整片段（带 <nano_selected_skill> 包裹）。
 */
export function renderSkillForPrompt(skill: RenderableSkill, params: Record<string, unknown> = {}): string {
  const body = renderSkillBody(skill, params);
  const attrs = [
    `id="${escapeAttr(skill.id)}"`,
    `name="${escapeAttr(skill.name)}"`,
    `description="${escapeAttr(skill.description ?? '')}"`,
  ].join(' ');

  return `<nano_selected_skill ${attrs}>
${body}
</nano_selected_skill>`;
}

/**
 * 渲染成独立任务描述（没有用户输入文本、直接执行 skill 时用）。
 */
export function renderSkillAsTask(skill: RenderableSkill, params: Record<string, unknown> = {}): string {
  const body = renderSkillBody(skill, params);
  const header = `执行 Skill: ${skill.name}`;
  const desc = skill.description?.trim();
  return [header, desc && desc !== skill.name ? desc : '', '', body].filter(Boolean).join('\n');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 供 Skill 类型判断是否为纯文本 skill（无结构化步骤） */
export function isTextOnlySkill(skill: Pick<Skill, 'steps'>): boolean {
  return !skill.steps || skill.steps.length === 0;
}
