/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from './base';
import { type HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { createLogger } from '@src/background/log';
import { MCP_ENABLED } from '@extension/shared';
import { navigatorSystemPromptTemplate } from './templates/navigator';

const logger = createLogger('agent/prompts/navigator');

export interface NavigatorPromptOptions {
  /**
   * 每序列最多规划的动作数。批量规划的说明写在 templates/navigator.ts 第 2 节里，
   * 这个值只是填它的占位符——曾经另有一个 multiActionEnabled 开关在此追加
   * 「单动作模式」段落，和模板里的批量说明直接矛盾，已移除。
   */
  maxActionsPerStep?: number;
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

    const { maxActionsPerStep = 10, autonomousMode = false } = options;

    let promptTemplate = navigatorSystemPromptTemplate;

    // MCP 屏蔽时整段摘掉：mcp_* 动作此时没有注册，留着说明只会诱导模型
    // 调用不存在的动作（模板里还明确写着"首先使用 mcp_list_tools"），白耗一步。
    if (!MCP_ENABLED) {
      promptTemplate = promptTemplate.replace(/<!-- MCP_SECTION_START -->[\s\S]*?<!-- MCP_SECTION_END -->\n?/, '');
    }

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
