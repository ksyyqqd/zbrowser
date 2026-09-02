import { z } from 'zod';
import type { ActionSchema } from './schemas';

/**
 * 工作流相关动作的 schema。
 *
 * **AI 不执行工作流**，只创建和修改。理由：工作流是固定图，执行时不再逐节点决策，
 * 一旦 AI 能自己触发它，就等于让 AI 拿一个不可中途纠偏的脚本去操作用户的浏览器。
 * 执行的入口只有一个 —— 用户在 UI 上点。所以这里没有 `workflow_invoke`。
 *
 * 与 skill_* 的分工（这条边界要写在描述里，否则 AI 会随机挑一个）：
 *  - skill 是**提示词模板**，展开成自然语言指令后仍由 AI 逐步执行，每步都能适应页面变化
 *  - workflow 是**固定图**，节点和顺序都已定死，执行时不重新决策
 *
 * 所以：步骤稳定、需要可重复的，做成 workflow 交给用户执行；需要 AI 现场判断的，
 * 用 skill 并且可以由 AI 自己调用。
 */

/**
 * 步骤定义。create 和 update 共用 —— update 是整体替换步骤列表，形状和创建时一致，
 * 分开写只会让两处描述慢慢漂移。
 */
const stepSchema = z.object({
  kind: z.enum(['automation', 'ai', 'output']),
  name: z.string().optional().describe('Step label shown on the canvas'),
  description: z.string().optional(),
  action: z.string().optional().describe('automation only: the browser action name'),
  parameters: z.record(z.unknown()).optional().describe('automation only: action parameters'),
  prompt: z.string().optional().describe('ai only: what the AI should do at this step'),
  output_variable: z.string().optional().describe('ai only: variable name to store the result in'),
  content: z.string().optional().describe('output only: text to report, may use {{variable}}'),
});

const variableSchema = z.object({
  name: z.string().describe('Variable name: letters, digits, underscore only; cannot start with a digit'),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  required: z.boolean().optional().default(false),
  description: z.string().optional(),
  default: z.string().optional().describe('Default value, as a string'),
});

/** create 和 update 的描述里都要出现的步骤说明，避免两边写法不一致。 */
const STEP_KINDS_DOC = `Step kinds:
  - automation: one browser action. Requires \`action\` (must be a real action name you have available, e.g. go_to_url / click_element / input_text) plus its \`parameters\`.
  - ai: a step needing judgement at run time. Requires \`prompt\`; set \`output_variable\` to store its result for later steps.
  - output: report a result to the user. Requires \`content\`, which may interpolate variables as {{name}}.
Branching and loops are not supported here — keep the flow linear and tell the user they can add branches in the editor.`;

/**
 * 列出已有工作流。
 *
 * 给 AI 看的用途是**修改前的定位**（用户说「改一下我那个报表流程」），不是为了执行。
 * 未确认的工作流也列出来 —— AI 需要能改自己刚创建的那个。
 */
export const workflowListActionSchema: ActionSchema = {
  name: 'workflow_list',
  description:
    'List saved workflows. Use this to locate a workflow the user wants to modify. You cannot execute workflows — only the user can run them from the UI.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
  }),
};

/**
 * 取单个工作流的摘要。
 *
 * 返回的是裁剪后的 `WorkflowSummary`（入参声明 + 节点名列表），不是完整的图 ——
 * 坐标和边对「这个工作流现在长什么样、要怎么改」这个判断没有信息量。
 */
export const workflowGetInfoActionSchema: ActionSchema = {
  name: 'workflow_get_info',
  description:
    'Get a workflow summary: its input variables and the ordered list of step names. Call this before workflow_update so you know what the workflow currently does.',
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    workflow_id: z.string().describe('The ID of the workflow'),
  }),
};

/**
 * 创建工作流。
 *
 * schema 刻意只收**线性步骤列表**，不收节点坐标、不收 edges、不收 condition/loop：
 *  - 坐标和边是纯机械推导，让 LLM 算它只会把节点堆在一起、把边写错
 *  - 分支和循环要求模型同时想清楚拓扑和布局，是另一个量级的难度，第一版不开放，
 *    用户可以在编辑器里自己加
 *
 * 转换和校验都在 `stepsToWorkflow`（packages/workflow）里，schema 这层只做形状约束。
 */
export const workflowCreateActionSchema: ActionSchema = {
  name: 'workflow_create',
  description: `Create a new workflow from a linear list of steps. Use this when the user asks to save a repeatable procedure. Provide only the ordered steps — node positions, edges, and start/end nodes are derived automatically.
${STEP_KINDS_DOC}
The created workflow is saved as UNREVIEWED: the user must confirm it in the editor before they can run it. You cannot run it yourself — tell the user it is ready for review instead.`,
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    name: z.string().describe('Workflow name, short and descriptive'),
    description: z.string().optional().default('').describe('What this workflow does, one sentence'),
    variables: z
      .array(variableSchema)
      .optional()
      .default([])
      .describe('Input variables the workflow accepts, referenced in steps as {{name}}'),
    steps: z.array(stepSchema).min(1).describe('Ordered steps. At least one.'),
  }),
};

/**
 * 修改已有工作流。
 *
 * 描述里必须写死两件事，否则模型会犯这两个错：
 *  1. **先读再改**。不调 `workflow_get_info` 就改，等于凭猜测覆盖用户的图。
 *  2. **steps 是整体替换**。模型的默认预期是「我只写要改的那步」，而实现是整体替换，
 *     这个错配会直接把工作流缩成一步。
 */
export const workflowUpdateActionSchema: ActionSchema = {
  name: 'workflow_update',
  description: `Modify an existing workflow. Call workflow_get_info first — you must know what the workflow currently contains before changing it.
\`steps\` REPLACES the entire step list, it is not a patch: to change one step, send every step including the unchanged ones. Omit \`steps\` entirely if you only want to rename the workflow or adjust its variables.
${STEP_KINDS_DOC}
The workflow returns to UNREVIEWED after any edit, so the user has to confirm it again before running it. There is no undo — if the user only wants a small tweak and you are unsure of the current contents, ask them rather than guessing.`,
  schema: z.object({
    intent: z.string().default('').describe('purpose of this action'),
    workflow_id: z.string().describe('The ID of the workflow to modify'),
    name: z.string().optional().describe('New name. Omit to keep the current one.'),
    description: z.string().optional().describe('New description. Omit to keep the current one.'),
    variables: z.array(variableSchema).optional().describe('Replaces all input variables. Omit to keep them as-is.'),
    steps: z
      .array(stepSchema)
      .min(1)
      .optional()
      .describe('Replaces ALL steps in order. Omit to leave the steps untouched.'),
  }),
};
