import type { Skill, SkillParameter, SkillStep, SkillCategory } from '../types/skill';

const VALID_CATEGORIES: SkillCategory[] = [
  'navigation',
  'data-extraction',
  'form-interaction',
  'analysis',
  'automation',
  'custom',
];
const VALID_PARAM_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;

type ParamType = (typeof VALID_PARAM_TYPES)[number];

/**
 * Skill 的通用文本格式解析 / 序列化。
 *
 * 目标格式是「YAML frontmatter + 自由 Markdown 正文」，和社区通用的 Agent Skill
 * 写法一致：元信息放 frontmatter，正文就是给 LLM 读的指令，不需要拆成可机械执行
 * 的动作序列。
 *
 * ```
 * ---
 * name: 查快递
 * description: 在快递官网查询单号状态
 * category: navigation
 * version: 1.0.0
 * parameters:
 *   - name: trackingNo
 *     type: string
 *     required: true
 *     description: 快递单号
 * ---
 *
 * 1. 打开 https://www.kuaidi100.com
 * 2. 把 {{trackingNo}} 填进查询框
 * 3. 读出最新一条物流状态并回复
 * ```
 *
 * 旧的章节式格式（`# 名称` + `## Steps` 里 `1. action: 描述 | params: {...}`）
 * 仍然能解析——用户存量 skill 和录制产物都是那个形状，直接拒掉会丢数据。
 * 判定方式：有 frontmatter 就走新路径，否则退回旧解析。
 */
export class MarkdownParser {
  /**
   * Parse a single skill from text (frontmatter format, or legacy section format)
   */
  parse(markdown: string): Skill {
    const fm = this.splitFrontmatter(markdown);
    return fm ? this.parseFrontmatterFormat(fm.frontmatter, fm.body) : this.parseLegacyFormat(markdown);
  }

  /**
   * Parse multiple skills from a document.
   *
   * frontmatter 自己就用 `---` 当分隔符，所以不能像旧版那样无脑按 `---` 切。
   * 这里按「一段 frontmatter 起始」为界切分：每次遇到处于文档开头或空行之后的
   * `---`，且它后面能配上一个闭合 `---`，就当作新 skill 的开始。
   */
  parseMultiple(markdown: string): Skill[] {
    const chunks = this.splitDocuments(markdown);
    const skills: Skill[] = [];

    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      try {
        skills.push(this.parse(trimmed));
      } catch (error) {
        console.warn('Failed to parse skill:', error);
      }
    }

