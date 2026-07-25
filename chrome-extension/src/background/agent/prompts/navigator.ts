/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from './base';
import { type HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { createLogger } from '@src/background/log';
import { navigatorSystemPromptTemplate } from './templates/navigator';

const logger = createLogger('agent/prompts/navigator');

export interface NavigatorPromptOptions {
  maxActionsPerStep?: number;
  /**
   * 连续动作模式（实验性功能）。开启后 prompt 会强烈引导 AI 一次规划多个动作。
   * 关闭时恢复单动作模式（更稳定）。
   */
  multiActionEnabled?: boolean;
  /** 连续动作模式下最多规划动作数，仅在 multiActionEnabled=true 时生效 */
  maxMultiActions?: number;
  /**
   * 自主模式。开启后 prompt 中移除 ask_user 描述、闸门触发问用户的说明，
   * LLM 将不主动询问用户，遇到不确定的元素时自行判断。
   */
  autonomousMode?: boolean;
}

export class NavigatorPrompt extends BasePrompt {
  private systemMessage: SystemMessage;

  constructor(private readonly options: NavigatorPromptOptions = {}) {
    super();

    const { maxActionsPerStep = 10, multiActionEnabled = false, maxMultiActions = 3, autonomousMode = false } = options;

    let promptTemplate = navigatorSystemPromptTemplate;

    // 替换最大动作数占位符
    promptTemplate = promptTemplate.replace('{{max_actions}}', maxActionsPerStep.toString());

    // 自主模式：移除 ask_user 描述段落和闸门中"问用户"的说明
    if (autonomousMode) {
      // 移除第12节 "用户澄清 (ask_user)" 整段
      const askUserSectionRegex =
        /12\. 用户澄清 \(ask_user\)[^]*?- 不要用 ask_user：\n  - 仅仅因为某一步失败就 ask_user[^]*?按字面意思处理。\n/;
      promptTemplate = promptTemplate.replace(askUserSectionRegex, '');

      // 修改闸门说明：不再说"触发用户澄清弹窗"，改为"系统自动跳过该动作"
      promptTemplate = promptTemplate.replace(
        /任何一项答 "否"，confidence 不得超过 0\.6（会触发用户澄清弹窗）/,
        '任何一项答 "否"，confidence 不得超过 0.6（系统将自动跳过该动作）',
      );
      promptTemplate = promptTemplate.replace(
        /\| \*\*0\.40~0\.69\*\*（\*\*触发闸门\*\*）[^|]*\|/,
        '| **0.40~0.69**（**触发闸门，自动跳过**） | 5 项中任意一项 ❌；尤其是"无文本/aria-label 的纯 icon 按钮" |',
      );
      promptTemplate = promptTemplate.replace(/上限 0\.6，必须问用户/g, '上限 0.6，系统自动跳过');

      // 注入自主模式说明
      const autonomousPrompt = `
# 自主模式（已启用）

你现在处于**自主模式**——系统不会向用户请求澄清。请遵循以下规则：

- **自行判断**：遇到不确定的情况时，基于可用信息做出最合理的推断，不要犹豫
- **优先稳定操作**：如果对某个元素不太确定，优先选择有明显文本标识的元素，避免纯 icon
- **允许试错**：如果第一次尝试失败了，自动调整策略重试，而不是停下等待指导
- **跳过不确定步骤**：如果某个动作的置信度过低（<0.7），系统会自动跳过该动作——你会在 action result 里看到跳过提示，继续下一步即可`;
      promptTemplate += autonomousPrompt;
    }

    // 根据是否开启连续动作模式，注入不同的行为指令
    if (multiActionEnabled) {
      const multiActionPrompt = `
# 连续动作模式（已启用）

为了提升执行效率，你现在处于**连续动作模式**。请遵循以下额外规则：

- **尽量批量规划**：在不导致页面重大变化的前提下，请在 action 数组中规划 **2-${maxMultiActions} 个连续动作**。
  - 例如：先填写多个表单字段，再一次点击提交，而不是分多次请求
  - 例如：先滚动到目标区域，再点击元素，再填写内容
- **何时只用一个动作**：以下情况 action 数组只放一个动作：
  - 执行 go_to_url / done 等会改变上下文或结束任务的动作
  - 下一步依赖当前动作的结果才能决定（如搜索结果不确定）
  - 页面即将发生不可逆变化（如提交订单、支付、发送消息）
- **中断机制**：如果执行过程中页面出现新元素，序列会自动中断——这是预期行为，不用在意`;
      promptTemplate += multiActionPrompt;
    } else {
      const singleActionPrompt = `
# 动作模式

当前处于**单动作模式**：每次 action 数组中只规划一个动作，确保每一步都经过充分验证。`;
      promptTemplate += singleActionPrompt;
    }

    this.systemMessage = new SystemMessage(promptTemplate.trim());
  }

  getSystemMessage(): SystemMessage {
    /**
     * Get the system prompt for the agent.
     *
     * @returns SystemMessage containing the formatted system prompt
     */
    return this.systemMessage;
  }

  async getUserMessage(context: AgentContext, useLiveState = true): Promise<HumanMessage> {
    return await this.buildBrowserStateUserMessage(context, useLiveState);
  }
}
