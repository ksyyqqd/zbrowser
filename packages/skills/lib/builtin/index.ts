import type { Skill } from '../types/skill';

/**
 * 内置 Skill。
 *
 * 这些 skill 用通用文本格式书写：`instructions` 是给 LLM 读的自然语言指令，
 * `steps` 留空。早先版本把它们写成结构化动作序列，里面带 `index: 3`
 * 「通常是广告之后的第一条自然结果」这类硬编码索引——换个页面就点错，
 * 而且执行器那条路径本来就没接通。改成文本后由 Navigator 自己按页面实际情况定位。
 */

/**
 * Web Research Skill
 */
export const webResearchSkill: Skill = {
  id: 'web-research',
  name: 'Web Research',
  description: '通过搜索多个来源、打开结果并提取/总结信息来研究一个主题',
  instructions: `研究主题 {{query}}，汇总多个来源的信息后给出结论。

1. 用 {{searchEngine}} 搜索 {{query}}（中文主题优先用百度）
2. 从搜索结果里挑出**看起来最相关**的条目打开——按标题和摘要判断，不要按位置数第几个，
   排序会因广告和个性化而变化
3. 读完一个来源就用 cache_content 把要点记下来，再返回搜索结果页开下一个
4. 重复到累计 {{maxSources}} 个来源，或者信息已经足够回答问题
5. 用 {{summaryStyle}} 风格汇总，并在结论里标明每条信息来自哪个来源的 URL

注意：
- 如果某个来源打不开或是登录墙，跳过它换下一个，不要卡住
- 多个来源说法冲突时，把冲突点明确写出来，不要只取一个`,
  version: '2.0.0',
  category: 'data-extraction',
  author: 'nanobrowser',
  tags: ['research', 'search', 'summary', 'multi-source'],
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: '搜索查询或研究主题',
      required: true,
    },
    {
      name: 'maxSources',
      type: 'number',
      description: '最多分析几个来源',
      required: false,
      default: 5,
      min: 1,
      max: 10,
    },
    {
      name: 'searchEngine',
      type: 'string',
      description: '使用的搜索引擎',
      required: false,
      default: 'baidu',
      enum: ['baidu', 'google', 'bing'],
    },
    {
      name: 'summaryStyle',
      type: 'string',
      description: '总结输出的风格',
      required: false,
      default: 'bullet-points',
      enum: ['bullet-points', 'paragraph', 'detailed'],
    },
  ],
  steps: [],
  executionMode: 'both',
  timeout: 120000,
  metadata: {
    examples: [
      {
        description: '研究 2024 年 AI 趋势',
        parameters: { query: 'AI 趋势 2024', maxSources: 5 },
        expectedResult: '来自多个来源的 AI 趋势总结',
      },
    ],
    documentation: '通过搜索、打开多个结果、缓存内容来完成网页研究。来源由 LLM 按相关性挑选，不依赖固定位置。',
  },
};

/**
 * Form Filling Skill
 */