    return skills;
  }

  /**
   * Convert a Skill to the generic text format (frontmatter + body)
   */
  toMarkdown(skill: Skill): string {
    const lines: string[] = ['---'];

    lines.push(`name: ${this.quoteIfNeeded(skill.name)}`);
    lines.push(`description: ${this.quoteIfNeeded(skill.description)}`);
    if (skill.id) lines.push(`id: ${skill.id}`);
    if (skill.version) lines.push(`version: ${this.quoteIfNeeded(skill.version)}`);
    if (skill.category) lines.push(`category: ${skill.category}`);
    if (skill.author) lines.push(`author: ${this.quoteIfNeeded(skill.author)}`);
    if (skill.tags?.length) lines.push(`tags: [${skill.tags.join(', ')}]`);

    if (skill.parameters?.length) {
      lines.push('parameters:');
      for (const p of skill.parameters) {
        lines.push(`  - name: ${p.name}`);
        lines.push(`    type: ${p.type}`);
        lines.push(`    required: ${p.required ? 'true' : 'false'}`);
        if (p.description) lines.push(`    description: ${this.quoteIfNeeded(p.description)}`);
        if (p.default !== undefined) lines.push(`    default: ${this.serializeScalar(p.default)}`);
        if (p.enum?.length) lines.push(`    enum: [${p.enum.join(', ')}]`);
      }
    }

    lines.push('---');
    lines.push('');

    // 正文：优先用 instructions；没有就把 steps 渲染成人类可读的编号清单，
    // 这样录制生成的 skill 打开也是一段能直接读、能直接改的文本。
    const body = skill.instructions?.trim() || this.stepsToProse(skill.steps ?? []);
    lines.push(body);

    return lines.join('\n').trimEnd() + '\n';
  }

  /**
   * Convert multiple skills to text
   */
  toMarkdownMultiple(skills: Skill[]): string {
    return skills.map(skill => this.toMarkdown(skill)).join('\n');
  }

  // ==================== frontmatter 格式 ====================

  /**
   * 把文本拆成 frontmatter 和正文。没有合法 frontmatter 时返回 null。
   */
  private splitFrontmatter(text: string): { frontmatter: string; body: string } | null {
    // 去掉 BOM：从文件导入的 skill 常带 BOM，会让首行 `---` 匹配不上
    const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = normalized.split('\n');

    // 跳过开头空行
    let start = 0;
    while (start < lines.length && !lines[start].trim()) start++;
    if (start >= lines.length || lines[start].trim() !== '---') return null;

    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        return {
          frontmatter: lines.slice(start + 1, i).join('\n'),
          body: lines.slice(i + 1).join('\n'),
        };
      }
    }

    // 有起始 `---` 但没有闭合——不当作 frontmatter，交给 legacy 分支
    return null;
  }

  private parseFrontmatterFormat(frontmatter: string, body: string): Skill {
    const meta = this.parseSimpleYaml(frontmatter);

    const name = this.asString(meta.name) || this.asString(meta.title);
    if (!name) {
      throw new Error('Skill name is required (frontmatter 里需要 name 字段)');
    }

    const instructions = body.trim();
    const rawCategory = this.asString(meta.category).toLowerCase();
    const tags = this.asStringArray(meta.tags);

    return {
      id: this.asString(meta.id) || this.generateId(name),
      name,
      description: this.asString(meta.description) || name,
      instructions,
      version: this.asString(meta.version) || '1.0.0',
      category: VALID_CATEGORIES.includes(rawCategory as SkillCategory) ? (rawCategory as SkillCategory) : 'custom',
      author: this.asString(meta.author) || 'unknown',
      tags,
      parameters: this.parseYamlParameters(meta.parameters),
      // 文本格式没有结构化步骤：正文才是内容
      steps: [],
      executionMode: this.parseExecutionMode(
        this.asString(meta.executionMode) || this.asString(meta['execution-mode']),
      ),
    };
  }

  /**
   * 极简 YAML 子集解析器。
   *
   * 只支持 skill frontmatter 实际会用到的形状：标量、`[a, b]` 内联数组、
   * `- ` 列表、以及列表项下的两层缩进键值（parameters 用）。不引入 yaml 依赖是
   * 因为这点需求不值得多一个包，而且格式由我们自己的导出函数产生，可控。
   */
  private parseSimpleYaml(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = text.split('\n');

    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line || line.startsWith('#')) {
        i++;
        continue;
      }

      const indent = raw.length - raw.trimStart().length;
      if (indent > 0) {
        // 顶层循环只处理 0 缩进的键；嵌套内容由下面的块读取消耗掉
        i++;
        continue;
      }

      const colon = line.indexOf(':');
      if (colon < 0) {
        i++;
        continue;
      }

      const key = line.substring(0, colon).trim();
      const inlineValue = line.substring(colon + 1).trim();

      if (inlineValue) {
        result[key] = this.parseYamlScalarOrInlineArray(inlineValue);
        i++;
        continue;
      }

      // 值在后续缩进行里
      const block: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.trim()) {
          block.push('');
          i++;
          continue;
        }
        const nextIndent = next.length - next.trimStart().length;
        if (nextIndent === 0) break;
        block.push(next);
        i++;
      }
      result[key] = this.parseYamlBlock(block);
    }

    return result;
  }

  /** 解析缩进块：`- ` 开头视为列表，否则视为嵌套映射 */
  private parseYamlBlock(block: string[]): unknown {
    const meaningful = block.filter(l => l.trim());
    if (meaningful.length === 0) return '';

    // 列表判定看「最外层缩进的那些行」是否以 `- ` 开头。
    // 不能要求每行都以 `- ` 开头——parameters 的续行（`    type: string`）不是。
    const baseIndentForCheck = Math.min(...meaningful.map(l => l.length - l.trimStart().length));
    const isList = meaningful.some(
      l => l.length - l.trimStart().length === baseIndentForCheck && l.trim().startsWith('- '),
    );
    if (!isList) {
      // 嵌套映射：递归时把公共缩进剥掉
      const dedented = this.dedent(meaningful);
      return this.parseSimpleYaml(dedented.join('\n'));
    }

    const items: unknown[] = [];
    let current: Record<string, unknown> | null = null;
    let currentScalar: string | null = null;

    const baseIndent = Math.min(...meaningful.map(l => l.length - l.trimStart().length));

    for (const raw of meaningful) {
      const indent = raw.length - raw.trimStart().length;
      const line = raw.trim();

      if (line.startsWith('- ') && indent === baseIndent) {
        // 收尾上一项
        if (current) items.push(current);
        else if (currentScalar !== null) items.push(currentScalar);
        current = null;
        currentScalar = null;

        const rest = line.substring(2).trim();
        const colon = rest.indexOf(':');
        if (colon > 0) {
          current = {};
          const k = rest.substring(0, colon).trim();
          const v = rest.substring(colon + 1).trim();
          if (v) current[k] = this.parseYamlScalarOrInlineArray(v);
        } else {
          currentScalar = rest;
        }
      } else if (current) {
        // 列表项下的续行键值
        const colon = line.indexOf(':');
        if (colon > 0) {
          const k = line.substring(0, colon).trim();
          const v = line.substring(colon + 1).trim();
          current[k] = this.parseYamlScalarOrInlineArray(v);
        }
      }
    }

    if (current) items.push(current);
    else if (currentScalar !== null) items.push(currentScalar);

    return items;
  }

  private dedent(lines: string[]): string[] {
    const min = Math.min(...lines.map(l => l.length - l.trimStart().length));
    return lines.map(l => l.substring(min));
  }

  private parseYamlScalarOrInlineArray(value: string): unknown {
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(',').map(v => this.unquote(v.trim()));
    }
    return this.parseYamlScalar(value);
  }

  private parseYamlScalar(value: string): unknown {
    const v = this.unquote(value);
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~') return null;
    if (v !== '' && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }

  private unquote(value: string): string {
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      return value.slice(1, -1);
    }
    return value;
  }

  private parseYamlParameters(raw: unknown): SkillParameter[] {
    if (!Array.isArray(raw)) return [];

    const params: SkillParameter[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        // 简写：`- trackingNo` 等价于必填 string
        if (item.trim()) {
          params.push({ name: item.trim(), type: 'string', description: '', required: true });
        }
        continue;
      }
      if (typeof item !== 'object' || item === null) continue;

      const obj = item as Record<string, unknown>;
      const name = this.asString(obj.name);
      if (!name) continue;

      const rawType = this.asString(obj.type) || 'string';
      const param: SkillParameter = {
        name,
        type: VALID_PARAM_TYPES.includes(rawType as ParamType) ? (rawType as ParamType) : 'string',
        description: this.asString(obj.description),
        required: obj.required === true || obj.required === 'true',
      };
      if (obj.default !== undefined) param.default = obj.default;
      const enumValues = this.asStringArray(obj.enum);
      if (enumValues.length) param.enum = enumValues;

      params.push(param);
    }
    return params;
  }

  private parseExecutionMode(value: string): 'expanded' | 'atomic' | 'both' {
    if (value === 'atomic' || value === 'expanded' || value === 'both') return value;
    return 'both';
  }

  private asString(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }

  private asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(v => this.asString(v)).filter(Boolean);
    const s = this.asString(value);
    if (!s) return [];
    return s
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }

  /**
   * 按 frontmatter 起始位置把多 skill 文档切开。
   */
  private splitDocuments(text: string): string[] {
    const lines = text.split('\n');
    const starts: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '---') continue;
      // 必须处于文档开头或空行之后，才可能是 frontmatter 起始
      const prevMeaningful = i > 0 && lines[i - 1].trim() !== '';
      if (prevMeaningful) continue;
      // 需要有闭合 `---`
      let closed = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '---') {
          closed = true;
          break;
        }
      }
      if (!closed) continue;
      // 跳过刚被认作闭合的那个（下一次循环从 body 之后再找）
      if (starts.length > 0) {
        const prevStart = starts[starts.length - 1];
        // 找上一段 frontmatter 的闭合行，i 落在其中就不是新文档的开始
        let prevClose = -1;
        for (let j = prevStart + 1; j < lines.length; j++) {
          if (lines[j].trim() === '---') {
            prevClose = j;
            break;
          }
        }
        if (i <= prevClose) continue;
      }
      starts.push(i);
    }

    if (starts.length === 0) {
      // 没有 frontmatter：退回旧的按 `---` 硬切
      return text.split(/^---\s*$/m).filter(s => s.trim().startsWith('#'));
    }

    const chunks: string[] = [];
    for (let k = 0; k < starts.length; k++) {
      const from = starts[k];
      const to = k + 1 < starts.length ? starts[k + 1] : lines.length;
      chunks.push(lines.slice(from, to).join('\n'));
    }
    return chunks;
  }

  /** 把结构化步骤渲染成人类可读正文（录制产物首次打开时用） */
  private stepsToProse(steps: SkillStep[]): string {
    if (steps.length === 0) return '';

    const lines: string[] = ['## 步骤', ''];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const desc = step.description?.trim() || step.action;
      lines.push(`${i + 1}. ${desc}`);
      // 定位信息对复现很关键，保留成子项，用户能看能改
      const locator = this.describeLocator(step.parameters);
      if (locator) lines.push(`   - ${locator}`);
    }
    return lines.join('\n');
  }

  private describeLocator(parameters: Record<string, unknown>): string {
    const parts: string[] = [];
    const url = this.asString(parameters.url);
    const selector = this.asString(parameters.selector);
    const xpath = this.asString(parameters.xpath);
    const text = this.asString(parameters.text);
    if (url) parts.push(`url: ${url}`);
    if (selector) parts.push(`selector: ${selector}`);
    if (xpath) parts.push(`xpath: ${xpath}`);
    if (text) parts.push(`输入: ${text}`);
    return parts.join('，');
  }

  private quoteIfNeeded(value: string): string {
    const v = value ?? '';
    // 冒号、井号、首尾空格、以特殊字符开头都需要引号，否则会破坏 YAML 解析
    if (/[:#]/.test(v) || v !== v.trim() || /^[-[{&*!|>%@`"']/.test(v) || v === '') {
      return `"${v.replace(/"/g, '\\"')}"`;
    }
    return v;
  }

  private serializeScalar(value: unknown): string {
    if (typeof value === 'string') return this.quoteIfNeeded(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }

  /**
   * Generate a skill ID from name
   */
  private generateId(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
    // 中文名 slug 化后会变空串，退回时间戳保证 id 唯一
    return slug || `skill-${Date.now()}`;
  }

  // ==================== 旧章节格式（向后兼容） ====================

  /**
   * 解析旧的章节式格式：`# 名称` + `## Description/Category/Parameters/Steps`。
   * 存量用户 skill 与早期导出文件都是这个形状，仍需能读进来。
   */
  private parseLegacyFormat(markdown: string): Skill {
    const lines = markdown.split('\n');
    const skill: Partial<Skill> = {
      id: '',
      name: '',
      description: '',
      instructions: '',
      version: '1.0.0',
      category: 'custom',
      author: 'unknown',
      tags: [],
      parameters: [],
      steps: [],
      executionMode: 'atomic',
    };

    let currentSection: string | null = null;
    let stepIndex = 0;
    const freeText: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('# ')) {
        skill.name = line.substring(2).trim();
        if (!skill.id) {
          skill.id = this.generateId(skill.name);
        }
        currentSection = null;
      } else if (line.startsWith('## ')) {
        currentSection = line.substring(3).trim().toLowerCase();
      } else if (line.startsWith('### ')) {
        currentSection = null;
      } else {
        switch (currentSection) {
          case 'description':
            skill.description = skill.description ? `${skill.description}\n${line}` : line;
            break;

          case 'id':
            skill.id = line;
            break;

          case 'version':
            skill.version = line;
            break;

          case 'category': {
            const categoryValue = line.toLowerCase();
            skill.category = VALID_CATEGORIES.includes(categoryValue as SkillCategory)
              ? (categoryValue as SkillCategory)
              : 'custom';
            break;
          }

          case 'parameters':
            if (line.startsWith('- ') || line.startsWith('* ')) {
              const param = this.parseParameterLine(line);
              if (param) skill.parameters!.push(param);
            }
            break;

          case 'steps':
            if (/^\d+\./.test(line)) {
              const step = this.parseStepLine(line, stepIndex);
              if (step) {
                skill.steps!.push(step);
                stepIndex++;
              }
            }
            break;

          case 'execution mode':
            if (line === 'atomic' || line === 'expanded' || line === 'both') {
              skill.executionMode = line;
            }
            break;

          default:
            // `# 名称` 之后、任何 `##` 之前的散文，当作正文
            if (currentSection === null) freeText.push(line);
            break;
        }
      }
    }

    if (!skill.name) {
      throw new Error('Skill name is required');
    }
    if (!skill.description) {
      skill.description = freeText.join('\n') || skill.name;
    }

    // 旧格式没有 instructions 概念：拿散文，没有就把步骤渲染成正文，
    // 保证转到新格式后 LLM 仍能读到内容。
    skill.instructions = freeText.join('\n').trim() || this.stepsToProse(skill.steps!);

    return skill as Skill;
  }

  /**
   * Parse a legacy parameter line
   * Format: `- `name` (type, required): description`
   */
  private parseParameterLine(line: string): SkillParameter | null {
    const content = line.replace(/^[-*]\s*/, '');

    const nameMatch = content.match(/^`([^`]+)`/);
    if (!nameMatch) return null;

    const name = nameMatch[1];
    const rest = content.substring(nameMatch[0].length).trim();

    let type: ParamType = 'string';
    let required = false;
    let description = '';

    const typeMatch = rest.match(/^\(([^)]+)\)/);
    if (typeMatch) {
      const parts = typeMatch[1].split(',').map(p => p.trim());
      const rawType = parts[0] || 'string';
      type = VALID_PARAM_TYPES.includes(rawType as ParamType) ? (rawType as ParamType) : 'string';
      required = parts.includes('required');
      description = rest.substring(typeMatch[0].length).trim();
    } else {
      description = rest;
    }

    if (description.startsWith(':')) {
      description = description.substring(1).trim();
    }

    return { name, type, description, required };
  }

  /**
   * Parse a legacy step line
   * Format: `1. action_name: Description | params: {"key": "value"} | onError: stop`
   */
  private parseStepLine(line: string, index: number): SkillStep | null {
    const content = line.replace(/^\d+\.\s*/, '');
    const parts = content.split('|').map(p => p.trim());

    const firstPart = parts[0];
    const colonIndex = firstPart.indexOf(':');
    let action: string;
    let description: string;

    if (colonIndex > 0) {
      action = firstPart.substring(0, colonIndex).trim();
      description = firstPart.substring(colonIndex + 1).trim();
    } else {
      action = firstPart.trim();
      description = '';
    }

    let parameters: Record<string, unknown> = {};
    let onError: 'stop' | 'continue' | 'retry' = 'stop';

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('params:') || part.startsWith('parameters:')) {
        const paramsStr = part.replace(/^params?(eters)?:/, '').trim();
        try {
          parameters = JSON.parse(paramsStr);
        } catch {
          const kvMatch = paramsStr.match(/^(\w+)=(.+)$/);
          if (kvMatch) {
            parameters = { [kvMatch[1]]: kvMatch[2] };
          }
        }
      } else if (/^onerror:/i.test(part)) {
        const errorValue = part
          .replace(/^onError:/i, '')
          .trim()
          .toLowerCase();
        if (errorValue === 'continue' || errorValue === 'retry') {
          onError = errorValue;
        }
      }
    }

    return {
      id: `step-${index + 1}`,
      action,
      description,
      parameters,
      onError,
    };
  }
}
