import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';
import { wrapUntrustedContent } from '../messages/utils';
import { createLogger } from '@src/background/log';
import { elementHintsStore, getHostnameFromUrl } from '@extension/storage';

const logger = createLogger('BasePrompt');
const MAX_OTHER_TABS = 3;
const MAX_KNOWN_ELEMENTS = 8;
const MAX_RAW_ELEMENTS_CHARS = 8000;

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n... [truncated]`;
}

function formatTab(tab: { id?: number; url?: string; title?: string }): string {
  return `{id: ${tab.id ?? 0}, url: ${truncateText(tab.url || '', 120)}, title: ${truncateText(tab.title || '', 80)}}`;
}

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
  abstract getUserMessage(context: AgentContext, useLiveState?: boolean): Promise<HumanMessage>;

  /**
   * Builds the user message containing the browser state
   * @param context - The agent context
   * @returns HumanMessage from LangChain
   */
  async buildBrowserStateUserMessage(context: AgentContext, useLiveState = true): Promise<HumanMessage> {
    const visionEnabled = context.options.useVision;
    const hasVisionModel = !!context.visionLLM;

    logger.info('========== Vision Mode Status ==========');
    logger.info(`Vision mode setting: ${visionEnabled ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`Separate vision model: ${hasVisionModel ? 'YES' : 'NO (using Navigator model)'}`);

    const browserState = await context.browserContext.getCachedState(context.options.useVision, false, useLiveState);
    const hasScreenshot = !!browserState.screenshot && context.options.useVision;

    if (visionEnabled) {
      if (browserState.screenshot) {
        logger.info(`Screenshot captured: YES (${browserState.screenshot.length} chars base64)`);
        logger.info(
          hasVisionModel
            ? 'Screenshot will be analyzed by Vision model, not sent to Navigator'
            : 'Screenshot will be sent directly to Navigator model',
        );
      } else {
        logger.warning('Screenshot captured: NO - Vision enabled but screenshot is empty');
      }
    } else {
      logger.info('Screenshot: Not captured (vision mode disabled)');
    }
    logger.info('========================================');

    const rawElementsText = truncateText(
      browserState.elementTree.clickableElementsToString(context.options.includeAttributes),
      MAX_RAW_ELEMENTS_CHARS,
    );

    logger.info('--- Page Content Debug ---');
    logger.info(`URL: ${browserState.url}`);
    logger.info(`Title: ${browserState.title}`);
    logger.info(`Interactive elements count: ${browserState.selectorMap.size}`);
    logger.info(`Raw elements text length: ${rawElementsText.length} chars`);
    logger.info('--- Raw Elements Text ---');
    logger.info(rawElementsText || '(empty)');

    const formattedElementsText =
      rawElementsText !== ''
        ? `[Scroll info of current page] window.scrollY: ${browserState.scrollY}, document.body.scrollHeight: ${browserState.scrollHeight}, window.visualViewport.height: ${browserState.visualViewportHeight}, visual viewport height as percentage of scrollable distance: ${Math.round((browserState.visualViewportHeight / (browserState.scrollHeight - browserState.visualViewportHeight)) * 100)}%\n[Start of page]\n${wrapUntrustedContent(rawElementsText)}\n[End of page]\n`
        : 'empty page';

    let knownElementsText = '';
    try {
      const hostname = getHostnameFromUrl(browserState.url);
      if (hostname) {
        // getByHostname 已剔除过期项并按优先级（来源权重 + 使用次数 × 新鲜度衰减）排好序，
        // 这里直接取前 N 条。之前在这里按 useCount 重排，结果是一条半年前点过 20 次的
        // 旧 selector 永久占着名额，而用户昨天刚教的那条（useCount=1）挤不进来。
        const hints = await elementHintsStore.getByHostname(hostname);
        if (hints.length > 0) {
          const top = hints.slice(0, MAX_KNOWN_ELEMENTS);
          const lines = top.map(h => {
            const parts: string[] = [`- purpose: ${truncateText(h.purpose, 40)}`];
            if (h.selector) parts.push(`selector: ${h.selector}`);
            if (h.stableSelector) parts.push(`stableSelector: ${h.stableSelector}`);
            if (h.xpath) parts.push(`xpath: ${h.xpath}`);
            if (h.textContent) parts.push(`text: ${h.textContent.slice(0, 40)}`);
            return parts.join(' | ');
          });
          knownElementsText = [
            `[Known elements on ${hostname}]`,
            'These are hard memories. If one matches the current task, use its selector/xpath first and do not guess a similar button:',
            ...lines,
            '',
          ].join('\n');
          logger.info(`Injected ${top.length} element hints for ${hostname}`);
        }
      }
    } catch (err) {
      logger.warning('inject element hints failed:', err);
    }

    logger.info('--- Formatted Page Content ---');
    logger.info(`Formatted text length: ${formattedElementsText.length} chars`);
    logger.info(formattedElementsText);

    const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const stepInfoDescription = context.stepInfo
      ? `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}\nCurrent date and time: ${timeStr}`
      : `Current date and time: ${timeStr}`;

    let actionResultsDescription = '';
    for (let i = 0; i < context.actionResults.length; i++) {
      const result = context.actionResults[i];
      if (result.extractedContent) {
        actionResultsDescription += `\nAction result ${i + 1}/${context.actionResults.length}: ${result.extractedContent}`;
      }
      if (result.error) {
        const error = result.error.split('\n').pop();
        actionResultsDescription += `\nAction error ${i + 1}/${context.actionResults.length}: ...${error}`;
      }
    }
    if (actionResultsDescription) {
      actionResultsDescription +=
        '\nIf the latest action error says the element had no visible effect or could not be resolved, do not repeat the same element. Pick a different target, re-read the page, or ask the user.';
    }

    const currentTab = `{id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`;
    const otherTabs = browserState.tabs
      .filter(tab => tab.id !== browserState.tabId)
      .slice(0, MAX_OTHER_TABS)
      .map(tab => `- ${formatTab(tab)}`)
      .join('\n');

    let visionAnalysisText = '';
    if (hasScreenshot && context.visionLLM) {
      logger.info('>>> Using separate Vision model for screenshot analysis');
      visionAnalysisText = `\n[Visual Analysis from Vision Model]\n${await analyzeScreenshotWithVisionModel(browserState.screenshot!, context.visionLLM)}\n`;
    }

    const stateDescription = [
      '[Task history memory ends]',
      '[Current state starts here]',
      'The following is one-time information - if you need to remember it write it to memory:',
      `Current tab: ${currentTab}`,
      otherTabs ? `Other available tabs:\n${otherTabs}` : '',
      'Interactive elements from top layer of the current page inside the viewport:',
      formattedElementsText,
      visionAnalysisText,
      stepInfoDescription,
      actionResultsDescription,
      // Placed last on purpose: the navigator system prompt tells the model the
      // [Known elements on <hostname>] block sits at the end of the state message.
      knownElementsText,
    ]
      .filter(Boolean)
      .join('\n');

    logger.info('--- Final User Message to AI ---');
    logger.info(`Total text message length: ${stateDescription.length} chars`);

    if (hasScreenshot) {
      if (context.visionLLM) {
        logger.info('*** VISION MODEL USED *** Screenshot analyzed by vision model, text-only sent to Navigator');
      } else {
        logger.info('*** VISION ACTIVE *** Screenshot included in message to Navigator');
        logger.info(`Screenshot size: ~${Math.round((browserState.screenshot?.length || 0) / 1024)} KB (base64)`);
      }
    } else {
      logger.info('*** VISION INACTIVE *** No screenshot in message');
    }

    logger.info('--- Complete State Description ---');
    logger.info(stateDescription);

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
