import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  analyticsSettingsStore,
  imageProviderStore,
} from '@extension/storage';
import { t } from '@extension/i18n';
import BrowserContext from './browser/context';
import type Page from './browser/page';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { injectBuildDomTreeScripts } from './browser/dom/service';
import { analytics } from './services/analytics';
import { MCPService } from './services/mcp';
import { SkillsService } from './services/skills';
import { WorkflowService } from './services/workflow';
import type { WorkflowResult, Workflow, WorkflowEvent } from '@extension/workflow';
import { recorderState, selectorGenerator, generateSkillFromRecording } from './recorder';
import { ImageGenerationService } from './services/imageGeneration/ImageGenerationService';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');
const OPTIONS_URL = chrome.runtime.getURL('options/index.html');
// Long-lived ports from Options pages (multiple instances allowed)
const optionsPorts = new Set<chrome.runtime.Port>();

// Initialize MCP and Skills services
const mcpService = new MCPService();
const skillsService = new SkillsService();
const workflowService = new WorkflowService();
const imageGenerationService = new ImageGenerationService();

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    await injectBuildDomTreeScripts(tabId);
  }
});

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  console.log('Debugger detached:', source, reason);
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      currentExecutor?.cancel();
      await browserContext.cleanup();
    }
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  browserContext.removeAttachedPage(tabId);
});

logger.info('background loaded');

// Initialize MCP and Skills services
Promise.all([mcpService.initialize(), skillsService.initialize(), workflowService.initialize()])
  .then(() => {
    logger.info('MCP, Skills and Workflow services initialized');
  })
  .catch(error => {
    logger.error('Failed to initialize MCP/Skills/Workflow services:', error);
  });

// Initialize analytics
analytics.init().catch(error => {
  logger.error('Failed to initialize analytics:', error);
});

// Listen for analytics settings changes
analyticsSettingsStore.subscribe(() => {
  analytics.updateSettings().catch(error => {
    logger.error('Failed to update analytics settings:', error);
  });
});

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle MCP related messages
  if (message.type === 'MCP_TEST_CONNECTION') {
    handleMCPTestConnection(message.config)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error instanceof Error ? error.message : 'Test failed' }));
    return true; // Keep the message channel open for async response
  }

  if (message.type === 'MCP_LIST_TOOLS') {
    handleMCPListTools(message.serverId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ tools: [], error: error instanceof Error ? error.message : 'Failed' }));
    return true;
  }

  if (message.type === 'SKILLS_LIST') {
    handleSkillsList(message.category)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ skills: [], error: error instanceof Error ? error.message : 'Failed' }));
    return true;
  }

  // Handle workflow execution from options page
  if (message.type === 'execute_workflow') {
    handleExecuteWorkflow(message)
      .then(result => sendResponse(result))
      .catch(error =>
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Execution failed' }),
      );
    return true; // Keep the message channel open for async response
  }

  // Handle image provider test connection from options page
  if (message.type === 'test_image_provider') {
    imageGenerationService
      .testProviderConnection(message.providerId)
      .then(result =>
        sendResponse({ type: 'test_image_provider_result', success: result.success, error: result.error }),
      )
      .catch(error =>
        sendResponse({
          type: 'test_image_provider_result',
          success: false,
          error: error instanceof Error ? error.message : 'Test failed',
        }),
      );
    return true; // Keep the message channel open for async response
  }

  return false;
});

/**
 * Build a prioritized list of selectors from workflow action parameters.
 * Order: primary selector → xpath → fallbacks → attribute-based selectors
 */
function buildSelectorList(params: Record<string, unknown>): string[] {
  const selectors: string[] = [];

  // 1. XPath first — most precise, records exact element position in DOM tree
  const xpath = params.xpath as string;
  if (xpath && xpath.trim()) {
    selectors.push(xpath.trim());
  }

  // 2. Primary CSS selector (may match multiple elements, used as fallback)
  const primary = params.selector as string;
  if (primary && primary.trim()) {
    selectors.push(primary.trim());
  }

  // 3. Fallback selectors
  const fallbacks = params.fallbacks as string[] | undefined;
  if (fallbacks && Array.isArray(fallbacks)) {
    for (const fb of fallbacks) {
      if (fb && fb.trim() && !selectors.includes(fb.trim())) {
        selectors.push(fb.trim());
      }
    }
  }

  // 4. Build attribute-based selectors from recorded attributes
  const attributes = params.attributes as Record<string, string> | undefined;
  const tagName = (params.attributes as Record<string, string> | undefined)?.tagName;
  if (attributes && tagName) {
    // Try common attribute combinations
    const attrSelectors: string[] = [];

    // id
    if (attributes.id) {
      attrSelectors.push(`#${attributes.id}`);
    }

    // data-testid
    if (attributes['data-testid']) {
      attrSelectors.push(`[data-testid="${attributes['data-testid']}"]`);
    }

    // name
    if (attributes.name) {
      attrSelectors.push(`${tagName}[name="${attributes.name}"]`);
    }

    // type + placeholder combination (for inputs)
    if (attributes.type && attributes.placeholder) {
      attrSelectors.push(`${tagName}[type="${attributes.type}"][placeholder="${attributes.placeholder}"]`);
    }

    // aria-label
    if (attributes.ariaLabel) {
      attrSelectors.push(`[aria-label="${attributes.ariaLabel}"]`);
    }

    for (const attrSel of attrSelectors) {
      if (!selectors.includes(attrSel)) {
        selectors.push(attrSel);
      }
    }
  }

  return selectors;
}

