/* eslint-disable @typescript-eslint/no-explicit-any */
// 导入React相关Hook函数
import { useState, useEffect, useCallback, useRef } from 'react';
// 导入UI图标组件
import { FiSettings, FiBookmark, FiSun, FiMoon } from 'react-icons/fi';
// 导入器灵遮罩注入脚本 URL（用于 files 注入）
/* 注入脚本通过 chrome.scripting.executeScript({ files: ['spiritOverlayInject.js'] }) 加载，
 * 不使用 ?raw import 或 eval，以兼容目标页面的 CSP 策略 */
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
// 导入消息类型、角色枚举和存储相关功能
import { type Message, Actors, chatHistoryStore, agentModelStore, generalSettingsStore } from '@extension/storage';
// 导入收藏提示存储和类型
import favoritesStorage, { type FavoritePrompt } from '@extension/storage/lib/prompt/favorites';
// 导入国际化函数
import { t } from '@extension/i18n';
// 导入 Skill 类型
import type { Skill } from '@extension/skills';
// 导入子组件
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import ChatHistoryList from './components/ChatHistoryList';
import BookmarkList from './components/BookmarkList';
import SpiritDoll from './components/SpiritDoll';
import ImageGenerationModal, { type ImageGenerationParams } from './components/ImageGenerationModal';
// 导入录制控制组件
import RecordingControl from './components/RecordingControl';
// 导入事件类型和执行状态
import { EventType, type AgentEvent, ExecutionState } from './types/event';
// 导入样式表
import './SidePanel.css';
import '@extension/ui/global.css';

// 声明Chrome API类型
/** 球球遮罩层 API（烟花/写字/庆祝） */
interface SpiritOverlayAPI {
  showFireworksShow?: (duration?: number) => void;
  writeText?: (text: string) => void;
  celebrate?: (msg?: string) => void;
  destroy?: () => void;
  isActive?: () => boolean;
}

/** 球球接管遮罩 API（全屏半透明 + 科幻呼吸灯） */
interface BallSpotlightAPI {
  show?: (opts?: { mode?: 'planning' | 'executing'; label?: string }) => void;
  hide?: () => void;
  setMode?: (mode: 'planning' | 'executing') => void;
  isActive?: () => boolean;
  getMode?: () => string;
  destroy?: () => void;
}

/** 球球网页实体 API（物理碰撞 + 捣乱） */
interface BallEntityAPI {
  launch?: (opts?: { targetSelector?: string; duration?: number }) => void;
  isActive?: () => boolean;
  getPosition?: () => { x: number; y: number };
  getVelocity?: () => { vx: number; vy: number };
  destroy?: () => void;
}

declare global {
  interface Window {
    chrome: typeof chrome;
    __spirit_overlay__?: SpiritOverlayAPI;
    __ball_spotlight__?: BallSpotlightAPI;
    __ball_entity__?: BallEntityAPI;
  }
}

