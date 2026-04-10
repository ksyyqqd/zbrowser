/* eslint-disable @typescript-eslint/no-explicit-any */
// 导入React相关Hook函数
import { useState, useEffect, useCallback, useRef } from 'react';
// 导入UI图标组件
import { FiSettings } from 'react-icons/fi';
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
// 导入子组件
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import ChatHistoryList from './components/ChatHistoryList';
import BookmarkList from './components/BookmarkList';
import SpiritDoll from './components/SpiritDoll';
// 导入事件类型和执行状态
import { EventType, type AgentEvent, ExecutionState } from './types/event';
// 导入样式表
import './SidePanel.css';

// 声明Chrome API类型
declare global {
  interface Window {
    chrome: typeof chrome;
    __spirit_overlay__:
      | {
          showFireworksShow?: (duration?: number) => void;
          writeText?: (text: string) => void;
          celebrate?: (msg?: string) => void;
          destroy?: () => void;
          isActive?: () => boolean;
        }
      | undefined;
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
  // 是否已配置模型（null=加载中，false=无模型，true=有模型）
  const [hasConfiguredModels, setHasConfiguredModels] = useState<boolean | null>(null);
  // 是否正在录音
  const [isRecording, setIsRecording] = useState(false);
  // 是否正在处理语音
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  // 是否正在重播
  const [isReplaying, setIsReplaying] = useState(false);
  // 快速入门步骤展开状态
  const [showSteps, setShowSteps] = useState(false);
  // 是否启用重播功能
  const [replayEnabled, setReplayEnabled] = useState(false);
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
  // 媒体录制器引用
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // 音频片段引用
  const audioChunksRef = useRef<Blob[]>([]);
  // 录音计时器引用
  const recordingTimerRef = useRef<number | null>(null);

  // 检查暗色模式偏好
  useEffect(() => {
    // 获取系统暗色模式设置
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(darkModeMediaQuery.matches);

    // 监听暗色模式变化
    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    darkModeMediaQuery.addEventListener('change', handleChange);
    // 清理事件监听器
    return () => darkModeMediaQuery.removeEventListener('change', handleChange);
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
  }, []);

  // 加载通用设置以检查是否启用了重播功能
  const loadGeneralSettings = useCallback(async () => {
    try {
      const settings = await generalSettingsStore.getSettings();
      setReplayEnabled(settings.replayHistoricalTasks);
    } catch (error) {
      console.error('加载通用设置时出错:', error);
      setReplayEnabled(false);
    }
  }, []);

  // 在挂载时检查模型配置
  useEffect(() => {
    checkModelConfiguration();
    loadGeneralSettings();
  }, [checkModelConfiguration, loadGeneralSettings]);

  // 当侧面板再次变为可见时重新检查模型配置
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // 面板变为可见，重新检查配置和设置
        checkModelConfiguration();
        loadGeneralSettings();
      }
    };

    const handleFocus = () => {
      // 面板获得焦点，重新检查配置和设置
      checkModelConfiguration();
      loadGeneralSettings();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkModelConfiguration, loadGeneralSettings]);

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
              // 重置历史会话标志
              setIsHistoricalSession(false);
              break;
            case ExecutionState.TASK_OK:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              break;
            case ExecutionState.TASK_FAIL:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              setCurrentStep(null); // 任务完成，重置步骤
              skip = false;
              break;
            case ExecutionState.TASK_CANCEL:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              setCurrentStep(null); // 任务取消，重置步骤
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
    [appendMessage],
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
        } else if (message && message.type === 'error') {
          // 处理来自服务工作者的错误消息
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('errors_unknown'),
            timestamp: Date.now(),
          });
          setInputEnabled(true);
          setShowStopButton(false);
        } else if (message && message.type === 'speech_to_text_result') {
          // 处理语音转文字结果
          if (message.text && setInputTextRef.current) {
            setInputTextRef.current(message.text);
          }
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'speech_to_text_error') {
          // 处理语音转文字错误
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('chat_stt_recognitionFailed'),
            timestamp: Date.now(),
          });
          setIsProcessingSpeech(false);
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
  }, [handleTaskState, appendMessage, stopConnection]);

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
    try {
      // 检查设置中是否启用了重播
      if (!replayEnabled) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_disabled'),
          timestamp: Date.now(),
        });
        return;
      }

      // 检查历史记录是否存在，使用loadAgentStepHistory
      const historyData = await chatHistoryStore.loadAgentStepHistory(historySessionId);
      if (!historyData) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_noHistory', historySessionId.substring(0, 20)),
          timestamp: Date.now(),
        });
        return;
      }

      // 获取当前标签页ID
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('未找到活动标签页');
      }

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

      // 如果不存在则设置连接
      if (!portRef.current) {
        setupConnection();
      }

      // 发送重播命令到后台，附带历史任务
      portRef.current?.postMessage({
        type: 'replay',
        taskId: newTaskId,
        tabId: tabId,
        historySessionId: historySessionId,
        task: historyData.task, // 添加来自历史的任务
      });

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

  // 处理发送消息
  const handleSendMessage = async (text: string, displayText?: string) => {
    console.log('handleSendMessage', text);

    // 首先修剪输入文本
    const trimmedText = text.trim();

    if (!trimmedText) return;

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
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('未找到活动标签页');
      }

      setInputEnabled(false);
      setShowStopButton(true);

      // 如果不在跟进模式下，则为该任务创建新的聊天会话
      if (!isFollowUpMode) {
        // 如有显示文本则使用它作为会话标题，否则使用完整文本
        const titleText = displayText || text;
        const newSession = await chatHistoryStore.createSession(
          titleText.substring(0, 50) + (titleText.length > 50 ? '...' : ''),
        );
        console.log('新会话', newSession);

        // 在状态和引用中存储会话ID
        const sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
      }

      const userMessage = {
        actor: Actors.USER,
        content: displayText || text, // 在聊天UI中使用显示文本，后台服务使用完整文本
        timestamp: Date.now(),
      };

      // 将sessionId直接传递给appendMessage
      appendMessage(userMessage, sessionIdRef.current);

      // 如果不存在则设置连接
      if (!portRef.current) {
        setupConnection();
      }

      // 使用实用函数发送消息
      if (isFollowUpMode) {
        // 作为跟进任务发送
        await sendMessage({
          type: 'follow_up_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('跟进任务已发送', text, tabId, sessionIdRef.current);
      } else {
        // 作为新任务发送
        await sendMessage({
          type: 'new_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('新任务已发送', text, tabId, sessionIdRef.current);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('任务错误', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
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

  // 处理会话收藏
  const handleSessionBookmark = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);

      if (fullSession && fullSession.messages.length > 0) {
        // 获取会话标题
        const sessionTitle = fullSession.title;
        // 获取标题的前8个单词
        const title = sessionTitle.split(' ').slice(0, 8).join(' ');

        // 获取第一条消息内容（任务）
        const taskContent = fullSession.messages[0]?.content || '';

        // 添加到收藏存储
        await favoritesStorage.addPrompt(title, taskContent);

        // 在UI中更新收藏
        const prompts = await favoritesStorage.getAllPrompts();
        setFavoritePrompts(prompts);

        // 更新后返回聊天视图
        handleBackToChat(true);
      }
    } catch (error) {
      console.error('收藏会话到收藏夹失败:', error);
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

  // 清理卸载时
  useEffect(() => {
    return () => {
      // 如果正在录音则停止
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // 清除录音计时器
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      stopConnection();
    };
  }, [stopConnection]);

  // 当新消息到达时滚动到底部
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 处理麦克风点击
  const handleMicClick = async () => {
    if (isRecording) {
      // 停止录音
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // 清除计时器
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    try {
      // 首先检查权限是否已授予
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });

      if (permissionStatus.state === 'denied') {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_stt_microphone_permissionDenied'),
          timestamp: Date.now(),
        });
        return;
      }

      // 如果权限未授予，则打开权限页面
      if (permissionStatus.state !== 'granted') {
        const permissionUrl = chrome.runtime.getURL('permission/index.html');

        // 在新窗口中打开权限页面
        chrome.windows.create(
          {
            url: permissionUrl,
            type: 'popup',
            width: 500,
            height: 600,
          },
          createdWindow => {
            if (createdWindow?.id) {
              // 监听窗口关闭以检查权限状态
              chrome.windows.onRemoved.addListener(function onWindowClose(windowId) {
                if (windowId === createdWindow.id) {
                  chrome.windows.onRemoved.removeListener(onWindowClose);
                  // 窗口关闭后检查权限状态
                  setTimeout(async () => {
                    try {
                      const newPermissionStatus = await navigator.permissions.query({
                        name: 'microphone' as PermissionName,
                      });
                      // 仅在权限被授予时重试
                      if (newPermissionStatus.state === 'granted') {
                        handleMicClick();
                      }
                      // 如果被拒绝或提示，则让用户手动重试
                    } catch (error) {
                      console.error('检查权限状态失败:', error);
                    }
                  }, 500);
                }
              });
            }
          },
        );
        return;
      }

      // 权限已授予 - 继续录音
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 清除之前的音频片段
      audioChunksRef.current = [];

      // 创建MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      // 处理数据可用事件
      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // 处理停止事件
      mediaRecorder.onstop = async () => {
        // 停止所有轨道以释放麦克风
        stream.getTracks().forEach(track => track.stop());

        if (audioChunksRef.current.length > 0) {
          // 创建音频Blob
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

          // 将Blob转换为base64
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Audio = reader.result as string;

            // 如果不存在则设置连接
            if (!portRef.current) {
              setupConnection();
            }

            // 发送音频到后端进行语音转文字转换
            try {
              setIsProcessingSpeech(true);
              portRef.current?.postMessage({
                type: 'speech_to_text',
                audio: base64Audio,
              });
            } catch (error) {
              console.error('发送音频进行语音转文字失败:', error);
              appendMessage({
                actor: Actors.SYSTEM,
                content: t('chat_stt_processingFailed'),
                timestamp: Date.now(),
              });
              setIsRecording(false);
              setIsProcessingSpeech(false);
            }
          };
          reader.readAsDataURL(audioBlob);
        }
      };

      // 设置2分钟时长限制
      const maxDuration = 2 * 60 * 1000;
      recordingTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        setIsProcessingSpeech(true);
        recordingTimerRef.current = null;
      }, maxDuration);

      // 开始录音
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('访问麦克风失败:', error);

      let errorMessage = t('chat_stt_microphone_accessFailed');
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage += t('chat_stt_microphone_grantPermission');
        } else if (error.name === 'NotFoundError') {
          errorMessage += t('chat_stt_microphone_notFound');
        } else {
          errorMessage += error.message;
        }
      }

      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setIsRecording(false);
    }
  };

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
              <img src="/icon-128.png" alt="Extension Logo" className="size-6" />
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
              visible={true}
              isDarkMode={isDarkMode}
            />
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
                          // 确保连接存在
                          if (!portRef.current) setupConnection();

                          // 先创建一个真实的会话，获取有效的 sessionId
                          const mischiefSession = await chatHistoryStore.createSession('球球捣乱中...', 'ball');
                          const mischiefTaskId = mischiefSession.id;

                          // 用真实 sessionId 发起独立捣乱任务
                          await sendMessage({
                            type: 'new_task',
                            task: '[球球捣乱] 请在当前页面上做一些轻微的、无伤大雅的小动作：比如随机滚动一下页面、鼠标悬停在某些按钮上假装要点击、如果页面有输入框就删除里面的一两个字符再补回来、轻微改变一下滚动位置等。操作要轻量有趣，不要造成任何实质性的破坏或数据丢失。',
                            taskId: mischiefTaskId,
                            tabId,
                          });
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
                          onMicClick={handleMicClick}
                          isRecording={isRecording}
                          isProcessingSpeech={isProcessingSpeech}
                          disabled={!inputEnabled || isHistoricalSession}
                          showStopButton={showStopButton}
                          setContent={setter => {
                            setInputTextRef.current = setter;
                          }}
                          isDarkMode={isDarkMode}
                          historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                          onReplay={handleReplay}
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
                          onMicClick={handleMicClick}
                          isRecording={isRecording}
                          isProcessingSpeech={isProcessingSpeech}
                          disabled={!inputEnabled || isHistoricalSession}
                          showStopButton={showStopButton}
                          setContent={setter => {
                            setInputTextRef.current = setter;
                          }}
                          isDarkMode={isDarkMode}
                          historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                          onReplay={handleReplay}
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
    </div>
  );
};

export default SidePanel;
