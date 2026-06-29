import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { wrapUntrustedContent } from '../messages/utils';
import { createLogger } from '@src/background/log';
import { elementHintsStore, getHostnameFromUrl } from '@extension/storage';

const logger = createLogger('BasePrompt');

/**
 * Analyze screenshot using vision model and generate description
 */
async function analyzeScreenshotWithVisionModel(
  screenshot: string,
  visionLLM: NonNullable<AgentContext['visionLLM']>,
): Promise<string> {
  try {
    const visionPrompt = `Analyze this screenshot of a webpage and provide a concise description focused on:
1. What type of page/content is visible
2. Key interactive elements (buttons, links, forms, inputs) and their positions
3. Any important visual elements like text, images, or notifications
4. Current state of the page (loading, error, success, etc.)

**IMPORTANT**: The screenshot contains numbered labels/markers on interactive elements. These numbers correspond to element indices that the automation agent can use to interact with elements. When describing interactive elements, you MUST include their number markers in your description.

Format your description like this for each interactive element:
- "Element [number]: [description]" (e.g., "Element [5]: Search input field", "Element [10]: Submit button")

This numbering is critical for the automation agent to identify and interact with the correct elements. Always reference elements by their numbered markers when available.

Keep the description brief and actionable for an automation agent. Focus on elements that can be interacted with.`;

    const response = await visionLLM.invoke([
      new HumanMessage({
        content: [
          { type: 'text', text: visionPrompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${screenshot}` },
          },
        ],
      }),
    ]);

    const analysisText = typeof response.content === 'string' ? response.content : '';
    logger.info('Vision model analysis completed:', analysisText.slice(0, 200));
    return analysisText;
  } catch (error) {
    logger.error('Vision model analysis failed:', error);
    return `[Vision analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}]`;
  }
}

/**
 * Analyze user-uploaded image using vision model and generate description
 */
async function analyzeUserImageWithVisionModel(
  imageBase64: string,
  imageName: string,
  visionLLM: NonNullable<AgentContext['visionLLM']>,
): Promise<string> {
  try {
    const visionPrompt = `Analyze this user-uploaded image and provide a detailed description focused on:
1. What type of content is in the image (e.g., webpage screenshot, document, photo, diagram, etc.)
2. Key visual elements and their positions (text, buttons, forms, images, etc.)
3. Any actionable information or instructions visible
4. If it's a screenshot, describe the page state and interactive elements
5. Any other relevant details that would help an automation agent understand the user's intent

**IMPORTANT**: If the image contains numbered labels/markers on interactive elements (like element indices), please include these number markers in your description. Format: "Element [number]: [description]"

Keep the description comprehensive and actionable. File name: ${imageName}`;

    const response = await visionLLM.invoke([
      new HumanMessage({
        content: [
          { type: 'text', text: visionPrompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
        ],
      }),
    ]);

    const analysisText = typeof response.content === 'string' ? response.content : '';
    logger.info(`Vision analysis for user image '${imageName}' completed:`, analysisText.slice(0, 200));
    return analysisText;
  } catch (error) {
    logger.error(`Vision analysis for user image '${imageName}' failed:`, error);
    return `[Vision analysis failed for ${imageName}: ${error instanceof Error ? error.message : 'Unknown error'}]`;
  }
}

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
    const hasVisionModel = !!context.visionLLM;
    logger.info('========== Vision Mode Status ==========');
    logger.info(`Vision mode setting: ${visionEnabled ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`Separate vision model: ${hasVisionModel ? 'YES' : 'NO (using Navigator model)'}`);

    const browserState = await context.browserContext.getState(context.options.useVision);

    // 截图状态
    if (visionEnabled) {
      if (browserState.screenshot) {
        logger.info(`Screenshot captured: YES (${browserState.screenshot.length} chars base64)`);
        if (hasVisionModel) {
          logger.info(`Screenshot will be analyzed by Vision model, not sent to Navigator`);
        } else {
          logger.info(`Screenshot will be sent directly to Navigator model`);
        }
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

    // ===== 注入元素事实库 =====
    // 当前 hostname 在 elementHintsStore 里有历史成功记录时，把它们拼到 state 末尾告诉 LLM。
    // LLM 在 prompt 第 13 节有指引：能匹到 purpose 时直接复用其 selector/xpath 来挑 index、并把
    // element_confidence 提到 0.9。失败完全静默，不影响主流程。
    try {
      const hostname = getHostnameFromUrl(browserState.url);
      if (hostname) {
        const hints = await elementHintsStore.getByHostname(hostname);
        if (hints && hints.length > 0) {
          // 限制最多展示 12 条避免污染上下文（按 useCount 倒序，最常用的优先）
          const top = [...hints].sort((a, b) => b.useCount - a.useCount).slice(0, 12);
          const lines = top.map(h => {
            const parts: string[] = [`- purpose: ${h.purpose}`];
            if (h.selector) parts.push(`selector: ${h.selector}`);
            if (h.xpath) parts.push(`xpath: ${h.xpath}`);
            if (h.textContent) parts.push(`text: ${h.textContent.slice(0, 40)}`);
            parts.push(`source: ${h.source}, used: ${h.useCount}x`);
            return parts.join(' | ');
          });
          formattedElementsText += `\n[Known elements on ${hostname} — previously confirmed working, prefer these to decide index]:\n${lines.join('\n')}\n`;
          logger.info(`Injected ${top.length} element hints for ${hostname}`);
        }
      }
    } catch (err) {
      logger.warning('inject element hints failed:', err);
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

    // Use vision model for screenshot analysis if configured
    let visionAnalysisText = '';
    const hasScreenshot = !!browserState.screenshot && context.options.useVision;
    if (hasScreenshot && context.visionLLM) {
      logger.info('>>> Using separate Vision model for screenshot analysis');
      visionAnalysisText = `\n[Visual Analysis from Vision Model]\n${await analyzeScreenshotWithVisionModel(browserState.screenshot!, context.visionLLM)}\n`;
    }

    const stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current tab: ${currentTab}
Other available tabs:
  ${otherTabs.join('\n')}
Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}
${visionAnalysisText}
${stepInfoDescription}
${actionResultsDescription}
`;

    // Debug: 输出最终传递给 AI 的完整用户消息
    logger.info('--- Final User Message to AI ---');
    logger.info(`Total text message length: ${stateDescription.length} chars`);

    // 视觉消息状态 - only include screenshot if no separate vision model
    if (hasScreenshot) {
      if (context.visionLLM) {
        logger.info(`*** VISION MODEL USED *** Screenshot analyzed by vision model, text-only sent to Navigator`);
      } else {
        logger.info(`*** VISION ACTIVE *** Screenshot included in message to Navigator`);
        logger.info(`Screenshot size: ~${Math.round((browserState.screenshot?.length || 0) / 1024)} KB (base64)`);
      }
    } else {
      logger.info(`*** VISION INACTIVE *** No screenshot in message`);
    }

    logger.info('--- Complete State Description ---');
    logger.info(stateDescription);

    // If vision model is configured and screenshot exists, send text-only to Navigator
    // Otherwise, include screenshot directly for Navigator
    if (browserState.screenshot && context.options.useVision && !context.visionLLM) {
      logger.info('>>> Sending multimodal message (text + image) to Navigator');
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

    logger.info('>>> Sending text-only message to Navigator');
    return new HumanMessage(stateDescription);
  }
}

export { BasePrompt, analyzeUserImageWithVisionModel };
