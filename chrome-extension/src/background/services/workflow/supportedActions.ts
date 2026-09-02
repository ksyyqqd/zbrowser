/**
 * 工作流 automation 节点支持的动作白名单。
 *
 * 为什么需要它：`workflow_create` 让 AI 产出 automation 步骤，而 LLM 很擅长编出
 * `fill_form`、`click_button`、`scroll_down` 这类听起来完全合理但并不存在的动作名。
 * 不在创建时拦下，就要等到用户真正执行工作流时才报 `Unknown action`，届时这个坏
 * 工作流已经存进 store、并且用户以为它是可用的。
 *
 * 这份清单必须与 `background/index.ts` 里 `handleExecuteWorkflow` 内 `actionExecutor`
 * 的 switch 分支保持一致 —— 那个 switch 才是真正的执行入口，这里只是它的可校验副本。
 * `__tests__/supportedActions.test.ts` 会直接解析 index.ts 的 case 标签来比对两边，
 * 所以新增动作时漏改这份清单会让测试失败，而不是留到运行时。
 *
 * 注意这份清单与 Navigator 的动作注册表**不是**同一套：Navigator 有 ask_user、done、
 * skill_invoke 等只在对话里有意义的动作，工作流节点里没有它们的位置。
 */
export const WORKFLOW_AUTOMATION_ACTIONS = [
  'go_to_url',
  'click_element',
  'input_text',
  'scroll_to_percent',
  'scroll_to_top',
  'scroll_to_bottom',
  'wait',
  'send_keys',
  'go_back',
  'go_forward',
  'open_tab',
  'close_tab',
  'switch_tab',
  'select_dropdown_option',
  'scroll_to_text',
  'get_dropdown_options',
  'cache_content',
] as const;

export type WorkflowAutomationAction = (typeof WORKFLOW_AUTOMATION_ACTIONS)[number];
