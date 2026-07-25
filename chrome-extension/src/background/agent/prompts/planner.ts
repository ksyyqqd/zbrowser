/* eslint-disable @typescript-eslint/no-unused-vars */
import { BasePrompt } from './base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { plannerSystemPromptTemplate } from './templates/planner';

export class PlannerPrompt extends BasePrompt {
  private systemMessage: SystemMessage;

  constructor(private readonly autonomousMode: boolean = false) {
    super();

    let promptTemplate = plannerSystemPromptTemplate;

    if (autonomousMode) {
      // 移除 Planner prompt 中 ask_user 的文本描述
      const askUserSectionRegex =
        /ask_user.*?\n.*?不要用 ask_user 来回避思考.*?\n.*?弹窗回来后会重新规划.*?\n.*?ask_user 对象格式:\n.*?\{.*?\n.*?"question".*?\n.*?"context".*?\n.*?"options".*?\n.*?"allow_free_text".*?\n.*?"allow_element_pick".*?\n.*?\}.*?\n.*?用户回答后会作为/;
      promptTemplate = promptTemplate.replace(askUserSectionRegex, '');
      // 也移除前面提到 ask_user 的字段说明行
      promptTemplate = promptTemplate.replace(
        /"ask_user": "\[可选对象\]，仅当你判断必须先得到用户澄清才能继续时填写，否则省略或设为 null"\n/,
        '',
      );
      // 移除独立段落的 ask_user 使用规则
      const askUserRuleSectionRegex =
        /# 用户澄清 \(ask_user\) 字段使用规则:[^]*?- 用户回答后会作为 \[User clarification\] .*?\n/;
      promptTemplate = promptTemplate.replace(askUserRuleSectionRegex, '');
    }

    this.systemMessage = new SystemMessage(promptTemplate.trim());
  }

  getSystemMessage(): SystemMessage {
    return this.systemMessage;
  }

  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    return new HumanMessage('');
  }
}
