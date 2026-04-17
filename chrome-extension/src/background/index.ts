import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  analyticsSettingsStore,
} from '@extension/storage';
import { t } from '@extension/i18n';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { SpeechToTextService } from './services/speechToText';
import { injectBuildDomTreeScripts } from './browser/dom/service';
import { analytics } from './services/analytics';
import { MCPService } from './services/mcp';
import { SkillsService } from './services/skills';
import { recorderState, selectorGenerator, generateSkillFromRecording } from './recorder';

const logger = createLogger('background');

const browserContext = new BrowserContext({});
let currentExecutor: Executor | null = null;
let currentPort: chrome.runtime.Port | null = null;
const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');

// Initialize MCP and Skills services
const mcpService = new MCPService();
const skillsService = new SkillsService();

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
Promise.all([mcpService.initialize(), skillsService.initialize()])
  .then(() => {
    logger.info('MCP and Skills services initialized');
  })
  .catch(error => {
    logger.error('Failed to initialize MCP/Skills services:', error);
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

  return false;
});

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

// Setup connection listener for long-lived connections (e.g., side panel)
chrome.runtime.onConnect.addListener(port => {
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

          case 'speech_to_text': {
            try {
              if (!message.audio) {
                return port.postMessage({
                  type: 'speech_to_text_error',
                  error: t('bg_cmd_stt_noAudioData'),
                });
              }

              logger.info('Processing speech-to-text request...');

              // Get all providers for speech-to-text service
              const providers = await llmProviderStore.getAllProviders();

              // Create speech-to-text service with all providers
              const speechToTextService = await SpeechToTextService.create(providers);

              // Extract base64 audio data (remove data URL prefix if present)
              let base64Audio = message.audio;
              if (base64Audio.startsWith('data:')) {
                base64Audio = base64Audio.split(',')[1];
              }

              // Transcribe audio
              const transcribedText = await speechToTextService.transcribeAudio(base64Audio);

              logger.info('Speech-to-text completed successfully');
              return port.postMessage({
                type: 'speech_to_text_result',
                text: transcribedText,
              });
            } catch (error) {
              logger.error('Speech-to-text failed:', error);
              return port.postMessage({
                type: 'speech_to_text_error',
                error: error instanceof Error ? error.message : t('bg_cmd_stt_failed'),
              });
            }
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
                // Notify content script to stop - ONLY in main frame
                try {
                  await chrome.tabs.sendMessage(
                    session.tabId,
                    {
                      type: 'stop_recording',
                    },
                    { frameId: 0 },
                  );
                } catch {
                  // Tab might be closed
                }
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
4. 保持步骤参数不变，只优化描述和名称

请以 JSON 格式返回优化后的 Skill，格式如下：
{
  "name": "优化后的名称",
  "description": "优化后的描述",
  "steps": [
    {
      "id": "step1",
      "action": "原始action",
      "description": "优化后的描述",
      "parameters": {...},
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

      // Verify this action comes from the tab we're recording
      const recordingTabId = recorderState.getRecordingTabId();
      const senderTabId = sender.tab?.id;

      if (recordingTabId !== null && senderTabId !== recordingTabId) {
        console.log(
          '[Recording] Ignoring action from different tab:',
          senderTabId,
          'vs recording tab:',
          recordingTabId,
        );
        sendResponse({ success: false, reason: 'wrong_tab' });
        return false;
      }

      // Process the recorded action
      const action = message.action;

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

      // Verify this request comes from the tab we're recording
      const recordingTabId = recorderState.getRecordingTabId();
      const senderTabId = sender.tab?.id;

      if (recordingTabId !== null && senderTabId !== recordingTabId) {
        console.log(
          '[Recording] Ignoring check_recording_status from different tab:',
          senderTabId,
          'vs recording tab:',
          recordingTabId,
        );
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
// Note: This only handles tab switching, NOT iframe navigation
chrome.tabs.onActivated.addListener(async activeInfo => {
  const session = recorderState.getActiveSession();
  if (!session) return;

  // Check if this is the tab we're recording (only record actions in the original recording tab)
  const recordingTabId = recorderState.getRecordingTabId();
  if (recordingTabId !== null && activeInfo.tabId !== recordingTabId) {
    console.log(
      '[Recording] User switched to different tab, ignoring:',
      activeInfo.tabId,
      'vs recording tab:',
      recordingTabId,
    );
    return;
  }

  // Recording is active, ensure content script is injected in the tab
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (!tab.url?.startsWith('http')) return;

  console.log('[Recording] Tab activated during recording:', activeInfo.tabId, tab.url);

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

  // Check if this is the same tab we're recording
  const recordingTabId = recorderState.getRecordingTabId();
  if (recordingTabId !== null && details.tabId !== recordingTabId) {
    console.log(
      '[Recording] Ignoring navigation in different tab:',
      details.tabId,
      'vs recording tab:',
      recordingTabId,
    );
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

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      await currentExecutor?.cleanup();
    }
  });
}
