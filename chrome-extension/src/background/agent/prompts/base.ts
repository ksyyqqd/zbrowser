import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { wrapUntrustedContent } from '../messages/utils';
import { createLogger } from '@src/background/log';

const logger = createLogger('BasePrompt');
/**
 * Abstract base class for all prompt types
 */
abstract class BasePrompt {
  /**
   * Returns the system message that defines the AI's role and behavior
   * @returns SystemMessage from LangChain
   */
  abstract getSystemMessage(): SystemMessage;

  /**
   * Returns the user message for the specific prompt type
   * @param context - Optional context data needed for generating the user message
   * @returns HumanMessage from LangChain
   */
  abstract getUserMessage(context: AgentContext): Promise<HumanMessage>;

  /**
   * Builds the user message containing the browser state
   * @param context - The agent context
   * @returns HumanMessage from LangChain
   */
  async buildBrowserStateUserMessage(context: AgentContext): Promise<HumanMessage> {
    // 视觉模式状态
    const visionEnabled = context.options.useVision;
    logger.info('========== Vision Mode Status ==========');
    logger.info(`Vision mode setting: ${visionEnabled ? 'ENABLED' : 'DISABLED'}`);

    const browserState = await context.browserContext.getState(context.options.useVision);

    // 截图状态
    if (visionEnabled) {
      if (browserState.screenshot) {
        logger.info(`Screenshot captured: YES (${browserState.screenshot.length} chars base64)`);
        logger.info(`Screenshot will be sent to AI: YES`);
      } else {
        logger.warning('Screenshot captured: NO - Vision enabled but screenshot is empty');
      }
    } else {
      logger.info('Screenshot: Not captured (vision mode disabled)');
    }
    logger.info('========================================');

    const rawElementsText = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);

    // Debug: 输出页面内容解析结果
    const selectorMapSize = browserState.selectorMap.size;
    logger.info('--- Page Content Debug ---');
    logger.info(`URL: ${browserState.url}`);
    logger.info(`Title: ${browserState.title}`);
    logger.info(`Interactive elements count: ${selectorMapSize}`);
    logger.info(`Raw elements text length: ${rawElementsText.length} chars`);
    logger.info('--- Raw Elements Text ---');
    logger.info(rawElementsText || '(empty)');

    let formattedElementsText = '';
    if (rawElementsText !== '') {
      const scrollInfo = `[Scroll info of current page] window.scrollY: ${browserState.scrollY}, document.body.scrollHeight: ${browserState.scrollHeight}, window.visualViewport.height: ${browserState.visualViewportHeight}, visual viewport height as percentage of scrollable distance: ${Math.round((browserState.visualViewportHeight / (browserState.scrollHeight - browserState.visualViewportHeight)) * 100)}%\n`;
      logger.info(scrollInfo);
      const elementsText = wrapUntrustedContent(rawElementsText);
      formattedElementsText = `${scrollInfo}[Start of page]\n${elementsText}\n[End of page]\n`;
    } else {
      formattedElementsText = 'empty page';
    }

    // Debug: 输出格式化后的元素文本
    logger.info('--- Formatted Page Content ---');
    logger.info(`Formatted text length: ${formattedElementsText.length} chars`);
    logger.info(formattedElementsText);

    let stepInfoDescription = '';
    if (context.stepInfo) {
      stepInfoDescription = `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}`;
    }

    const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' '); // Format: YYYY-MM-DD HH:mm
    stepInfoDescription += `Current date and time: ${timeStr}`;

    let actionResultsDescription = '';
    if (context.actionResults.length > 0) {
      for (let i = 0; i < context.actionResults.length; i++) {
        const result = context.actionResults[i];
        if (result.extractedContent) {
          actionResultsDescription += `\nAction result ${i + 1}/${context.actionResults.length}: ${result.extractedContent}`;
        }
        if (result.error) {
          // only use last line of error
          const error = result.error.split('\n').pop();
          actionResultsDescription += `\nAction error ${i + 1}/${context.actionResults.length}: ...${error}`;
        }
      }
    }

    const currentTab = `{id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`;
    const otherTabs = browserState.tabs
      .filter(tab => tab.id !== browserState.tabId)
      .map(tab => `- {id: ${tab.id}, url: ${tab.url}, title: ${tab.title}}`);
    const stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current tab: ${currentTab}
Other available tabs:
  ${otherTabs.join('\n')}
Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}
${stepInfoDescription}
${actionResultsDescription}
`;

    // Debug: 输出最终传递给 AI 的完整用户消息
    logger.info('--- Final User Message to AI ---');
    logger.info(`Total text message length: ${stateDescription.length} chars`);

    // 视觉消息状态
    const hasScreenshot = !!browserState.screenshot && context.options.useVision;
    if (hasScreenshot) {
      logger.info(`*** VISION ACTIVE *** Screenshot included in message`);
      logger.info(`Screenshot size: ~${Math.round((browserState.screenshot?.length || 0) / 1024)} KB (base64)`);
    } else {
      logger.info(`*** VISION INACTIVE *** No screenshot in message`);
    }

    logger.info('--- Complete State Description ---');
    logger.info(stateDescription);

    if (browserState.screenshot && context.options.useVision) {
      logger.info('>>> Sending multimodal message (text + image) to AI');
      return new HumanMessage({
        content: [
          { type: 'text', text: stateDescription },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${browserState.screenshot}` },
          },
        ],
      });
    }

    logger.info('>>> Sending text-only message to AI');
    return new HumanMessage(stateDescription);
  }
}

export { BasePrompt };