// Handler function for workflow execution
async function handleExecuteWorkflow(message: {
  workflowId: string;
  tabId?: number;
  taskId?: string;
  params?: Record<string, unknown>;
  showOverlay?: boolean; // 是否显示工作流进度遮罩
}): Promise<{ success: boolean; result?: WorkflowResult; error?: string }> {
  const workflowId = message.workflowId;
  const params = message.params || {};
  const showOverlay = message.showOverlay ?? false; // 默认不显示

  if (!workflowId) {
    return { success: false, error: 'Workflow ID is required' };
  }

  logger.info('execute_workflow request', workflowId, 'showOverlay:', showOverlay);

  // Declare variables outside try block for catch access
  let workflow: Workflow | undefined;
  let targetTabId: number | undefined;
  let targetPage: Page | null = null;

  try {
    // Get workflow from registry (always fetches latest from storage)
    workflow = await workflowService.getWorkflowInfo(workflowId);
    if (!workflow) {
      return { success: false, error: `Workflow "${workflowId}" not found` };
    }

    // If the workflow starts with a go_to_url action, open a new tab for that URL
    // up front so that targetPage is set and subsequent nodes can operate on it.
    const startNode = workflow.nodes.find((n: { type: string }) => n.type === 'start');
    const firstEdge = workflow.edges.find((e: { source: string }) => e.source === startNode?.id);
    const firstNodeId = firstEdge?.target;
    const firstNode = workflow.nodes.find((n: { id: string }) => n.id === firstNodeId);

    if (firstNode?.type === 'automation' && firstNode.data.action === 'go_to_url') {
      const targetUrl = (firstNode.data.parameters?.url as string) || (params.url as string);
      if (targetUrl) {
        logger.info('Workflow starts with go_to_url, opening new tab:', targetUrl);
        const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
        if (newTab.id) {
          targetTabId = newTab.id;
          browserContext.updateCurrentTabId(newTab.id);
          // Wait for page to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          targetPage = await browserContext.getCurrentPage();
          logger.info('Pre-opened tab for workflow:', newTab.id, targetUrl);
        }
      }
    }

    // If no target page from go_to_url, find existing valid tab
    if (!targetPage) {
      // Search for existing http/https tabs
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      logger.info('Searching for valid web page tab among', allTabs.length, 'tabs');

      for (const tab of allTabs) {
        if (tab.id && tab.url && tab.url.startsWith('http')) {
          browserContext.updateCurrentTabId(tab.id);
          const page = await browserContext.getCurrentPage();
          if (page && page.validWebPage) {
            targetPage = page;
            targetTabId = tab.id;
            logger.info('Found existing valid tab:', tab.id, tab.url);
            break;
          }
        }
      }
    }

    // Still no valid page? Create a blank tab
    if (!targetPage) {
      logger.info('No valid tab found, creating a new tab');
      targetPage = await browserContext.openTab('');
      if (targetPage?.tabId) {
        targetTabId = targetPage.tabId;
        // Wait for blank page
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Final check
    if (!targetPage || !targetPage.tabId) {
      return {
        success: false,
        error: '无法创建执行页面，请检查浏览器状态',
      };
    }

    targetTabId = targetPage.tabId;

    // Attach the page if not already attached
    if (!targetPage.attached && targetPage.validWebPage) {
      logger.info('Attaching to page...', targetTabId);
      try {
        const attached = await browserContext.attachPage(targetPage);
        if (!attached) {
          return { success: false, error: '无法连接到页面' };
        }
        await injectBuildDomTreeScripts(targetTabId);
        await new Promise(resolve => setTimeout(resolve, 500));
        logger.info('Page attached successfully');
      } catch (attachError) {
        logger.error('Failed to attach page:', attachError);
        return {
          success: false,
          error: attachError instanceof Error ? attachError.message : '连接页面失败',
        };
      }
    }

    logger.info('Page ready, starting workflow execution on tab:', targetTabId);

    // Wait for content script to be ready
    const waitForContentScript = async (tabId: number, maxRetries = 5): Promise<boolean> => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { type: 'ping_content_script' });
          if (response?.success) {
            logger.info('Content script is ready on tab:', tabId);
            return true;
          }
        } catch (e) {
          logger.info(`Content script not ready, retry ${i + 1}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      return false;
    };

    // Try to inject content script if not ready
    const ensureContentScript = async (tabId: number): Promise<boolean> => {
      // First try to ping
      const ready = await waitForContentScript(tabId, 3);
      if (ready) return true;

      // Try to inject content script manually
      try {
        logger.info('Attempting to inject content script manually on tab:', tabId);
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/index.iife.js'],
        });
        // Wait for script to initialize
        await new Promise(resolve => setTimeout(resolve, 300));
        return await waitForContentScript(tabId, 3);
      } catch (e) {
        logger.error('Failed to inject content script:', e);
        return false;
      }
    };

    // Ensure content script is loaded before sending progress messages
    const contentScriptReady = await ensureContentScript(targetTabId);
    if (!contentScriptReady) {
      logger.warning('Content script not ready on target tab, workflow will execute without overlay');
    }

    // Send start progress message to content script (only if overlay is enabled)
    if (contentScriptReady && showOverlay) {
      try {
        await chrome.tabs.sendMessage(targetTabId, {
          type: 'workflow_start',
          workflowName: workflow.name,
          totalNodes: workflow.nodes.filter((n: { type: string }) => n.type !== 'start' && n.type !== 'end').length,
        });
      } catch (e) {
        logger.warning('Failed to send workflow_start message:', e);
      }
    }

    // Track executed nodes for progress
    let executedNodesCount = 0;
    const totalExecutableNodes = workflow.nodes.filter(
      (n: { type: string }) => n.type !== 'start' && n.type !== 'end',
    ).length;

    // Create action executor that integrates with browser automation
    const actionExecutor = async (action: string, params: Record<string, unknown>) => {
      logger.info('Workflow action:', action, params);

      // Send progress update to content script (only if overlay is enabled and ready)
      if (contentScriptReady && showOverlay) {
        try {
          await chrome.tabs.sendMessage(targetTabId!, {
            type: 'workflow_progress',
            nodeId: `node-${executedNodesCount}`,
            nodeName: action,
            nodeType: 'automation',
            executedNodes: executedNodesCount + 1,
            totalNodes: totalExecutableNodes,
          });
        } catch (e) {
          logger.warning('Failed to send progress message:', e);
        }
      }

      executedNodesCount++;

      try {
        // Get the current page (should be attached now)
        const currentPage = await browserContext.getCurrentPage();
        if (!currentPage || !currentPage.attached) {
          return { success: false, error: 'Page is not attached' };
        }

        // Execute action based on type
        switch (action) {
          case 'go_to_url': {
            const url = params.url as string;
            if (!url) return { success: false, error: 'URL is required' };
            // If the active tab is already on this URL (e.g. pre-opened by the workflow entry),
            // skip — avoids opening a duplicate tab when go_to_url is the first node.
            try {
              const curTab = await chrome.tabs.get(targetTabId!);
              if (curTab?.url === url) {
                return { success: true, extractedContent: `Already on: ${url}` };
              }
            } catch {
              /* tab might have been closed; fall through to open a new one */
            }
            // Otherwise open the URL in a new tab so the workflow doesn't disrupt
            // whatever the user is currently viewing.
            const newTab = await chrome.tabs.create({ url, active: true });
            if (!newTab.id) {
              return { success: false, error: 'Failed to create tab for go_to_url' };
            }
            // Update the active target tab so subsequent automation nodes operate on this page
            targetTabId = newTab.id;
            browserContext.updateCurrentTabId(newTab.id);
            return { success: true, extractedContent: `Opened new tab for: ${url}` };
          }

          case 'click_element': {
            const clickSelectors = buildSelectorList(params);
            if (clickSelectors.length === 0) return { success: false, error: 'No selector provided' };
            for (const sel of clickSelectors) {
              const result = await currentPage.clickBySelector(sel);
              if (result) return { success: true };
            }
            return { success: false, error: `Element not found with selectors: ${clickSelectors.join(', ')}` };
          }

          case 'input_text': {
            const inputSelectors = buildSelectorList(params);
            const text = params.text as string;
            if (inputSelectors.length === 0 || !text) return { success: false, error: 'Missing selector or text' };
            for (const sel of inputSelectors) {
              const result = await currentPage.inputBySelector(sel, text);
              if (result) return { success: true };
            }
            return { success: false, error: `Element not found with selectors: ${inputSelectors.join(', ')}` };
          }

          case 'scroll_to_percent': {
            const yPercent = (params.yPercent as number) || 0;
            await currentPage.scrollToPercentDirect(yPercent);
            return { success: true };
          }

          case 'scroll_to_top':
            await currentPage.scrollToPercentDirect(0);
            return { success: true };

          case 'scroll_to_bottom':
            await currentPage.scrollToPercentDirect(100);
            return { success: true };

          case 'wait': {
            const duration = (params.duration as number) || 1000;
            await new Promise(resolve => setTimeout(resolve, duration));
            return { success: true };
          }

          case 'send_keys': {
            const keys = params.keys as string;
            if (!keys) return { success: false, error: 'Keys are required' };
            await currentPage.sendKeys(keys);
            return { success: true };
          }

          case 'go_back':
            await currentPage.goBack();
            return { success: true };

          case 'go_forward':
            await currentPage.goForward();
            return { success: true };

          case 'open_tab': {
            const url = (params.url as string) || '';
            const newPage = await browserContext.openTab(url);
            if (newPage?.tabId) {
              await injectBuildDomTreeScripts(newPage.tabId);
            }
            return { success: true };
          }

          case 'close_tab': {
            const currentTabId = currentPage.tabId;
            await browserContext.closeTab(currentTabId);
            return { success: true };
          }

          case 'switch_tab': {
            const tabs = await chrome.tabs.query({ currentWindow: true });
            const targetIndex = params.tabIndex as number;
            if (tabs[targetIndex]?.id) {
              await browserContext.switchTab(tabs[targetIndex].id!);
              return { success: true };
            }
            return { success: false, error: 'Invalid tab index' };
          }

          case 'select_dropdown_option': {
            const dropdownSelector = params.selector as string;
            const optionText = params.text as string;
            if (!dropdownSelector || !optionText) return { success: false, error: 'Missing selector or option text' };
            const result = await currentPage.selectOptionBySelector(dropdownSelector, optionText);
            return { success: result, error: result ? undefined : 'Select failed' };
          }

          case 'generate_image': {
            // Use the image generation service
            const prompt = params.prompt as string;
            if (!prompt) return { success: false, error: 'Prompt is required for image generation' };

            const imageResult = await imageGenerationService.generateImage({
              prompt,
              model: params.model as string,
              size: params.size as string,
              quality: params.quality as string,
              n: (params.n as number) || 1,
              outputFormat: params.outputFormat as string,
              responseFormat: (params.responseFormat as string) || 'b64_json',
            });

            if (imageResult.success && imageResult.images?.[0]?.b64_json) {
              // Store the generated image in workflow variable if outputVariable is specified
              return {
                success: true,
                extractedContent: imageResult.images[0].b64_json,
              };
            }
            return {
              success: imageResult.success,
              error: imageResult.error || 'Image generation failed',
              extractedContent: imageResult.images?.[0]?.url,
            };
          }

          default:
            return { success: false, error: `Unknown action: ${action}` };
        }
      } catch (actionError) {
        logger.error('Workflow action failed:', action, actionError);
        return {
          success: false,
          error: actionError instanceof Error ? actionError.message : 'Action failed',
        };
      }
    };

    // Create AI invoker that uses the Navigator agent
    const aiInvoker = async (prompt: string, context?: Record<string, unknown>) => {
      logger.info('Workflow AI invoke:', prompt, context);
      try {
        // Create a full Executor session - same flow as user chat conversation
        // This gives AI module access to page context, Navigator agent, etc.
        const aiTaskId = `wf-ai-${Date.now()}`;

        // Inject workflow context variables into the task prompt
        const contextStr = context ? `\n上下文变量: ${JSON.stringify(context)}` : '';
        const taskDescription = `${prompt}${contextStr}`;

        const executor = await setupExecutor(aiTaskId, taskDescription, browserContext);

        // Collect result from executor events
        let finalResult: { success: boolean; response?: string; error?: string } = {
          success: false,
          error: 'AI execution timed out',
        };

        executor.subscribeExecutionEvents(async event => {
          // Forward AI executor events to side panel so user can see execution process
          if (currentPort) {
            try {
              currentPort.postMessage(event);
            } catch (e) {
              logger.warning('Failed to forward AI executor event to side panel:', e);
            }
          }

          if (event.state === ExecutionState.TASK_OK) {
            finalResult = {
              success: true,
              response: event.data?.details || event.data?.taskId || 'Task completed',
            };
          } else if (event.state === ExecutionState.TASK_FAIL) {
            finalResult = {
              success: false,
              error: event.data?.details || 'AI task failed',
            };
          }
        });

        // Run the executor
        await executor.execute();

        // Clean up the AI executor after completion (don't interfere with main currentExecutor)
        await executor.cleanup();

        logger.info('Workflow AI executor result:', finalResult.success, finalResult.response?.slice(0, 100));
        return finalResult;
      } catch (aiError) {
        logger.error('Workflow AI invoke failed:', aiError);
        return {
          success: false,
          error: aiError instanceof Error ? aiError.message : 'AI invoke failed',
        };
      }
    };

    // Create workflow event emitter to forward events to side panel and options pages
    const workflowEventEmitter = async (event: WorkflowEvent) => {
      const message = { type: 'workflow_event', event };
      if (currentPort) {
        try {
          currentPort.postMessage(message);
        } catch (e) {
          logger.warning('Failed to forward workflow event to side panel:', e);
        }
      }
      // Broadcast to all connected Options pages
      for (const p of optionsPorts) {
        try {
          p.postMessage(message);
        } catch {
          // port may be closed; cleanup on disconnect listener will remove it
        }
      }
    };

    // Execute workflow
    /**
     * Lightweight AI invoker for purely textual tasks (e.g. condition evaluation).
     * Calls the LLM directly without the Planner/Navigator agent pipeline:
     * no page DOM context, no skill catalog, no agent identity prompts.
     */
    const aiLightInvoker = async (prompt: string) => {
      try {
        const providers = await llmProviderStore.getAllProviders();
        if (Object.keys(providers).length === 0) {
          return { success: false, error: 'No LLM provider configured' };
        }
        const agentModels = await agentModelStore.getAllAgentModels();
        const navigatorModel = agentModels[AgentNameEnum.Navigator];
        if (!navigatorModel) {
          return { success: false, error: 'No Navigator model configured' };
        }
        const providerConfig = providers[navigatorModel.provider];
        const llm = createChatModel(providerConfig, navigatorModel);
        const response = await llm.invoke(prompt);
        const content = response.content;
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        return { success: true, response: text };
      } catch (error) {
        logger.error('aiLightInvoker failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'AI light invoke failed' };
      }
    };

    const result = await workflowService.executeWorkflow(
      workflowId,
      targetPage.tabId,
      message.params || {},
      actionExecutor,
      aiInvoker,
      workflowEventEmitter,
      aiLightInvoker,
    );

    logger.info('execute_workflow result', targetPage.tabId, result);

    // Send completion message to content script (only if overlay is enabled and ready)
    if (contentScriptReady && showOverlay) {
      try {
        if (result.success) {
          await chrome.tabs.sendMessage(targetTabId!, {
            type: 'workflow_complete',
            workflowName: workflow.name,
            totalNodes: totalExecutableNodes,
          });
        } else {
          await chrome.tabs.sendMessage(targetTabId!, {
            type: 'workflow_error',
            workflowName: workflow.name,
            error: result.error || 'Workflow execution failed',
          });
        }
      } catch (e) {
        logger.warning('Failed to send workflow completion message:', e);
      }
    }

    // Cleanup: detach page to release debugger connection
    try {
      if (targetPage?.tabId) {
        await browserContext.detachPage(targetPage.tabId);
        logger.info('Workflow execution complete, detached page:', targetPage.tabId);
      }
    } catch (e) {
      logger.warning('Failed to detach page after workflow:', e);
    }

    return { success: result.success, result };
  } catch (error) {
    logger.error('Execute workflow failed:', error);

    // Send error message to content script if we have a valid tab and overlay is enabled
    if (targetPage?.tabId && showOverlay) {
      try {
        await chrome.tabs.sendMessage(targetPage.tabId, {
          type: 'workflow_error',
          workflowName: workflow?.name || 'Unknown',
          error: error instanceof Error ? error.message : 'Failed to execute workflow',
        });
      } catch {
        // Ignore messaging errors
      }
    }

    // Cleanup: detach page to release debugger connection
    try {
      if (targetPage?.tabId) {
        await browserContext.detachPage(targetPage.tabId);
        logger.info('Workflow execution failed, detached page:', targetPage.tabId);
      }
    } catch (e) {
      logger.warning('Failed to detach page after workflow error:', e);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute workflow',
    };
  }
}

// Handler functions for MCP/Skills messages
async function handleMCPTestConnection(config: unknown): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await mcpService.testConnection(config as Parameters<typeof mcpService.testConnection>[0]);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
    };
  }
}

async function handleMCPListTools(serverId?: string): Promise<{ tools: unknown[] }> {
  try {
    const tools = await mcpService.listTools(serverId);
    return { tools };
  } catch {
    return { tools: [] };
  }
}

async function handleSkillsList(category?: string): Promise<{ skills: unknown[] }> {
  try {
    const skills = skillsService.listSkills(category);
    return { skills };
  } catch {
    return { skills: [] };
  }
}

// Setup connection listener for long-lived connections (e.g., side panel, options pages)
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'options-connection') {
    const senderUrl = port.sender?.url;
    const senderId = port.sender?.id;
    if (!senderUrl || senderId !== chrome.runtime.id || !senderUrl.startsWith(OPTIONS_URL)) {
      logger.warning('Blocked unauthorized options-connection', senderId, senderUrl);
      port.disconnect();
      return;
    }
    optionsPorts.add(port);
    port.onDisconnect.addListener(() => {
      optionsPorts.delete(port);
    });
    return;
  }
  if (port.name === 'side-panel-connection') {
    const senderUrl = port.sender?.url;
    const senderId = port.sender?.id;

    if (!senderUrl || senderId !== chrome.runtime.id || senderUrl !== SIDE_PANEL_URL) {
      logger.warning('Blocked unauthorized side-panel-connection', senderId, senderUrl);
      port.disconnect();
      return;
    }

    currentPort = port;

    port.onMessage.addListener(async message => {
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_newTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info(
              'new_task',
              message.tabId,
              message.task,
              message.images?.length ? `with ${message.images.length} images` : '',
            );
            // Clean up any prior executor to free its browser context before starting a new task
            if (currentExecutor) {
              try {
                await currentExecutor.cleanup();
              } catch (e) {
                logger.warning('Failed to cleanup previous executor before new task:', e);
              }
              currentExecutor = null;
            }
            currentExecutor = await setupExecutor(message.taskId, message.task, browserContext, message.images);
            subscribeToExecutorEvents(currentExecutor);

            const result = await currentExecutor.execute();
            logger.info('new_task execution result', message.tabId, result);
            break;
          }

          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('follow_up_task', message.tabId, message.task);

            // If executor exists, add follow-up task
            if (currentExecutor) {
              currentExecutor.addFollowUpTask(message.task);
              // Re-subscribe to events in case the previous subscription was cleaned up
              subscribeToExecutorEvents(currentExecutor);
              const result = await currentExecutor.execute();
              logger.info('follow_up_task execution result', message.tabId, result);
            } else {
              // executor was cleaned up, can not add follow-up task
              logger.info('follow_up_task: executor was cleaned up, can not add follow-up task');
              return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_cleaned') });
            }
            break;
          }

          case 'cancel_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.cancel();
            break;
          }

          case 'resume_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_cmd_resumeTask_noTask') });
            await currentExecutor.resume();
            return port.postMessage({ type: 'success' });
          }

          case 'pause_task': {
            if (!currentExecutor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await currentExecutor.pause();
            return port.postMessage({ type: 'success' });
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return port.postMessage({ type: 'success', screenshot });
          }

          case 'state': {
            try {
              const browserState = await browserContext.getState(true);
              const elementsText = browserState.elementTree.clickableElementsToString(
                DEFAULT_AGENT_OPTIONS.includeAttributes,
              );

              logger.info('state', browserState);
              logger.info('interactive elements', elementsText);
              return port.postMessage({ type: 'success', msg: t('bg_cmd_state_printed') });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return port.postMessage({ type: 'error', error: t('bg_cmd_state_failed') });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return port.postMessage({ type: 'success', msg: t('bg_cmd_nohighlight_ok') });
          }

          case 'replay': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.taskId) return port.postMessage({ type: 'error', error: t('bg_errors_noTaskId') });
            if (!message.historySessionId)
              return port.postMessage({ type: 'error', error: t('bg_cmd_replay_noHistory') });
            logger.info('replay', message.tabId, message.taskId, message.historySessionId);

            try {
              // Switch to the specified tab
              await browserContext.switchTab(message.tabId);
              // Setup executor with the new taskId and a dummy task description
              currentExecutor = await setupExecutor(message.taskId, message.task, browserContext);
              subscribeToExecutorEvents(currentExecutor);

              // Run replayHistory with the history session ID
              const result = await currentExecutor.replayHistory(message.historySessionId);
              logger.debug('replay execution result', message.tabId, result);
            } catch (error) {
              logger.error('Replay failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : t('bg_cmd_replay_failed'),
              });
            }
            break;
          }

          // Recording handlers
          case 'start_recording': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('start_recording', message.tabId);

            try {
              // Defensive cleanup: stop any previous session first so a fresh recording starts cleanly
              const previousSession = recorderState.getSession();
              if (previousSession) {
                logger.info('Stopping previous session before new recording:', previousSession.id);
                recorderState.stopSession();
                // Tell the previous tab's content script to stop listening
                try {
                  await chrome.tabs.sendMessage(previousSession.tabId, { type: 'stop_recording' }, { frameId: 0 });
                } catch {
                  // Tab may be closed or content script not loaded
                }
              }

              // Start recording session
              const session = recorderState.startSession(message.tabId);

              // Ensure content script is injected before sending message - ONLY in main frame
              try {
                // Try to send message first, if fails then inject script
                await chrome.tabs.sendMessage(
                  message.tabId,
                  {
                    type: 'check_recording_status',
                  },
                  { frameId: 0 },
                ); // Only check main frame
              } catch {
                // Content script not ready, inject it - ONLY to main frame
                logger.info('Injecting content script for recording (main frame only)');
                await chrome.scripting.executeScript({
                  target: { tabId: message.tabId, frameIds: [0] }, // Only inject to main frame
                  files: ['content/index.iife.js'],
                });
                // Wait a bit for script to initialize
                await new Promise(resolve => setTimeout(resolve, 100));
              }

              // Send start recording message - ONLY to main frame
              await chrome.tabs.sendMessage(
                message.tabId,
                {
                  type: 'start_recording',
                  sessionId: session.id,
                },
                { frameId: 0 },
              ); // Only send to main frame

              return port.postMessage({ type: 'recording_started', session });
            } catch (error) {
              logger.error('Failed to start recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to start recording',
              });
            }
          }

          case 'stop_recording': {
            logger.info('stop_recording');

            try {
              const session = recorderState.stopSession();

              if (session) {
                // Notify ALL tracked tabs' content scripts to stop - ONLY main frame
                const tabIds = session.tabIds && session.tabIds.length > 0 ? session.tabIds : [session.tabId];
                await Promise.all(
                  tabIds.map(async tid => {
                    try {
                      await chrome.tabs.sendMessage(tid, { type: 'stop_recording' }, { frameId: 0 });
                    } catch {
                      // Tab might be closed
                    }
                  }),
                );
              }

              return port.postMessage({ type: 'recording_stopped', session });
            } catch (error) {
              logger.error('Failed to stop recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to stop recording',
              });
            }
          }

          case 'recording_add_active_tab': {
            // Manually add the currently active tab to the recording set.
            // Used by RecordingPill when user wants to record on an unrelated tab.
            const session = recorderState.getActiveSession();
            if (!session) {
              return port.postMessage({ type: 'error', error: '当前没有正在进行的录制' });
            }
            try {
              const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (!activeTab?.id || !activeTab.url?.startsWith('http')) {
                return port.postMessage({ type: 'error', error: '无法在该标签页上录制' });
              }
              const tabId = activeTab.id;
              if (recorderState.isTabTracked(tabId)) {
                return port.postMessage({ type: 'recording_state_update', session: recorderState.getSession() });
              }
              recorderState.addTab(tabId, { url: activeTab.url, title: activeTab.title || '' });
              // Mark as active immediately (no tab_switch — addTab already emitted tab_open)
              recorderState.markActiveTab(tabId, { url: activeTab.url, title: activeTab.title || '' });
              // Inject content script if needed and start recording in this tab
              try {
                await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
              } catch {
                await chrome.scripting.executeScript({
                  target: { tabId, frameIds: [0] },
                  files: ['content/index.iife.js'],
                });
              }
              try {
                await chrome.tabs.sendMessage(
                  tabId,
                  { type: 'start_recording', sessionId: session.id },
                  { frameId: 0 },
                );
              } catch (e) {
                console.warn('[Recording] Failed to start recording on manually added tab:', e);
              }
              return port.postMessage({ type: 'recording_state_update', session: recorderState.getSession() });
            } catch (error) {
              logger.error('Failed to add active tab to recording:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to add active tab',
              });
            }
          }

          case 'get_recording_state': {
            const session = recorderState.getSession();
            return port.postMessage({ type: 'recording_state', session });
          }

          case 'save_recording_as_skill': {
            logger.info('save_recording_as_skill', message.skillName);

            try {
              const session = recorderState.getSession();
              if (!session || session.actions.length === 0) {
                return port.postMessage({
                  type: 'error',
                  error: 'No recording session or actions to save',
                });
              }

              // Generate skill from recording
              const generatedSkill = generateSkillFromRecording(session, message.skillName, message.skillDescription);

              // Import skill to storage - use addSkill instead of importSkillPackages
              const { userSkillsStore } = await import('@extension/storage');

              const skillConfig = {
                id: generatedSkill.id,
                name: generatedSkill.name,
                description: generatedSkill.description,
                version: '1.0.0',
                category: generatedSkill.category,
                author: 'Recorder',
                tags: [],
                parameters: generatedSkill.parameters.map(p => ({
                  name: p.name,
                  type: p.type,
                  description: p.description,
                  required: p.required,
                  default: p.default,
                })),
                steps: generatedSkill.steps.map(s => ({
                  id: s.id,
                  action: s.action,
                  description: s.description,
                  parameters: s.parameters,
                  onError: s.onError,
                })),
                executionMode: generatedSkill.executionMode,
                createdAt: Date.now(),
              };

              await userSkillsStore.addSkill(skillConfig);

              // Clear session after saving
              recorderState.clearSession();

              logger.info('Skill saved successfully:', generatedSkill.id);

              return port.postMessage({
                type: 'recording_saved',
                skillId: generatedSkill.id,
                skillName: generatedSkill.name,
              });
            } catch (error) {
              logger.error('Failed to save recording as skill:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to save recording',
              });
            }
          }

          case 'execute_skill': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.skillId) return port.postMessage({ type: 'error', error: 'Skill ID is required' });

            logger.info('execute_skill', message.tabId, message.skillId);

            try {
              // Get skill from storage
              const { userSkillsStore } = await import('@extension/storage');
              const skill = await userSkillsStore.getSkill(message.skillId);

              if (!skill) {
                return port.postMessage({ type: 'error', error: `Skill "${message.skillId}" not found` });
              }

              // Convert skill steps to task format
              const taskDescription = `执行 Skill: ${skill.name}\n\n步骤:\n${skill.steps.map((s: { description?: string; action: string }, i: number) => `${i + 1}. ${s.description || s.action}`).join('\n')}`;

              // Setup executor
              currentExecutor = await setupExecutor(message.taskId, taskDescription, browserContext);
              subscribeToExecutorEvents(currentExecutor);

              // Execute with skill parameters
              const result = await currentExecutor.execute();
              logger.info('execute_skill result', message.tabId, result);
            } catch (error) {
              logger.error('Execute skill failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to execute skill',
              });
            }
            break;
          }

          case 'ai_polish_skill': {
            logger.info('ai_polish_skill', message.skill?.name);

            try {
              const { skill, originalActions } = message;
              if (!skill) {
                return port.postMessage({ type: 'error', error: 'No skill data provided' });
              }

              // Get LLM for polish
              const providers = await llmProviderStore.getAllProviders();
              if (Object.keys(providers).length === 0) {
                return port.postMessage({ type: 'error', error: t('bg_setup_noApiKeys') });
              }

              const agentModels = await agentModelStore.getAllAgentModels();
              const navigatorModel = agentModels[AgentNameEnum.Navigator];
              if (!navigatorModel) {
                return port.postMessage({ type: 'error', error: t('bg_setup_noNavigatorModel') });
              }

              const providerConfig = providers[navigatorModel.provider];
              const llm = createChatModel(providerConfig, navigatorModel);

              // Build prompt for AI polish
              const stepsDescription = skill.steps
                .map(
                  (
                    s: { id: string; action: string; description?: string; parameters: Record<string, unknown> },
                    i: number,
                  ) =>
                    `${i + 1}. ${s.action}: ${s.description || 'No description'}\n   参数: ${JSON.stringify(s.parameters)}`,
                )
                .join('\n');

              const originalActionsDesc =
                originalActions
                  ?.map(
                    (
                      a: {
                        type: string;
                        value?: string;
                        element?: { textContent?: string };
                        navigateInfo?: { url: string; title: string };
                      },
                      i: number,
                    ) => `${i + 1}. ${a.type}: ${a.value || a.element?.textContent || a.navigateInfo?.url || 'N/A'}`,
                  )
                  .join('\n') || '无原始操作记录';

              const polishPrompt = `你是一个自动化任务优化专家。请根据以下录制的操作步骤，优化并生成更清晰、更可靠的 Skill 定义。

## 原始操作记录
${originalActionsDesc}

## 当前 Skill 步骤
${stepsDescription}

## 优化要求
1. 分析用户的真实操作意图，为每个步骤生成更准确的描述
2. 检查步骤是否有冗余或错误，可以合并或删除不必要的步骤
3. 为 Skill 生成一个简洁明了的名称和描述
4. 【严格禁止】不得更改任何步骤的 action 类型（如 click_element、input_text、go_to_url 等）
5. 【严格禁止】不得更改 parameters 中的 selector、xpath、fallbacks、url 等定位/导航参数
6. 只允许修改 description 字段和 parameters.intent 字段
7. 不允许发明新的 action 类型（如 ai_invoke），必须保留原始录制的精确操作

请以 JSON 格式返回优化后的 Skill，格式如下：
{
  "name": "优化后的名称",
  "description": "优化后的描述",
  "steps": [
    {
      "id": "原始id",
      "action": "原始action（不可更改）",
      "description": "优化后的描述",
      "parameters": {原始参数不变，仅可修改 intent 字段},
      "onError": "stop"
    }
  ]
}

只返回 JSON，不要添加其他说明文字。`;

              // Call LLM
              const response = await llm.invoke(polishPrompt);
              const responseText = response.content as string;

              // Parse JSON response
              let polishedSkill: typeof skill;
              try {
                // Try to extract JSON from response (might be wrapped in markdown)
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
                polishedSkill = JSON.parse(jsonStr);
              } catch (parseError) {
                logger.error('Failed to parse AI response:', parseError);
                // Return original skill if parsing fails
                polishedSkill = skill;
              }

              // Safety guard: even if the LLM ignored the prompt and changed action types
              // or stripped selectors/xpath, we restore them from the original skill so
              // recorded element targeting is never lost.
              if (polishedSkill?.steps && Array.isArray(polishedSkill.steps)) {
                const originalById = new Map(
                  (skill.steps as Array<{ id: string; action: string; parameters: Record<string, unknown> }>).map(s => [
                    s.id,
                    s,
                  ]),
                );
                polishedSkill.steps = polishedSkill.steps.map(
                  (polishedStep: {
                    id: string;
                    action: string;
                    parameters: Record<string, unknown>;
                    description?: string;
                  }) => {
                    const original = originalById.get(polishedStep.id);
                    if (!original) return polishedStep;
                    return {
                      ...polishedStep,
                      // Restore action type — must never be changed
                      action: original.action,
                      // Merge parameters: keep all original params, only allow LLM to override `intent`
                      parameters: {
                        ...original.parameters,
                        ...(polishedStep.parameters?.intent !== undefined
                          ? { intent: polishedStep.parameters.intent }
                          : {}),
                      },
                    };
                  },
                );
              }

              logger.info('AI polish result:', polishedSkill.name);
              return port.postMessage({ type: 'ai_polish_result', polishedSkill });
            } catch (error) {
              logger.error('AI polish failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'AI polish failed',
              });
            }
          }

          case 'execute_workflow': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.workflowId) return port.postMessage({ type: 'error', error: 'Workflow ID is required' });

            logger.info('execute_workflow via port', message.tabId, message.workflowId);

            try {
              const workflowResult = await handleExecuteWorkflow({
                workflowId: message.workflowId,
                tabId: message.tabId,
                taskId: message.taskId,
                params: message.params || {},
              });

              if (workflowResult.success) {
                port.postMessage({ type: 'success', result: workflowResult });
              } else {
                port.postMessage({ type: 'error', error: workflowResult.error || 'Workflow execution failed' });
              }
            } catch (error) {
              logger.error('Execute workflow via port failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to execute workflow',
              });
            }
            break;
          }

          case 'generate_image': {
            logger.info('generate_image request', message.prompt?.slice(0, 50));

            try {
              const result = await imageGenerationService.generateImage({
                prompt: message.prompt,
                model: message.model,
                size: message.size,
                quality: message.quality,
                n: message.n || 1,
                outputFormat: message.outputFormat,
                responseFormat: message.responseFormat || 'b64_json',
              });

              // Always send image_generation_result type for both success and failure
              port.postMessage({ type: 'image_generation_result', result });
            } catch (error) {
              logger.error('Image generation failed:', error);
              // Send as image_generation_result with success: false
              port.postMessage({
                type: 'image_generation_result',
                result: {
                  success: false,
                  error: error instanceof Error ? error.message : 'Failed to generate image',
                },
              });
            }
            break;
          }

          case 'test_image_provider': {
            logger.info('test_image_provider', message.providerId);

            try {
              const result = await imageGenerationService.testProviderConnection(message.providerId);
              port.postMessage({ type: 'test_image_provider_result', success: result.success, error: result.error });
            } catch (error) {
              logger.error('Test image provider failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to test provider',
              });
            }
            break;
          }

          case 'get_image_providers': {
            try {
              const providers = await imageProviderStore.getAllProviders();
              const activeProvider = await imageProviderStore.getActiveProvider();
              port.postMessage({ type: 'image_providers_list', providers, activeProvider });
            } catch (error) {
              logger.error('Get image providers failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to get providers',
              });
            }
            break;
          }

          case 'set_image_provider': {
            logger.info('set_image_provider', message.providerId, message.config);

            try {
              await imageProviderStore.setProvider(message.providerId, message.config);
              port.postMessage({ type: 'success', message: 'Provider saved successfully' });
            } catch (error) {
              logger.error('Set image provider failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to set provider',
              });
            }
            break;
          }

          case 'remove_image_provider': {
            logger.info('remove_image_provider', message.providerId);

            try {
              await imageProviderStore.removeProvider(message.providerId);
              port.postMessage({ type: 'success', message: 'Provider removed successfully' });
            } catch (error) {
              logger.error('Remove image provider failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to remove provider',
              });
            }
            break;
          }

          case 'set_active_image_provider': {
            logger.info('set_active_image_provider', message.providerId);

            try {
              await imageProviderStore.setActiveProvider(message.providerId);
              port.postMessage({ type: 'success', message: 'Active provider set successfully' });
            } catch (error) {
              logger.error('Set active image provider failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to set active provider',
              });
            }
            break;
          }

          default:
            return port.postMessage({ type: 'error', error: t('errors_cmd_unknown', [message.type]) });
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : t('errors_unknown'),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      console.log('Side panel disconnected');
      currentPort = null;
      currentExecutor?.cancel();
    });
  }
});

// Handle messages from content scripts (for recording)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle recorded action from content script
  if (message.type === 'recorded_action') {
    const session = recorderState.getActiveSession();
    if (session) {
      // Verify this action comes from the main frame (frameId === 0 or undefined for older chrome)
      // iframe 的 sender.frameId 会 > 0
      if (sender.frameId !== undefined && sender.frameId !== 0) {
        console.log('[Recording] Ignoring action from iframe (frameId:', sender.frameId, ')');
        sendResponse({ success: false, reason: 'iframe_ignored' });
        return false;
      }

      // Verify this action comes from a tab we're tracking (cross-tab recording)
      const senderTabId = sender.tab?.id;

      if (senderTabId !== undefined && !recorderState.isTabTracked(senderTabId)) {
        console.log('[Recording] Ignoring action from untracked tab:', senderTabId);
        sendResponse({ success: false, reason: 'wrong_tab' });
        return false;
      }

      // Process the recorded action
      const action = message.action;
      // Attach tabId for cross-tab distinction
      if (senderTabId !== undefined) action.tabId = senderTabId;

      // Generate element selectors if element info is present
      if (action.element) {
        action.element = selectorGenerator.generateSelectors(action.element);
      }

      recorderState.addAction(action);

      // Notify side panel of recording state update
      if (currentPort) {
        currentPort.postMessage({
          type: 'recording_state_update',
          session: recorderState.getSession(),
        });
      }
    }
    sendResponse({ success: true });
    return false;
  }

  // Handle content script checking recording status (for page navigation recovery)
  if (message.type === 'check_recording_status') {
    const session = recorderState.getActiveSession();
    if (session) {
      // Only respond to requests from main frame (frameId === 0)
      // iframe 的 sender.frameId 会 > 0，不应该获得 recording status
      if (sender.frameId !== undefined && sender.frameId !== 0) {
        console.log('[Recording] Ignoring check_recording_status from iframe (frameId:', sender.frameId, ')');
        sendResponse({ isRecording: false, sessionId: null, reason: 'iframe_ignored' });
        return false;
      }

      // Verify this request comes from a tab we're tracking
      const senderTabId = sender.tab?.id;

      if (senderTabId !== undefined && !recorderState.isTabTracked(senderTabId)) {
        console.log('[Recording] Ignoring check_recording_status from untracked tab:', senderTabId);
        sendResponse({ isRecording: false, sessionId: null, reason: 'wrong_tab' });
        return false;
      }

      sendResponse({ isRecording: true, sessionId: session.id });
    } else {
      sendResponse({ isRecording: false, sessionId: null });
    }
    return false;
  }

  // Handle content script loaded notification
  if (message.type === 'content_script_loaded') {
    // Content script is ready, could be used for future features
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// Listen for tab activation to inject recording script when recording is active
// Cross-tab aware: only handle tabs that are in the tracked set; other tabs are
// ignored so users can browse unrelated tabs without polluting the recording.
chrome.tabs.onActivated.addListener(async activeInfo => {
  const session = recorderState.getActiveSession();
  if (!session) return;

  // Only react if this tab is being tracked
  if (!recorderState.isTabTracked(activeInfo.tabId)) {
    console.log('[Recording] Ignoring activation of untracked tab:', activeInfo.tabId);
    return;
  }

  // Recording is active, ensure content script is injected in the tab
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (!tab.url?.startsWith('http')) return;

  console.log('[Recording] Tab activated during recording:', activeInfo.tabId, tab.url);

  // Mark active tab — emit synthetic tab_switch action if focus actually changed
  const switched = recorderState.markActiveTab(activeInfo.tabId, { url: tab.url, title: tab.title });
  if (switched) {
    currentPort?.postMessage({ type: 'recording_state_update', session: recorderState.getSession() });
  }

  // Inject content script if needed - ONLY in main frame
  try {
    await chrome.tabs.sendMessage(activeInfo.tabId, { type: 'ping' }, { frameId: 0 });
  } catch {
    // Content script not present, inject it - ONLY to main frame
    console.log('[Recording] Injecting content script to tab (main frame only)');
    await chrome.scripting.executeScript({
      target: { tabId: activeInfo.tabId, frameIds: [0] }, // Only main frame
      files: ['content/index.iife.js'],
    });
  }

  // Send recording status to content script - ONLY in main frame
  try {
    await chrome.tabs.sendMessage(
      activeInfo.tabId,
      {
        type: 'start_recording',
        sessionId: session.id,
      },
      { frameId: 0 },
    ); // Only send to main frame
  } catch (e) {
    console.warn('[Recording] Failed to send recording status to tab:', e);
  }
});

// Listen for page navigation during recording
chrome.webNavigation?.onCompleted?.addListener(async details => {
  if (details.frameId !== 0) return; // Only main frame

  const session = recorderState.getActiveSession();
  if (!session) return;

  // Recording is active, ensure content script is ready after navigation
  if (!details.url?.startsWith('http')) return;

  // Only handle tabs in our tracked set
  if (!recorderState.isTabTracked(details.tabId)) {
    return;
  }

  console.log('[Recording] Page navigation completed during recording:', details.url);

  // Give content script time to load
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check if content script is ready and recording - ONLY in main frame (frameId: 0)
  try {
    const response = await chrome.tabs.sendMessage(details.tabId, { type: 'check_recording_status' }, { frameId: 0 });
    if (!response?.isRecording) {
      // Content script loaded but not recording, restart it - ONLY in main frame
      await chrome.tabs.sendMessage(
        details.tabId,
        {
          type: 'start_recording',
          sessionId: session.id,
        },
        { frameId: 0 },
      );
    }
  } catch (e) {
    // Content script not present, inject and start - ONLY in main frame
    try {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId, frameIds: [0] }, // Only inject to main frame
        files: ['content/index.iife.js'],
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      await chrome.tabs.sendMessage(
        details.tabId,
        {
          type: 'start_recording',
          sessionId: session.id,
        },
        { frameId: 0 },
      ); // Only send to main frame
    } catch (injectError) {
      console.warn('[Recording] Failed to inject content script after navigation:', injectError);
    }
  }
});

// Auto-track new tabs opened from a tracked tab (target="_blank" / window.open)
chrome.tabs.onCreated.addListener(async tab => {
  const session = recorderState.getActiveSession();
  if (!session || tab.id === undefined) return;
  // Only auto-add if the opener is a tracked tab
  if (tab.openerTabId !== undefined && recorderState.isTabTracked(tab.openerTabId)) {
    const added = recorderState.addTab(tab.id, {
      url: tab.pendingUrl || tab.url || '',
      title: tab.title || '',
      openerTabId: tab.openerTabId,
    });
    if (added) {
      console.log('[Recording] Auto-tracked new tab:', tab.id, 'from opener:', tab.openerTabId);
      currentPort?.postMessage({ type: 'recording_state_update', session: recorderState.getSession() });
    }
  }
});

// Clean up when a tracked tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  const session = recorderState.getActiveSession();
  if (!session) return;
  if (recorderState.isTabTracked(tabId)) {
    recorderState.removeTab(tabId);
    console.log('[Recording] Tab closed, removed from tracking:', tabId);
    currentPort?.postMessage({ type: 'recording_state_update', session: recorderState.getSession() });
  }
});

async function setupExecutor(
  taskId: string,
  task: string,
  browserContext: BrowserContext,
  images?: { name: string; base64: string }[],
) {
  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new Error(t('bg_setup_noApiKeys'));
  }

  // Clean up any legacy validator settings for backward compatibility
  await agentModelStore.cleanupLegacyValidatorSettings();

  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new Error(t('bg_setup_noProvider', [agentModel.provider]));
    }
  }

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error(t('bg_setup_noNavigatorModel'));
  }
  // Log the provider config being used for the navigator
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    // Log the provider config being used for the planner
    const plannerProviderConfig = providers[plannerModel.provider];
    plannerLLM = createChatModel(plannerProviderConfig, plannerModel);
  }

  // Create vision LLM if configured, otherwise use navigator LLM as fallback
  let visionLLM: BaseChatModel | null = null;
  const visionModel = agentModels[AgentNameEnum.Vision];
  if (visionModel) {
    const visionProviderConfig = providers[visionModel.provider];
    visionLLM = createChatModel(visionProviderConfig, visionModel);
    logger.info('Vision model configured:', visionModel.provider, visionModel.modelName);
  } else {
    // Use navigator LLM as fallback for vision
    visionLLM = navigatorLLM;
    logger.info('No vision model configured, using navigator model as fallback');
  }

  // Apply firewall settings to browser context
  const firewall = await firewallStore.getFirewall();
  if (firewall.enabled) {
    browserContext.updateConfig({
      allowedUrls: firewall.allowList,
      deniedUrls: firewall.denyList,
    });
  } else {
    browserContext.updateConfig({
      allowedUrls: [],
      deniedUrls: [],
    });
  }

  const generalSettings = await generalSettingsStore.getSettings();
  browserContext.updateConfig({
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000.0,
    displayHighlights: generalSettings.displayHighlights,
    viewportExpansion: generalSettings.viewportExpansion,
  });

  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    visionLLM: visionLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
    generalSettings: generalSettings,
    navigatorProvider: navigatorModel.provider,
    navigatorModelName: navigatorModel.modelName,
    plannerProvider: plannerModel?.provider ?? navigatorModel.provider,
    plannerModelName: plannerModel?.modelName ?? navigatorModel.modelName,
    visionProvider: visionModel?.provider ?? navigatorModel.provider,
    visionModelName: visionModel?.modelName ?? navigatorModel.modelName,
    mcpService: mcpService,
    skillsService: skillsService,
    images, // 用户上传的图片
  });

  return executor;
}

// Update subscribeToExecutorEvents to use port
async function subscribeToExecutorEvents(executor: Executor) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      if (currentPort) {
        currentPort.postMessage(event);
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    // Do NOT cleanup the executor on task completion — the user may send follow-up messages
    // that reuse the same executor (same browser context, same conversation history).
    // Cleanup happens when:
    //  1. A new_task is initiated (overwrites currentExecutor)
    //  2. The side-panel port disconnects
    //  3. The user explicitly cancels
  });
}