export const formFillingSkill: Skill = {
  id: 'form-filling',
  name: 'Form Filling',
  description: '用给定数据自动填写表单字段，支持文本框、下拉框、复选框等',
  instructions: `把 {{fields}} 里的数据填进当前页面的表单。

1. 先看清页面上有哪些表单字段，把 {{fields}} 的每个键**按标签文字/placeholder 语义**
   对应到具体字段，不要按顺序硬套
2. 逐个填写：
   - 文本框用 input_text
   - 下拉框用 select_dropdown_option
   - 复选框/单选框用 click_element，先确认当前是否已勾选，避免反向操作
3. 填完后核对一遍每个字段的值是否正确落到位（有的输入框有联想弹层会吞掉输入）
4. 如果 {{submitAfter}} 为 true，找到提交按钮并点击
   —— 提交是不可逆动作，确认按钮文字确实是「提交/保存/确认」再点
5. 如果 {{waitForSuccess}} 为 true，提交后等待页面反馈，读出成功或失败信息

注意：
- {{fields}} 里有找不到对应字段的键，不要瞎填到别的框里，在最终结果里报告哪些没填上
- 遇到必填校验报错，读出报错文字再决定怎么修，不要反复重试同样的输入`,
  version: '2.0.0',
  category: 'form-interaction',
  author: 'nanobrowser',
  tags: ['form', 'automation', 'input', 'fill'],
  parameters: [
    {
      name: 'fields',
      type: 'object',
      description: '字段名到值的映射',
      required: true,
    },
    {
      name: 'submitAfter',
      type: 'boolean',
      description: '填完后是否提交表单',
      required: false,
      default: false,
    },
    {
      name: 'waitForSuccess',
      type: 'boolean',
      description: '提交后是否等待成功/失败提示',
      required: false,
      default: true,
    },
  ],
  steps: [],
  executionMode: 'both',
  timeout: 60000,
  metadata: {
    examples: [
      {
        description: '填写注册表单',
        parameters: {
          fields: { 姓名: '张三', 邮箱: 'zhangsan@example.com', 手机: '13800000000' },
          submitAfter: true,
        },
      },
    ],
    documentation: '字段按标签语义匹配，不依赖固定索引。',
  },
};

/**
 * Data Extraction Skill
 */
export const dataExtractionSkill: Skill = {
  id: 'data-extraction',
  name: 'Data Extraction',
  description: '从网页提取结构化数据，包括表格、列表和重复元素',
  instructions: `从当前页面提取 {{dataType}} 类型的数据，重点是 {{extractorHint}}。

1. 先滚到页面顶部，确认数据区域的整体结构（表头有哪些列、每条记录包含什么字段）
2. 用 cache_content 记录当前视口内的数据，**按字段拆开记**，不要只存一整段原文
3. 如果 {{scrollPages}} 大于 1，用 next_page 逐屏往下翻，每翻一屏就缓存一次
   —— 一次翻一屏，不要直接跳到底部，中间的数据会漏
4. 翻完或数据已收齐后，把所有缓存内容整理成结构一致的列表输出

注意：
- 分页控件（「下一页」按钮）和滚动加载是两种不同情况：有分页按钮就点它，
  无限滚动就用 next_page
- 记录条数：在 memory 里写「已提取 N 条」，避免重复或漏抓
- 表格类数据保持列对齐，缺失值明确标为空，不要自己补`,
  version: '2.0.0',
  category: 'data-extraction',
  author: 'nanobrowser',
  tags: ['extract', 'data', 'scrape', 'table', 'list'],
  parameters: [
    {
      name: 'dataType',
      type: 'string',
      description: '要提取的数据类型',
      required: true,
      enum: ['table', 'list', 'cards', 'custom'],
    },
    {
      name: 'scrollPages',
      type: 'number',
      description: '翻页/滚动的屏数',
      required: false,
      default: 1,
      min: 0,
      max: 10,
    },
    {
      name: 'extractorHint',
      type: 'string',
      description: '提取目标提示（如「商品价格」「文章标题」）',
      required: false,
    },
  ],
  steps: [],
  executionMode: 'both',
  timeout: 90000,
  metadata: {
    examples: [
      {
        description: '从电商页面提取商品信息',
        parameters: { dataType: 'cards', scrollPages: 3, extractorHint: '商品名称和价格' },
      },
      {
        description: '提取表格数据',
        parameters: { dataType: 'table', scrollPages: 0, extractorHint: '财务数据' },
      },
    ],
    documentation: '通过滚动和缓存内容提取结构化数据，缓存内容由 LLM 整理成最终输出。',
  },
};

/**
 * All built-in skills
 */
export const builtInSkills: Skill[] = [webResearchSkill, formFillingSkill, dataExtractionSkill];

/**
 * Get built-in skill by ID
 */
export function getBuiltInSkill(id: string): Skill | undefined {
  return builtInSkills.find(s => s.id === id);
}

/**
 * Get all built-in skills
 */
export function getAllBuiltInSkills(): Skill[] {
  return [...builtInSkills];
}