const SidePanel = () => {
  // 进度消息常量
  const progressMessage = 'Showing progress...';

  // 消息状态：存储聊天消息数组
  const [messages, setMessages] = useState<Message[]>([]);
  // 输入启用状态：控制输入框是否可用
  const [inputEnabled, setInputEnabled] = useState(true);
  // 是否显示停止按钮
  const [showStopButton, setShowStopButton] = useState(false);
  // 当前执行步骤（传递给器灵显示）
  const [currentStep, setCurrentStep] = useState<{ actor: string; content: string } | null>(null);
  // 当前会话ID
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  // 是否显示历史记录
  const [showHistory, setShowHistory] = useState(false);
  // 是否显示书签面板
  const [showBookmarks, setShowBookmarks] = useState(false);
  // 聊天会话列表
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; createdAt: number }>>([]);
  // 是否处于跟进模式
  const [isFollowUpMode, setIsFollowUpMode] = useState(false);
  // 是否是历史会话
  const [isHistoricalSession, setIsHistoricalSession] = useState(false);
  // 是否是暗色模式
  const [isDarkMode, setIsDarkMode] = useState(false);
  // 收藏的提示词列表
  const [favoritePrompts, setFavoritePrompts] = useState<FavoritePrompt[]>([]);
  // 已收藏的会话ID集合（用于显示收藏/取消收藏状态）— 以 sessionId 为唯一标识
  const [bookmarkedSessionIds, setBookmarkedSessionIds] = useState<Set<string>>(new Set());

  // 收藏会话映射：sessionId → favoritePromptId（存储在 localStorage，避免按内容误匹配）
  const BOOKMARK_MAP_KEY = 'chat_bookmark_session_map';
  const getBookmarkMap = (): Record<string, number> => {
    try {
      return JSON.parse(localStorage.getItem(BOOKMARK_MAP_KEY) || '{}');
    } catch {
      return {};
    }
  };
  const saveBookmarkMap = (map: Record<string, number>) => {
    localStorage.setItem(BOOKMARK_MAP_KEY, JSON.stringify(map));
  };
  // 是否已配置模型（null=加载中，false=无模型，true=有模型）
  const [hasConfiguredModels, setHasConfiguredModels] = useState<boolean | null>(null);
  // 图片生成模态框状态
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImageBase64, setGeneratedImageBase64] = useState<string | undefined>();
  // 是否正在重播
  const [isReplaying, setIsReplaying] = useState(false);
  // 快速入门步骤展开状态
  const [showSteps, setShowSteps] = useState(false);
  // 重播功能开关（从设置获取）
  const [replayEnabled, setReplayEnabled] = useState(true);
  // AI接管遮罩开关
  const [showSpotlightEnabled, setShowSpotlightEnabled] = useState(true);
  // 工作流遮罩开关
  const [showWorkflowSpotlightEnabled, setShowWorkflowSpotlightEnabled] = useState(false);
  // 图片生成功能开关
  const [showImageGeneration, setShowImageGeneration] = useState(false);
  // 会话ID引用
  const sessionIdRef = useRef<string | null>(null);
  // 重播状态引用
  const isReplayingRef = useRef<boolean>(false);
  // Chrome运行时端口引用
  const portRef = useRef<chrome.runtime.Port | null>(null);
  // 心跳间隔引用
  const heartbeatIntervalRef = useRef<number | null>(null);
  // 消息列表底部引用（用于自动滚动到底部）
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 设置输入文本的引用
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  // 当前球球模式引用（用于在发送任务时包装内容）
  const spiritModeRef = useRef<'auto' | 'mischief' | 'sleepy' | 'curious' | 'farmer'>('auto');

  // 检查暗色模式偏好（从 localStorage 恢复，默认跟随系统）
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nanobrowser_dark_mode');
      if (saved === 'true') {
        setIsDarkMode(true);
      } else if (saved === 'false') {
        setIsDarkMode(false);
      } else {
        // 首次访问，跟随系统偏好
        setIsDarkMode(window.matchMedia('(prefers-color-scheme: dark)').matches);
      }
    } catch {
      setIsDarkMode(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  }, []);

  /** 手动切换暗色/亮色模式 */
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode(prev => {
      const next = !prev;
      try {
        localStorage.setItem('nanobrowser_dark_mode', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // 检查模型配置情况
  const checkModelConfiguration = useCallback(async () => {
    try {
      // 获取已配置的代理
      const configuredAgents = await agentModelStore.getConfiguredAgents();

      // 检查是否至少配置了一个代理（最好是Navigator代理）
      const hasAtLeastOneModel = configuredAgents.length > 0;
      setHasConfiguredModels(hasAtLeastOneModel);
    } catch (error) {
      console.error('检查模型配置时出错:', error);
      setHasConfiguredModels(false);
    }

    // 加载遮罩开关设置
    try {
      const settings = await generalSettingsStore.getSettings();
      setShowSpotlightEnabled(settings.showSpotlight);
      setShowWorkflowSpotlightEnabled(settings.showWorkflowSpotlight ?? false);
      setShowImageGeneration(settings.showImageGeneration ?? false);
      setReplayEnabled(settings.replayHistoricalTasks ?? true);
    } catch (error) {
      console.error('加载遮罩设置时出错:', error);
      setShowSpotlightEnabled(true); // 默认开启
      setShowWorkflowSpotlightEnabled(false); // 默认关闭
      setShowImageGeneration(false); // 默认关闭
    }
  }, []);

  // 在挂载时检查模型配置
  useEffect(() => {
    checkModelConfiguration();
  }, [checkModelConfiguration]);

  // 当侧面板再次变为可见时重新检查模型配置
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // 面板变为可见，重新检查配置
        checkModelConfiguration();
      }
    };

    const handleFocus = () => {
      // 面板获得焦点，重新检查配置
      checkModelConfiguration();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkModelConfiguration]);

  // 同步当前会话ID到引用
  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // 同步重播状态到引用
  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);

  // 添加新消息到消息列表
  const appendMessage = useCallback((newMessage: Message, sessionId?: string | null) => {
    // 不保存进度消息
    const isProgressMessage = newMessage.content === progressMessage;

    setMessages(prev => {
      // 过滤掉之前的进度消息
      const filteredMessages = prev.filter((msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1));
      return [...filteredMessages, newMessage];
    });

    // 如果提供了sessionId则使用它，否则回退到sessionIdRef.current
    const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;

    console.log('sessionId', effectiveSessionId);

    // 如果有会话ID且不是进度消息，则保存消息到存储
    if (effectiveSessionId && !isProgressMessage) {
      chatHistoryStore
        .addMessage(effectiveSessionId, newMessage)
        .catch(err => console.error('保存消息到历史记录失败:', err));
    }
  }, []);

  // ===== 球球接管遮罩（全屏半透明 + 科幻呼吸灯）=====
  const spotlightActiveRef = useRef(false);
  /** 捣乱模式标记 — 捣乱时不显示遮罩 */
  const isMischiefModeRef = useRef(false);
  /** 工作流执行模式标记 — 在工作流执行期间，AI子任务的终端事件不应改变UI状态 */
  const isWorkflowModeRef = useRef(false);
  /** 任务目标标签ID — 记住任务发起时的标签，切换标签后仍能正确操作 */
  const targetTabIdRef = useRef<number | null>(null);

  /** 静默隐藏指定标签上的遮罩（不修改状态标记，用于迁移场景） */
  const _hideSpotlightSilent = useCallback(async (tabId: number) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          window.__ball_spotlight__?.hide?.();
        },
      });
    } catch {
      // 静默失败——标签可能已关闭或导航离开
    }
  }, []);

  const _showSpotlight = useCallback(
    async (mode: 'planning' | 'executing' = 'planning') => {
      // 检查遮罩开关
      if (!showSpotlightEnabled) return;

      try {
        // 策略：优先使用缓存的目标标签，但始终验证其有效性；
        // 若目标标签已失效或非当前活动标签，则自动跟随到当前活动标签
        let targetTab: chrome.tabs.Tab | undefined;
        const cachedTabId = targetTabIdRef.current;

        if (cachedTabId) {
          const cachedTab = await chrome.tabs.get(cachedTabId).catch(() => null);
          if (
            cachedTab?.url &&
            !cachedTab.url.startsWith('chrome://') &&
            !cachedTab.url.startsWith('edge://') &&
            !cachedTab.url.startsWith('about:') &&
            !cachedTab.url.startsWith('chrome-extension://')
          ) {
            targetTab = cachedTab;
          }
        }

        // 回退：获取当前活动标签
        if (!targetTab) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          targetTab = tabs[0];
          // 同步更新缓存的目标标签ID
          if (targetTab?.id) {
            targetTabIdRef.current = targetTab.id;
          }
        }

        if (!targetTab?.id || !targetTab.url) {
          console.warn('[Spotlight] ⚠️ 无有效标签页');
          return;
        }
        if (
          targetTab.url.startsWith('chrome://') ||
          targetTab.url.startsWith('edge://') ||
          targetTab.url.startsWith('about:') ||
          targetTab.url.startsWith('chrome-extension://')
        ) {
          console.warn('[Spotlight] ⚠️ 系统页面跳过:', targetTab.url);
          return;
        }

        // 如果之前有遮罩在不同标签上，先清理（跨标签迁移场景）
        if (spotlightActiveRef.current && targetTabIdRef.current && targetTabIdRef.current !== targetTab.id) {
          await _hideSpotlightSilent(targetTabIdRef.current);
        }

        // 更新目标标签引用
        targetTabIdRef.current = targetTab.id;

        // 注入脚本（幂等——IIFE 内有 __spotlight_inited__ 守卫）
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files: ['side-panel/spotlightInject.js'],
        });

        // 调用显示 API，传入模式
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: m => {
            window.__ball_spotlight__?.show?.({ mode: m });
          },
          args: [mode],
        });

        spotlightActiveRef.current = true;
        console.log('[Spotlight] ✅ 遮罩已显示', { mode, tabId: targetTab.id, url: targetTab.url });
      } catch (err) {
        console.error('[Spotlight] ❌ 显示遮罩失败:', err);
        spotlightActiveRef.current = false;
      }
    },
    [_hideSpotlightSilent, showSpotlightEnabled],
  );

  /** 动态切换遮罩模式（规划↔执行）—— 支持自动跟随当前活动标签 */
  const _setSpotlightMode = useCallback(
    async (mode: 'planning' | 'executing') => {
      if (!spotlightActiveRef.current) return;
      try {
        // 策略：先尝试在缓存标签上操作；若失败或该标签已非活动标签，
        // 则自动迁移遮罩到当前活动标签
        let tabId = targetTabIdRef.current;
        let targetTab: chrome.tabs.Tab | undefined;

        if (tabId) {
          targetTab = await chrome.tabs.get(tabId).catch(() => undefined);
          // 检查缓存的标签是否仍然有效且是活动标签
          const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const activeTab = activeTabs[0];

          if (
            !targetTab ||
            !activeTab ||
            targetTab.id !== activeTab.id ||
            !activeTab.url ||
            activeTab.url.startsWith('chrome://') ||
            activeTab.url.startsWith('edge://') ||
            activeTab.url.startsWith('about:') ||
            activeTab.url.startsWith('chrome-extension://')
          ) {
            // 缓存标签失效或已不是活动标签 → 迁移到新标签
            if (
              activeTab?.id &&
              activeTab.url &&
              !activeTab.url.startsWith('chrome://') &&
              !activeTab.url.startsWith('edge://') &&
              !activeTab.url.startsWith('about:') &&
              !activeTab.url.startsWith('chrome-extension://')
            ) {
              console.log('[Spotlight] 🔄 检测到标签切换，迁移遮罩', { from: tabId, to: activeTab.id });

              // 先在旧标签隐藏
              if (tabId) await _hideSpotlightSilent(tabId);
              // 更新目标引用
              targetTabIdRef.current = activeTab.id;
              tabId = activeTab.id;

              // 在新标签注入并显示
              await chrome.scripting.executeScript({
                target: { tabId },
                files: ['side-panel/spotlightInject.js'],
              });
              await chrome.scripting.executeScript({
                target: { tabId },
                func: m => {
                  window.__ball_spotlight__?.show?.({ mode: m });
                },
                args: [mode],
              });
              return;
            }
          }
        }

        if (!tabId || !targetTab) return;

        // 正常情况：在同一标签上切换模式
        await chrome.scripting.executeScript({
          target: { tabId },
          func: m => {
            window.__ball_spotlight__?.setMode?.(m);
          },
          args: [mode],
        });
      } catch {
        console.error('[Spotlight] 切换模式失败');
      }
    },
    [_hideSpotlightSilent],
  );

  /** 隐藏接管遮罩 */
  const _hideSpotlight = useCallback(async () => {
    if (!spotlightActiveRef.current) return;
    try {
      const tabId = targetTabIdRef.current;
      let targetTab: chrome.tabs.Tab | undefined;

      if (tabId) {
        targetTab = await chrome.tabs.get(tabId).catch(() => undefined);
      }
      if (!targetTab) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        targetTab = tabs[0];
      }

      if (!targetTab?.id) {
        console.warn('[Spotlight] 隐藏遮罩：无有效标签页');
        spotlightActiveRef.current = false;
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        func: () => {
          window.__ball_spotlight__?.hide?.();
        },
      });

      console.log('[Spotlight] 遮罩已隐藏', { tabId: targetTab.id });
      spotlightActiveRef.current = false;
    } catch (err) {
      console.error('[Spotlight] 隐藏遮罩失败:', err);
      spotlightActiveRef.current = false;
    }
  }, []);

  // 处理任务状态变化
  const handleTaskState = useCallback(
    (event: AgentEvent) => {
      // 解构事件对象
      const { actor, state, timestamp, data } = event;
      const content = data?.details;
      let skip = true;
      let displayProgress = false;

      // 根据不同的参与者处理事件
      switch (actor) {
        case Actors.SYSTEM:
          switch (state) {
            case ExecutionState.TASK_START:
              // 重置历史会话标志 + 显示接管遮罩（捣乱模式除外）
              setIsHistoricalSession(false);
              if (!isMischiefModeRef.current) {
                _showSpotlight('planning');
              }
              break;
            case ExecutionState.TASK_OK:
              isMischiefModeRef.current = false; // 重置捣乱标记
              // 在工作流执行模式下，AI子任务完成不应改变UI状态
              // UI状态由工作流自身的 WORKFLOW_OK/FAIL 事件控制
              if (!isWorkflowModeRef.current) {
                setIsFollowUpMode(true);
                setInputEnabled(true);
                setShowStopButton(false);
                setIsReplaying(false);
                _hideSpotlight();
              }
              break;
            case ExecutionState.TASK_FAIL:
              isMischiefModeRef.current = false;
              // 在工作流执行模式下，AI子任务失败不应改变UI状态
              if (!isWorkflowModeRef.current) {
                setIsFollowUpMode(true);
                setInputEnabled(true);
                setShowStopButton(false);
                setIsReplaying(false);
                setCurrentStep(null);
                _hideSpotlight();
              }
              skip = false;
              break;
            case ExecutionState.TASK_CANCEL:
              isMischiefModeRef.current = false;
              // 在工作流执行模式下，取消不应改变UI状态
              if (!isWorkflowModeRef.current) {
                setIsFollowUpMode(false);
                setInputEnabled(true);
                setShowStopButton(false);
                setIsReplaying(false);
                setCurrentStep(null);
                _hideSpotlight();
              }
              skip = false;
              break;
            case ExecutionState.TASK_PAUSE:
              break;
            case ExecutionState.TASK_RESUME:
              break;
            default:
              console.error('无效的任务状态', state);
              return;
          }
          break;
        case Actors.USER:
          break;
        case Actors.PLANNER:
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              _setSpotlightMode('planning'); // 规划阶段：蓝青色
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            case ExecutionState.STEP_CANCEL:
              break;
            default:
              console.error('无效的步骤状态', state);
              return;
          }
          break;
        case Actors.NAVIGATOR:
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              _setSpotlightMode('executing'); // 执行阶段：琥珀金
              break;
            case ExecutionState.STEP_OK:
              displayProgress = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              displayProgress = false;
              break;
            case ExecutionState.STEP_CANCEL:
              displayProgress = false;
              _hideSpotlight();
              break;
            case ExecutionState.ACT_START:
              if (content !== 'cache_content') {
                // 跳过显示缓存内容
                skip = false;
              }
              break;
            case ExecutionState.ACT_OK:
              skip = !isReplayingRef.current;
              break;
            case ExecutionState.ACT_FAIL:
              skip = false;
              break;
            default:
              console.error('无效的动作', state);
              return;
          }
          break;
        case Actors.VALIDATOR:
          // 处理来自历史消息的旧验证器事件
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            default:
              console.error('无效的验证', state);
              return;
          }
          break;
        default:
          console.error('未知参与者', actor);
          return;
      }

      // 如果不应跳过，则添加消息
      if (!skip) {
        appendMessage({
          actor,
          content: content || '',
          timestamp: timestamp,
        });

        // 同步更新器灵的当前执行步骤（planner/navigator/validator 的步骤）
        const isStepActor = ['planner', 'navigator', 'validator'].includes(actor);
        if (isStepActor && content && !displayProgress) {
          setCurrentStep({ actor, content });
        }
      }

      // 如果需要显示进度，则添加进度消息
      if (displayProgress) {
        appendMessage({
          actor,
          content: progressMessage,
          timestamp: timestamp,
        });
      }
    },
    [appendMessage, _hideSpotlight, _showSpotlight, _setSpotlightMode],
  );

  // 处理 Workflow 执行事件
  const handleWorkflowEvent = useCallback(
    (event: {
      type: string;
      workflowId: string;
      nodeId?: string;
      nodeName?: string;
      details?: string;
      timestamp?: number;
    }) => {
      const { type, nodeName, details } = event;

      // 根据事件类型生成显示内容
      let displayContent = '';
      switch (type) {
        case 'WORKFLOW_START':
          displayContent = `▶ 开始执行工作流`;
          break;
        case 'WORKFLOW_OK':
          displayContent = `✅ 工作流执行完成`;
          break;
        case 'WORKFLOW_FAIL':
          displayContent = `❌ 工作流执行失败: ${details || ''}`;
          break;
        case 'NODE_START':
          displayContent = `⏳ 执行节点: ${nodeName || details || ''}`;
          break;
        case 'NODE_OK':
          displayContent = `✓ 节点完成: ${nodeName || details || ''}`;
          break;
        case 'NODE_FAIL':
          displayContent = `✗ 节点失败: ${nodeName || ''} - ${details || ''}`;
          break;
        case 'BRANCH_SELECT':
          displayContent = `🔀 分支选择: ${details || ''}`;
          break;
        default:
          displayContent = details || '';
          break;
      }

      if (displayContent) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: displayContent,
          timestamp: event.timestamp || Date.now(),
        });
      }

      // 工作流完成时恢复输入 + 清除工作流模式标记
      if (type === 'WORKFLOW_OK' || type === 'WORKFLOW_FAIL') {
        isWorkflowModeRef.current = false;
        setInputEnabled(true);
        setShowStopButton(false);
        setIsFollowUpMode(true);
        // 只有开启了工作流遮罩时才隐藏
        if (showWorkflowSpotlightEnabled) {
          _hideSpotlight();
        }
      }
    },
    [appendMessage, _hideSpotlight, showWorkflowSpotlightEnabled],
  );

  // 停止心跳并关闭连接
  const stopConnection = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (portRef.current) {
      portRef.current.disconnect();
      portRef.current = null;
    }
  }, []);

  // 设置连接管理
  const setupConnection = useCallback(() => {
    // 如果已有连接则只设置
    if (portRef.current) {
      return;
    }

    try {
      // 建立与后台脚本的连接
      portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });

      // 监听来自后台的消息
      portRef.current.onMessage.addListener((message: any) => {
        // 检查消息类型
        if (message && message.type === EventType.EXECUTION) {
          handleTaskState(message);
        } else if (message && message.type === 'workflow_event') {
          // 处理 Workflow 执行事件（节点开始/完成/分支选择等）
          handleWorkflowEvent(message.event);
        } else if (message && message.type === 'error') {
          // 处理来自服务工作者的错误消息
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('errors_unknown'),
            timestamp: Date.now(),
          });
          setInputEnabled(true);
          setShowStopButton(false);
        } else if (message && message.type === 'image_generation_result') {
          // 处理图片生成结果
          setIsGeneratingImage(false);
          if (message.result && message.result.success && message.result.images?.[0]?.b64_json) {
            const imageData = message.result.images[0].b64_json;
            setGeneratedImageBase64(imageData);
            appendMessage({
              actor: Actors.SYSTEM,
              content: `🎨 图片生成成功！`,
              timestamp: Date.now(),
              images: [{ base64: imageData, name: `generated-${Date.now()}.png` }],
            });
          } else {
            appendMessage({
              actor: Actors.SYSTEM,
              content: `图片生成失败: ${message.result?.error || message.error || '未知错误'}`,
              timestamp: Date.now(),
            });
          }
        } else if (message && message.type === 'heartbeat_ack') {
          console.log('心跳已确认');
        }
      });

      portRef.current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.log('连接断开', error ? `错误: ${error.message}` : '');
        portRef.current = null;
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        setInputEnabled(true);
        setShowStopButton(false);
      });

      // 设置心跳间隔
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === 'side-panel-connection') {
          try {
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            console.error('心跳失败:', error);
            stopConnection(); // 如果心跳失败则停止连接
          }
        } else {
          stopConnection(); // 如果端口无效则停止
        }
      }, 25000);
    } catch (error) {
      console.error('建立连接失败:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_conn_serviceWorker'),
        timestamp: Date.now(),
      });
      // 由于连接失败，清除任何引用
      portRef.current = null;
    }
  }, [handleTaskState, handleWorkflowEvent, appendMessage, stopConnection]);

  // 添加消息发送的安全检查
  const sendMessage = useCallback(
    (message: any) => {
      if (portRef.current?.name !== 'side-panel-connection') {
        throw new Error('没有有效的连接可用');
      }
      try {
        portRef.current.postMessage(message);
      } catch (error) {
        console.error('发送消息失败:', error);
        stopConnection(); // 当消息发送失败时停止连接
        throw error;
      }
    },
    [stopConnection],
  );

  // 处理重播命令
  const handleReplay = async (historySessionId: string): Promise<void> => {
    console.log('[重播] 开始', { historySessionId, replayEnabled });
    try {
      // 检查设置中是否启用了重播
      if (!replayEnabled) {
        console.warn('[重播] ❌ 重播功能未启用');
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_disabled'),
          timestamp: Date.now(),
        });
        return;
      }

      // 检查历史记录是否存在，使用loadAgentStepHistory
      const historyData = await chatHistoryStore.loadAgentStepHistory(historySessionId);
      console.log('[重播] 历史数据:', historyData ? '有数据' : 'null');
      if (!historyData) {
        console.warn('[重播] ❌ 没有历史步骤数据');
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_noHistory', historySessionId.substring(0, 20)),
          timestamp: Date.now(),
        });
        return;
      }

      // 获取目标标签页ID — 必须验证有效性（重播场景下缓存的旧标签可能已关闭）
      let tabId = targetTabIdRef.current;

      if (tabId) {
        // 验证缓存的标签是否仍有效
        const existingTab = await chrome.tabs.get(tabId).catch(() => null);
        if (!existingTab) {
          console.warn('[重播] ⚠️ 缓存的标签已关闭，回退到活动标签');
          tabId = null;
          targetTabIdRef.current = null;
        }
      }

      if (!tabId) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tabs[0]?.id ?? null;
      }
      if (!tabId) {
        throw new Error('未找到活动标签页');
      }

      console.log('[重播] 使用目标标签', { tabId });

      // 更新目标标签引用（供后续遮罩等功能使用）
      targetTabIdRef.current = tabId;

      // 如果我们在历史会话中，则清除消息
      if (isHistoricalSession) {
        setMessages([]);
      }

      // 为此重播任务创建新的聊天会话
      const newSession = await chatHistoryStore.createSession(`重播 ${historySessionId.substring(0, 20)}...`);
      console.log('重播的新会话', newSession);

      // 在状态和引用中存储新会话ID
      const newTaskId = newSession.id;
      setCurrentSessionId(newTaskId);
      sessionIdRef.current = newTaskId;

      // 发送重播命令到后台
      setInputEnabled(false);
      setShowStopButton(true);

      // 重置跟进模式和历史会话标志
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);

      const userMessage = {
        actor: Actors.USER,
        content: `/replay ${historySessionId}`,
        timestamp: Date.now(),
      };

      // 将用户消息添加到新会话
      appendMessage(userMessage, sessionIdRef.current);

      // 确保连接已建立（必须等待，否则 postMessage 会静默丢失）
      if (!portRef.current) {
        setupConnection();
        // 等待连接就绪
        await new Promise<void>(resolve => {
          const check = () => {
            if (portRef.current) resolve();
            else setTimeout(check, 50);
          };
          check();
        });
      }

      // 发送重播命令到后台，附带历史任务
      portRef.current?.postMessage({
        type: 'replay',
        taskId: newTaskId,
        tabId: tabId,
        historySessionId: historySessionId,
        task: historyData.task, // 添加来自历史的任务
      });

      console.log('[重播] 已发送到后台', { newTaskId, tabId, historySessionId, task: historyData.task });

      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_starting', historyData.task),
        timestamp: Date.now(),
      });
      setIsReplaying(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_failed', errorMessage),
        timestamp: Date.now(),
      });
    }
  };

  // 处理以/开头的命令
  const handleCommand = async (command: string): Promise<boolean> => {
    try {
      // 如果不存在则设置连接
      if (!portRef.current) {
        setupConnection();
      }

      // 处理不同命令
      if (command === '/state') {
        portRef.current?.postMessage({
          type: 'state',
        });
        return true;
      }

      if (command === '/nohighlight') {
        portRef.current?.postMessage({
          type: 'nohighlight',
        });
        return true;
      }

      if (command.startsWith('/replay ')) {
        // 解析重播命令: /replay <historySessionId>
        // 通过过滤空字符串处理多个空格
        const parts = command.split(' ').filter(part => part.trim() !== '');
        if (parts.length !== 2) {
          appendMessage({
            actor: Actors.SYSTEM,
            content: t('chat_replay_invalidArgs'),
            timestamp: Date.now(),
          });
          return true;
        }

        const historySessionId = parts[1];
        await handleReplay(historySessionId);
        return true;
      }

      // 不支持的命令
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_cmd_unknown', command),
        timestamp: Date.now(),
      });
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('命令错误', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      return true;
    }
  };

  // 处理执行 Skill
  const handleExecuteSkill = async (skillId: string, params: Record<string, unknown>) => {
    console.log('handleExecuteSkill', skillId, params);

    // 阻止在历史会话中执行
    if (isHistoricalSession) {
      console.log('无法在历史会话中执行 Skill');
      return;
    }

    try {
      // 获取 Skill 信息
      const { userSkillsStore } = await import('@extension/storage');
      const skillConfig = await userSkillsStore.getSkill(skillId);
      if (!skillConfig) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: `Skill "${skillId}" 未找到`,
          timestamp: Date.now(),
        });
        return;
      }

      // 确保 port 连接有效
      if (!portRef.current) {
        setupConnection();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 验证端口是否仍然有效（通过发送心跳测试）
      if (portRef.current) {
        try {
          portRef.current.postMessage({ type: 'heartbeat' });
        } catch (e) {
          console.warn('[Skill] Port appears disconnected, reconnecting...');
          portRef.current = null;
          setupConnection();
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }

      if (!portRef.current) {
        throw new Error('连接建立失败，请刷新扩展');
      }

      // 获取活动标签页
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('未找到活动标签页');
      }

      targetTabIdRef.current = tabId;

      const paramDisplay = Object.entries(params)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(', ');

      const displayText = `⚡ 执行 Skill: ${skillConfig.name}${paramDisplay ? `\n参数: ${paramDisplay}` : ''}`;

      // 创建会话（先创建，使用返回的 session.id）
      const newSession = await chatHistoryStore.createSession(displayText);
      const taskId = newSession.id;
      sessionIdRef.current = taskId;
      setCurrentSessionId(taskId);
      setCurrentStep(null);

      // 添加用户消息（显示 Skill 执行）
      appendMessage(
        {
          actor: Actors.USER,
          content: displayText,
          timestamp: Date.now(),
        },
        taskId,
      );

      // 添加系统消息
      appendMessage(
        {
          actor: Actors.SYSTEM,
          content: `正在执行 Skill "${skillConfig.name}"...`,
          timestamp: Date.now(),
        },
        taskId,
      );

      setIsFollowUpMode(false);
      setInputEnabled(false);
      setShowStopButton(true);

      // 发送执行 Skill 消息到 background
      portRef.current.postMessage({
        type: 'execute_skill',
        taskId,
        tabId,
        skillId,
        params,
      });

      console.log('[Skill] 执行请求已发送:', skillId);
    } catch (error) {
      console.error('[Skill] 执行失败:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: `Skill 执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: Date.now(),
      });
      setInputEnabled(true);
      setShowStopButton(false);
    }
  };

  // 处理执行 Workflow
  const handleExecuteWorkflow = async (workflowId: string) => {
    console.log('handleExecuteWorkflow', workflowId);

    // 阻止在历史会话中执行
    if (isHistoricalSession) {
      console.log('无法在历史会话中执行 Workflow');
      return;
    }

    try {
      // 获取 Workflow 信息
      const { userWorkflowsStore } = await import('@extension/storage');
      const workflowConfig = await userWorkflowsStore.getWorkflow(workflowId);
      if (!workflowConfig) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: `Workflow "${workflowId}" 未找到`,
          timestamp: Date.now(),
        });
        return;
      }

      // 确保 port 连接有效
      if (!portRef.current) {
        setupConnection();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 验证端口是否仍然有效（通过发送心跳测试）
      if (portRef.current) {
        try {
          portRef.current.postMessage({ type: 'heartbeat' });
        } catch (e) {
          console.warn('[Workflow] Port appears disconnected, reconnecting...');
          portRef.current = null;
          setupConnection();
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }

      if (!portRef.current) {
        throw new Error('连接建立失败，请刷新扩展');
      }

      // 获取活动标签页
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('未找到活动标签页');
      }

      targetTabIdRef.current = tabId;

      const displayText = `🔄 执行 Workflow: ${workflowConfig.name}`;

      // 创建会话
      const newSession = await chatHistoryStore.createSession(displayText);
      const taskId = newSession.id;
      sessionIdRef.current = taskId;
      setCurrentSessionId(taskId);
      setCurrentStep(null);

      // 添加用户消息
      appendMessage(
        {
          actor: Actors.USER,
          content: displayText,
          timestamp: Date.now(),
        },
        taskId,
      );

      // 添加系统消息
      appendMessage(
        {
          actor: Actors.SYSTEM,
          content: `正在执行 Workflow "${workflowConfig.name}"...`,
          timestamp: Date.now(),
        },
        taskId,
      );

      setIsFollowUpMode(false);
      setInputEnabled(false);
      setShowStopButton(true);
      // 标记进入工作流执行模式，AI子任务的终端事件不应改变UI状态
      isWorkflowModeRef.current = true;

      // 根据设置决定是否显示工作流遮罩
      if (showWorkflowSpotlightEnabled) {
        _showSpotlight('planning');
      }

      // 发送执行 Workflow 消息到 background
      portRef.current.postMessage({
        type: 'execute_workflow',
        taskId,
        tabId,
        workflowId,
        params: {},
        showOverlay: showWorkflowSpotlightEnabled, // 传递遮罩开关设置
      });

      console.log('[Workflow] 执行请求已发送:', workflowId);
    } catch (error) {
      console.error('[Workflow] 执行失败:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: `Workflow 执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: Date.now(),
      });
      setInputEnabled(true);
      setShowStopButton(false);
    }
  };

  // 打开图片生成模态框
  const handleOpenImageModal = () => {
    setIsImageModalOpen(true);
    setGeneratedImageBase64(undefined);
  };

  // 处理图片生成请求
  const handleGenerateImage = async (params: ImageGenerationParams) => {
    setIsGeneratingImage(true);

    try {
      // 确保端口连接
      if (!portRef.current) {
        setupConnection();
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!portRef.current) {
          throw new Error('连接建立失败');
        }
      }

      // 添加用户消息显示正在生成图片
      appendMessage({
        actor: Actors.USER,
        content: `🎨 生成图片: ${params.prompt.slice(0, 50)}${params.prompt.length > 50 ? '...' : ''}`,
        timestamp: Date.now(),
      });

      appendMessage({
        actor: Actors.SYSTEM,
        content: t('image_generation_generating'),
        timestamp: Date.now(),
      });

      // 发送生成图片请求
      portRef.current.postMessage({
        type: 'generate_image',
        prompt: params.prompt,
        size: params.size,
        quality: params.quality,
        n: 1,
        responseFormat: 'b64_json',
      });

      // 等待响应通过port.onMessage处理
    } catch (error) {
      console.error('[Image] 生成失败:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: `图片生成失败: ${error instanceof Error ? error.message : '未知错误'}`,
        timestamp: Date.now(),
      });
      setIsGeneratingImage(false);
    }
  };

  // 处理发送消息
  const handleSendMessage = async (
    text: string,
    displayText?: string,
    images?: { name: string; base64: string }[],
    skill?: Skill | null,
  ) => {
    console.log(
      'handleSendMessage',
      text,
      images?.length ? `with ${images.length} images` : '',
      skill ? `with skill: ${skill.name}` : '',
    );

    // 首先修剪输入文本
    const trimmedText = text.trim();

    if (!trimmedText && !images?.length && !skill) return;

    // 处理 skill 信息：如果有选中的 skill，将其信息包含在任务中
    let skillEnhancedText = trimmedText;
    let skillEnhancedDisplayText = displayText || trimmedText;

    if (skill) {
      // 构建 skill 信息
      const skillInfo = `\n\n<nano_selected_skill id="${skill.id}" name="${skill.name}" description="${skill.description || ''}">
  ${skill.steps.map((s, i) => `步骤 ${i + 1}: ${s.description || s.action}`).join('\n  ')}
</nano_selected_skill>`;
      skillEnhancedText = trimmedText ? `${trimmedText}${skillInfo}` : `执行 Skill: ${skill.name}${skillInfo}`;
      skillEnhancedDisplayText = trimmedText
        ? `${trimmedText}\n⚡ 使用 Skill: ${skill.name}`
        : `⚡ 执行 Skill: ${skill.name}`;
    }

    // 农场主模式：包装用户任务为AI农场优先策略
    let finalText = skillEnhancedText;
    let finalDisplayText = skillEnhancedDisplayText;

    if (spiritModeRef.current === 'farmer') {
      const farmerWrapper = `[农场主模式] 请按以下策略处理用户的任务：

## AI农场优先访问顺序
1. **DeepSeek** (https://chat.deepseek.com) - 深度推理能力强，适合复杂分析
2. **通义千问** (https://www.qianwen.com) - 阿里云AI，中文理解优秀

## 执行策略
- 首先打开第一个可访问的AI网站，在输入框中输入用户问题
- 发送完成后，检查是否发送成功（确认输入框已清空或有回复出现）
- 如果提交失败，可尝试其他提交方式
- 等待AI回复，记录关键信息
- 继续访问下一个AI网站获取不同视角
- 最后汇总各个AI的回答，形成综合对比报告
- 如果某个网站需要登录，跳过继续下一个

---

## 用户任务
${trimmedText}`;

      finalText = farmerWrapper;
      finalDisplayText = `🌾 [农场主模式] ${trimmedText}`;
      console.log('[农场主模式] 包装任务完成');
    }

    // 检查输入是否为命令（以/开头）
    if (trimmedText.startsWith('/')) {
      // 处理命令，如果已处理则返回
      const wasHandled = await handleCommand(trimmedText);
      if (wasHandled) return;
    }

    // 阻止在历史会话中发送消息
    if (isHistoricalSession) {
      console.log('无法在历史会话中发送消息');
      return;
    }

    try {
      // 第一步：确保连接已建立
      if (!portRef.current) {
        setupConnection();
        // 等待连接建立（给一点时间让连接初始化）
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!portRef.current) {
          throw new Error('连接建立失败，请重试');
        }
      }

      // 第二步：获取活动标签页
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('未找到活动标签页');
      }

      // 记住目标标签ID
      targetTabIdRef.current = tabId;

      // 第三步：如果不在跟进模式下，创建新的聊天会话
      if (!isFollowUpMode) {
        const titleText = finalDisplayText;
        const newSession = await chatHistoryStore.createSession(
          titleText.substring(0, 50) + (titleText.length > 50 ? '...' : ''),
        );
        console.log('新会话', newSession);

        const sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
      }

      // 第四步：添加用户消息到UI（此时连接已准备好）
      const userMessage = {
        actor: Actors.USER,
        content: finalDisplayText,
        timestamp: Date.now(),
      };
      appendMessage(userMessage, sessionIdRef.current);

      // 第五步：发送消息到后台（发送成功后才更新状态）
      if (isFollowUpMode) {
        await sendMessage({
          type: 'follow_up_task',
          task: finalText,
          taskId: sessionIdRef.current,
          tabId,
          images, // 传递用户上传的图片
        });
        console.log('跟进任务已发送', finalText, tabId, sessionIdRef.current);
      } else {
        await sendMessage({
          type: 'new_task',
          task: finalText,
          taskId: sessionIdRef.current,
          tabId,
          images, // 传递用户上传的图片
        });
        console.log('新任务已发送', finalText, tabId, sessionIdRef.current);
      }

      // 第六步：发送成功后，更新UI状态为"执行中"
      setInputEnabled(false);
      setShowStopButton(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('任务错误', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: `⚠️ 发送失败: ${errorMessage}`,
        timestamp: Date.now(),
      });
      // 发送失败，恢复状态
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
    }
  };

  // 处理停止任务
  const handleStopTask = async () => {
    try {
      portRef.current?.postMessage({
        type: 'cancel_task',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('取消任务错误', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
    }
    setInputEnabled(true);
    setShowStopButton(false);
  };

  // 处理新建聊天
  const handleNewChat = () => {
    // 清除消息并开始新聊天
    setMessages([]);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setInputEnabled(true);
    setShowStopButton(false);
    setIsFollowUpMode(false);
    setIsHistoricalSession(false);
    setCurrentStep(null); // 新聊天，重置执行步骤

    // 断开任何现有连接
    stopConnection();
  };

  // 加载聊天会话
  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await chatHistoryStore.getSessionsMetadata();
      setChatSessions(sessions.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error('加载聊天会话失败:', error);
    }
  }, []);

  // 处理加载历史记录
  const handleLoadHistory = async () => {
    await loadChatSessions();
    setShowHistory(true);
  };

  // 返回聊天视图
  const handleBackToChat = (reset = false) => {
    setShowHistory(false);
    if (reset) {
      setCurrentSessionId(null);
      setMessages([]);
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);
    }
  };

  // 处理会话选择
  const handleSessionSelect = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);
      if (fullSession && fullSession.messages.length > 0) {
        setCurrentSessionId(fullSession.id);
        setMessages(fullSession.messages);
        setIsFollowUpMode(false);
        setIsHistoricalSession(true); // 标记为历史会话
        console.log('历史会话已选择', sessionId);
      }
      setShowHistory(false);
    } catch (error) {
      console.error('加载会话失败:', error);
    }
  };

  // 处理会话删除
  const handleSessionDelete = async (sessionId: string) => {
    try {
      await chatHistoryStore.deleteSession(sessionId);
      await loadChatSessions();
      if (sessionId === currentSessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
    } catch (error) {
      console.error('删除会话失败:', error);
    }
  };

  // 处理会话收藏 — 加入/取消书签（切换模式，基于 sessionId 唯一标识）
  const handleSessionBookmark = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);

      if (!fullSession) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: '⚠️ 找不到该会话，操作失败',
          timestamp: Date.now(),
        });
        return;
      }

      if (fullSession.messages.length === 0) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: '⚠️ 该会话没有内容，无法收藏',
          timestamp: Date.now(),
        });
        return;
      }

      // 检查是否已通过 sessionId 映射收藏
      const bookmarkMap = getBookmarkMap();
      const existingPromptId = bookmarkMap[sessionId];

      if (existingPromptId !== undefined) {
        // 已收藏 → 取消收藏：从 favoritesStorage 删除 + 清除映射
        await favoritesStorage.removePrompt(existingPromptId);

        const newMap = { ...bookmarkMap };
        delete newMap[sessionId];
        saveBookmarkMap(newMap);

        setBookmarkedSessionIds(prev => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });

        const prompts = await favoritesStorage.getAllPrompts();
        setFavoritePrompts(prompts);

        appendMessage({
          actor: Actors.SYSTEM,
          content: '🗑️ 已取消收藏',
          timestamp: Date.now(),
        });
        return;
      }

      // 未收藏 → 添加收藏
      const sessionTitle = fullSession.title;
      const title = sessionTitle.length > 20 ? sessionTitle.slice(0, 20) + '...' : sessionTitle;
      const taskContent = fullSession.messages[0].content || '';
      const content = taskContent.length > 100 ? taskContent.slice(0, 100) + '...' : taskContent;

      const newPrompt = await favoritesStorage.addPrompt(title, content);

      // 写入 sessionId → promptId 映射
      const newMap = { ...bookmarkMap, [sessionId]: (newPrompt as any).id };
      saveBookmarkMap(newMap);

      setBookmarkedSessionIds(prev => {
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });

      const prompts = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(prompts);

      appendMessage({
        actor: Actors.SYSTEM,
        content: `✅ 已将「${title}」加入书签`,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('收藏/取消收藏操作失败:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: '❌ 操作失败，请稍后再试',
        timestamp: Date.now(),
      });
    }
  };

  // 处理收藏选择
  const handleBookmarkSelect = (content: string) => {
    if (setInputTextRef.current) {
      setInputTextRef.current(content);
    }
  };

  // 更新收藏标题
  const handleBookmarkUpdateTitle = async (id: number, title: string) => {
    try {
      await favoritesStorage.updatePromptTitle(id, title);

      // 在UI中更新收藏
      const prompts = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(prompts);
    } catch (error) {
      console.error('更新收藏提示标题失败:', error);
    }
  };

  // 删除收藏
  const handleBookmarkDelete = async (id: number) => {
    try {
      await favoritesStorage.removePrompt(id);

      // 在UI中更新收藏
      const prompts = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(prompts);
    } catch (error) {
      console.error('删除收藏提示失败:', error);
    }
  };

  // 重新排序收藏
  const handleBookmarkReorder = async (draggedId: number, targetId: number) => {
    try {
      // 直接传递ID到存储函数 - 它现在处理重新排序逻辑
      await favoritesStorage.reorderPrompts(draggedId, targetId);

      // 从存储中获取更新后的列表以获取新的ID并反映权威顺序
      const updatedPromptsFromStorage = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(updatedPromptsFromStorage);
    } catch (error) {
      console.error('重新排序收藏提示失败:', error);
    }
  };

  // 加载收藏提示从存储
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const prompts = await favoritesStorage.getAllPrompts();
        setFavoritePrompts(prompts);
      } catch (error) {
        console.error('加载收藏提示失败:', error);
      }
    };

    loadFavorites();
  }, []);

  // 当会话列表变化时，从映射中恢复已收藏的 sessionId 集合
  useEffect(() => {
    const map = getBookmarkMap();
    const ids = new Set<string>();
    for (const sid of chatSessions) {
      if (map[sid.id] !== undefined) {
        ids.add(sid.id);
      }
    }
    setBookmarkedSessionIds(ids);
  }, [chatSessions]);

  // 清理卸载时
  useEffect(() => {
    return () => {
      stopConnection();
    };
  }, [stopConnection]);

  // 当新消息到达时滚动到底部
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div
        className="relative flex h-screen flex-col overflow-hidden border transition-all duration-500 ease-out"
        style={{
          borderColor: isDarkMode ? 'rgba(116,198,157,0.08)' : 'rgba(139,115,85,0.12)',
          background: isDarkMode ? '#0F0E0C' : 'linear-gradient(180deg, #FAF8F5 0%, #F5F2ED 45%, #FAF8F5 100%)',
        }}>
        {/* 山水云雾背景 */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: isDarkMode ? 1 : 1,
            background: isDarkMode
              ? undefined
              : 'radial-gradient(ellipse at 20% 80%, rgba(64,145,108,0.07) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(217,119,6,0.04) 0%, transparent 50%)',
          }}
        />

        {/* Header 头部 */}
        <header className="header relative z-20">
          <div className="header-logo">
            {showHistory ? (
              <button
                type="button"
                onClick={() => handleBackToChat(false)}
                className="cursor-pointer font-medium transition-all duration-200"
                style={{ color: 'var(--accent-color)' }}
                aria-label={t('nav_back_a11y')}>
                {t('nav_back')}
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleDarkMode}
                className="flex size-7 items-center justify-center rounded-full transition-all duration-300 hover:scale-110"
                style={{
                  color: isDarkMode ? '#FCD34D' : '#F59E0B',
                  background: isDarkMode ? 'rgba(252,211,77,0.12)' : 'rgba(245,158,11,0.10)',
                }}
                aria-label={isDarkMode ? '切换到亮色模式' : '切换到暗色模式'}
                title={isDarkMode ? '🌙 暗色模式' : '☀️ 亮色模式'}>
                {isDarkMode ? <FiMoon size={15} /> : <FiSun size={15} />}
              </button>
            )}
          </div>
          <div className="header-icons">
            {!showHistory && (
              <>
                <button
                  type="button"
                  onClick={handleNewChat}
                  onKeyDown={e => e.key === 'Enter' && handleNewChat()}
                  className="header-icon"
                  style={{ color: 'var(--accent-color)' }}
                  aria-label={t('nav_newChat_a11y')}
                  tabIndex={0}>
                  <PiPlusBold size={17} />
                </button>
                <button
                  type="button"
                  onClick={handleLoadHistory}
                  onKeyDown={e => e.key === 'Enter' && handleLoadHistory()}
                  className="header-icon"
                  style={{ color: 'var(--accent-color)' }}
                  aria-label={t('nav_loadHistory_a11y')}
                  tabIndex={0}>
                  <GrHistory size={17} />
                </button>
                {/* Recording Control */}
                <RecordingControl isDarkMode={isDarkMode} port={portRef.current} />
              </>
            )}
            <button
              type="button"
              onClick={() => chrome.runtime.openOptionsPage()}
              onKeyDown={e => e.key === 'Enter' && chrome.runtime.openOptionsPage()}
              className="header-icon"
              style={{ color: 'var(--accent-color)' }}
              aria-label={t('nav_settings_a11y')}
              tabIndex={0}>
              <FiSettings size={17} />
            </button>
          </div>
        </header>
        {showHistory ? (
          <div className="relative z-10 flex-1 overflow-hidden">
            <ChatHistoryList
              sessions={chatSessions}
              onSessionSelect={handleSessionSelect}
              onSessionDelete={handleSessionDelete}
              onSessionBookmark={handleSessionBookmark}
              bookmarkedSessionIds={bookmarkedSessionIds}
              onFillInputFromHistory={content => {
                if (setInputTextRef.current) setInputTextRef.current(content);
                setShowHistory(false); // 填充后关闭历史面板，回到聊天
              }}
              onReplay={handleReplay}
              visible={true}
              isDarkMode={isDarkMode}
            />
          </div>
        ) : showBookmarks ? (
          <div className="relative z-10 flex flex-col overflow-hidden">
            {/* 书签面板标题 */}
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: 'var(--border-color)' }}>
              <h2 className="text-base font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
                📚 书签收藏
                <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                  ({favoritePrompts.length})
                </span>
              </h2>
            </div>
            {/* 书签列表 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-6">
              <BookmarkList
                bookmarks={favoritePrompts}
                onBookmarkSelect={content => {
                  handleBookmarkSelect(content);
                  setShowBookmarks(false); // 选择后自动关闭面板，回到聊天
                }}
                onBookmarkUpdateTitle={handleBookmarkUpdateTitle}
                onBookmarkDelete={handleBookmarkDelete}
                onBookmarkReorder={handleBookmarkReorder}
                isDarkMode={isDarkMode}
              />
            </div>
          </div>
        ) : (
          <>
            {hasConfiguredModels === null && (
              <div className="relative z-10 flex flex-1 items-center justify-center p-8">
                <div className="text-center">
                  <div
                    className="mx-auto mb-4 size-9 animate-spin rounded-full border-2 border-transparent"
                    style={{
                      borderTopColor: isDarkMode ? '#74C69D' : '#40916C',
                      boxShadow: '0 0 16px var(--accent-glow)',
                    }}
                  />
                  <p className="text-sm font-medium tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                    {t('status_checkingConfig')}
                  </p>
                </div>
              </div>
            )}

            {hasConfiguredModels === false && (
              <div className="relative z-10 flex flex-1 items-center justify-center p-6">
                <div className="max-w-md text-center">
                  <SpiritDoll isDarkMode={isDarkMode} isExecuting={false} currentStep={null} />
                  <h3 className="my-2 text-lg font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
                    {t('welcome_title')}
                  </h3>
                  <p className="mb-4 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {t('welcome_instruction')}
                  </p>
                  <button
                    onClick={() => chrome.runtime.openOptionsPage()}
                    className="jade-btn my-3 px-6 py-2 text-sm tracking-wide">
                    {t('welcome_openSettings')}
                  </button>
                  {/* 三步上手指南 */}
                  <div className="mt-4 text-left" style={{ color: 'var(--text-muted)' }}>
                    <button
                      type="button"
                      onClick={() => setShowSteps(!showSteps)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click();
                      }}
                      className="flex items-center gap-1 cursor-pointer transition-opacity hover:!opacity-100 bg-transparent border-0 text-left p-0"
                      style={{
                        color: 'var(--accent-color)',
                        opacity: 0.8,
                        fontSize: 'inherit',
                        fontFamily: 'inherit',
                      }}>
                      <span>
                        {showSteps ? '▾' : '▸'} {t('welcome_quickStart')}
                      </span>
                    </button>
                    {showSteps && (
                      <div className="mt-3 space-y-3">
                        {[
                          { title: t('welcome_step1_title'), desc: t('welcome_step1_desc'), icon: '📦' },
                          { title: t('welcome_step2_title'), desc: t('welcome_step2_desc'), icon: '🔑' },
                          { title: t('welcome_step3_title'), desc: t('welcome_step3_desc'), icon: '💬' },
                        ].map((step, i) => (
                          <div
                            key={i}
                            className="flex gap-2.5 rounded-lg px-3 py-2.5 transition-all duration-200"
                            style={{
                              background:
                                i === 0
                                  ? isDarkMode
                                    ? 'rgba(64,145,108,0.08)'
                                    : 'rgba(64,145,108,0.06)'
                                  : i === 1
                                    ? isDarkMode
                                      ? 'rgba(245,158,11,0.08)'
                                      : 'rgba(245,158,11,0.06)'
                                    : isDarkMode
                                      ? 'rgba(167,139,250,0.08)'
                                      : 'rgba(167,139,250,0.06)',
                              border: '1px solid var(--border-color)',
                            }}>
                            <span className="text-base shrink-0">{step.icon}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
                                {step.title}
                              </div>
                              <div
                                className="text-[10px] leading-relaxed"
                                style={{ color: 'var(--text-secondary)', opacity: 0.85 }}>
                                {step.desc}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {hasConfiguredModels === true && (
              <>
                {/* ===== 器灵层 — 顶部独占，悬浮在对话框之上 ===== */}
                <div className="relative z-10 shrink-0 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <SpiritDoll
                    isDarkMode={isDarkMode}
                    isExecuting={showStopButton}
                    currentStep={currentStep}
                    onAutonomousAction={async (action: string, data?: string) => {
                      console.log('[球球自主行为]', action);
                      // 获取当前活动标签页（公共前置步骤，所有动作都需要 tabId）
                      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                      const tabId = tabs[0]?.id;
                      if (!tabId) return;

                      if (action === 'scroll-page') {
                        try {
                          // 标记捣乱模式（不显示遮罩）
                          isMischiefModeRef.current = true;

                          // ===== 球球实体进入网页！=====
                          try {
                            const mTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                            const mt = mTabs[0];
                            if (
                              mt?.id &&
                              mt.url &&
                              !mt.url.startsWith('chrome://') &&
                              !mt.url.startsWith('edge://') &&
                              !mt.url.startsWith('about:')
                            ) {
                              // 注入球球实体脚本
                              await chrome.scripting.executeScript({
                                target: { tabId: mt.id },
                                files: ['side-panel/ballInject.js'],
                              });

                              // 发射球球到页面中！（固定右上角飞入）
                              await chrome.scripting.executeScript({
                                target: { tabId: mt.id },
                                func: () => {
                                  window.__ball_entity__?.launch?.({ duration: 6000 });
                                },
                              });

                              appendMessage({
                                actor: Actors.SYSTEM,
                                content: '\u{1F608} \u7403\u7403\u4ECE\u53F3\u4E0A\u89D2\u5192\u8FDB\u6765\u5566~',
                                timestamp: Date.now(),
                              });
                            }
                          } catch (ballErr) {
                            console.warn('球球进入网页失败:', ballErr);
                          }

                          // 不再创建会话和发送任务 — 只发射实体捣乱，不触发 AI 执行流程

                          // 7秒后重置捣乱标记（球球存活6s + 1s缓冲）
                          setTimeout(() => {
                            isMischiefModeRef.current = false;
                          }, 7000);
                        } catch (err) {
                          console.error('球球捣乱失败:', err);
                        }
                      } else if (action.startsWith('overlay-')) {
                        // 遮罩层效果：通过 files 注入脚本 + 直接函数调用（兼容 CSP，不使用 eval/new Function）
                        try {
                          // 检查页面是否允许注入（chrome:// 等页面会报错）
                          const targetTab = tabs[0];
                          if (
                            !targetTab?.url ||
                            targetTab.url.startsWith('chrome://') ||
                            targetTab.url.startsWith('edge://') ||
                            targetTab.url.startsWith('about:')
                          ) {
                            appendMessage({
                              actor: Actors.SYSTEM,
                              content: '\u26A0\uFE0F 当前页面不支持遮罩效果（系统页面限制）',
                              timestamp: Date.now(),
                            });
                            return;
                          }

                          const overlayAction = action.replace('overlay-', '');

                          // 第一步：用 files 参数注入脚本（不使用 eval，CSP 安全）
                          // 路径相对于扩展根目录，构建后脚本位于 dist/side-panel/spiritOverlayInject.js
                          await chrome.scripting.executeScript({
                            target: { tabId },
                            files: ['side-panel/spiritOverlayInject.js'],
                          });

                          // 第二步：直接函数调用 API（不用 new Function/eval）
                          if (overlayAction === 'fireworks') {
                            await chrome.scripting.executeScript({
                              target: { tabId },
                              func: () => {
                                window.__spirit_overlay__?.showFireworksShow?.();
                              },
                            });
                          } else if (overlayAction === 'write') {
                            const text = data || '球球来啦~';
                            await chrome.scripting.executeScript({
                              target: { tabId },
                              func: t => {
                                window.__spirit_overlay__?.writeText?.(t);
                              },
                              args: [text],
                            });
                          } else if (overlayAction === 'celebrate') {
                            const msg = data || '球球好开心！';
                            await chrome.scripting.executeScript({
                              target: { tabId },
                              func: m => {
                                window.__spirit_overlay__?.celebrate?.(m);
                              },
                              args: [msg],
                            });
                          }
                          appendMessage({
                            actor: Actors.SYSTEM,
                            content:
                              overlayAction === 'fireworks'
                                ? '\u{1F386} 球球在页面上放烟花啦~'
                                : overlayAction === 'write'
                                  ? '\u270F\uFE0F 球球在留字...'
                                  : '\u{1F389} 球球庆祝中！',
                            timestamp: Date.now(),
                          });
                        } catch (err) {
                          console.error('遮罩效果失败:', err);
                        }
                      }
                    }}
                    onModeChange={mode => {
                      console.log('[球球模式变化]', mode);
                      spiritModeRef.current = mode;
                    }}
                  />
                </div>

                {/* ===== 对话内容层 ===== */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {messages.length === 0 && (
                    <>
                      <div className="px-2 pt-2 pb-1">
                        <ChatInput
                          onSendMessage={handleSendMessage}
                          onStopTask={handleStopTask}
                          onGenerateImage={showImageGeneration ? handleOpenImageModal : undefined}
                          disabled={!inputEnabled || isHistoricalSession}
                          showStopButton={showStopButton}
                          setContent={setter => {
                            setInputTextRef.current = setter;
                          }}
                          isDarkMode={isDarkMode}
                          historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                          onReplay={handleReplay}
                          onExecuteSkill={handleExecuteSkill}
                          onExecuteWorkflow={handleExecuteWorkflow}
                        />
                      </div>
                      <div className="flex-1 overflow-y-auto px-2 pb-2">
                        <BookmarkList
                          bookmarks={favoritePrompts}
                          onBookmarkSelect={handleBookmarkSelect}
                          onBookmarkUpdateTitle={handleBookmarkUpdateTitle}
                          onBookmarkDelete={handleBookmarkDelete}
                          onBookmarkReorder={handleBookmarkReorder}
                          isDarkMode={isDarkMode}
                        />
                      </div>
                    </>
                  )}
                  {messages.length > 0 && (
                    <>
                      <div className="scrollbar-gutter-stable flex-1 space-y-1 overflow-x-hidden overflow-y-scroll scroll-smooth px-3 py-2">
                        <MessageList messages={messages} isDarkMode={isDarkMode} />
                        <div ref={messagesEndRef} />
                      </div>
                      <div className="px-2 pb-2 pt-1">
                        <ChatInput
                          onSendMessage={handleSendMessage}
                          onStopTask={handleStopTask}
                          onGenerateImage={showImageGeneration ? handleOpenImageModal : undefined}
                          disabled={!inputEnabled || isHistoricalSession}
                          showStopButton={showStopButton}
                          setContent={setter => {
                            setInputTextRef.current = setter;
                          }}
                          isDarkMode={isDarkMode}
                          historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                          onReplay={handleReplay}
                          onExecuteSkill={handleExecuteSkill}
                          onExecuteWorkflow={handleExecuteWorkflow}
                        />
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* 图片生成模态框 */}
      <ImageGenerationModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        onGenerate={handleGenerateImage}
        isGenerating={isGeneratingImage}
        generatedImage={generatedImageBase64}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};

export default SidePanel;
