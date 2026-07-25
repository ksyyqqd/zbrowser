/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from 'react';
import { FaTrash, FaChevronLeft, FaPlay, FaRedo } from 'react-icons/fa';
import { BsBookmark } from 'react-icons/bs';
import { t } from '@extension/i18n';
import type { Message } from '@extension/storage';
import MessageList from './MessageList';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  source?: 'user' | 'ball';
}

interface ChatMessage {
  id?: string;
  actor: string;
  content: string;
  timestamp: number;
}

interface ChatHistoryListProps {
  sessions: ChatSession[];
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionBookmark: (sessionId: string) => void;
  /** 已收藏的会话ID集合（用于显示收藏/取消收藏状态） */
  bookmarkedSessionIds?: Set<string>;
  /** 触发重播（action 序列回放） */
  onReplay?: (sessionId: string) => void;
  /** 触发重跑（拿原始任务文本重新让 LLM 决策） */
  onRerunTask?: (sessionId: string) => void;
  visible: boolean;
  isDarkMode?: boolean;
}

// Tab 配置
const TABS = [
  { key: 'user' as const, label: '主人的对话', icon: '\u{1F4AC}' }, // 💬
  { key: 'ball' as const, label: '皮蛋的行动', icon: '\u{1F43E}' }, // 🐾
] as const;

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  bookmarkedSessionIds,
  onReplay,
  onRerunTask,
  visible,
  isDarkMode = false,
}) => {
  const [activeTab, setActiveTab] = useState<'user' | 'ball'>('user');
  // 详情模式：选中某条历史后，在面板内展示完整消息
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [detailMessages, setDetailMessages] = useState<ChatMessage[]>([]);
  // 缓存 store 引用，避免每次动态 import
  const storeRef = useRef<{ getSession: (id: string) => Promise<{ messages: ChatMessage[] } | null> } | null>(null);

  // 组件挂载时预加载 storage 模块
  useEffect(() => {
    import('@extension/storage')
      .then(mod => {
        storeRef.current = mod.chatHistoryStore;
      })
      .catch(() => {
        storeRef.current = null;
      });
  }, []);

  if (!visible) return null;

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  // 当前 Tab 的会话列表（按时间倒序）
  const currentItems = sessions.filter(s => s.source === activeTab).sort((a, b) => b.createdAt - a.createdAt);

  // 各 Tab 的数量
  const userCount = sessions.filter(s => s.source === 'user').length;
  const ballCount = sessions.filter(s => s.source === 'ball').length;
  const totalSessions = sessions.length;

  /** 进入详情：加载会话消息（使用缓存的 store） */
  const handleEnterDetail = async (sessionId: string) => {
    setDetailSessionId(sessionId);
    try {
      let store = storeRef.current;
      if (!store) {
        const mod = await import('@extension/storage');
        store = mod.chatHistoryStore;
        storeRef.current = store;
      }

      if (!store) {
        console.warn('[ChatHistoryList] chatHistoryStore 不可用');
        setDetailMessages([]);
        return;
      }

      console.log('[ChatHistoryList] 加载详情 sessionId:', sessionId);
      const fullSession = await store.getSession(sessionId);
      console.log('[ChatHistoryList] 加载结果:', fullSession ? `${fullSession.messages.length} 条消息` : null);
      setDetailMessages(fullSession?.messages || []);
    } catch (err) {
      console.error('[ChatHistoryList] 加载会话详情失败:', err);
      setDetailMessages([]);
    }
  };

  /** 返回列表 */
  const handleBackToList = () => {
    setDetailSessionId(null);
    setDetailMessages([]);
  };

  // ====== 详情视图 ======
  if (detailSessionId) {
    const session = sessions.find(s => s.id === detailSessionId);
    return (
      <div className="flex h-full flex-col">
        {/* 详情头部 */}
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border-color)' }}>
          <button
            type="button"
            onClick={handleBackToList}
            className="icon-btn shrink-0"
            style={{ color: 'var(--accent-color)' }}
            aria-label="返回列表">
            <FaChevronLeft size={14} />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {session?.title || '历史会话'}
            </h3>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {session ? formatDate(session.createdAt) : ''}
              {session?.source === 'ball' && <span className="ml-1">🐾</span>}
            </p>
          </div>
          {/* 操作按钮 — 收藏/取消收藏切换（仅图标） */}
          <button
            type="button"
            onClick={() => {
              onSessionBookmark(detailSessionId);
            }}
            className="icon-btn flex items-center justify-center transition-all duration-200"
            style={{
              color: bookmarkedSessionIds?.has(detailSessionId) ? '#FFF' : isDarkMode ? '#D4A017' : '#B8860B',
              background: bookmarkedSessionIds?.has(detailSessionId)
                ? 'linear-gradient(135deg, #F59E0B, #D97706)'
                : undefined,
              boxShadow: bookmarkedSessionIds?.has(detailSessionId) ? '0 2px 8px rgba(245,158,11,0.35)' : undefined,
            }}
            aria-label="收藏">
            <BsBookmark
              size={13}
              fill={bookmarkedSessionIds?.has(detailSessionId) ? '#FFF' : isDarkMode ? '#D4A017' : '#B8860B'}
            />
          </button>
          <button
            type="button"
            onClick={() => {
              onSessionDelete(detailSessionId);
              handleBackToList();
            }}
            className="icon-btn !text-red-400"
            aria-label="删除">
            <FaTrash size={12} />
          </button>
        </div>

        {/* 消息列表 — 复用聊天面板的 MessageList 样式 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {detailMessages.length === 0 ? (
            <div className="empty-state py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              该会话暂无消息内容
            </div>
          ) : (
            <MessageList messages={detailMessages as Message[]} isDarkMode={isDarkMode} disableStepFiltering />
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="border-t px-4 py-2.5" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex gap-2">
            {/* 主操作：以此为上下文继续对话 */}
            <button
              type="button"
              onClick={() => {
                onSessionSelect(detailSessionId);
                handleBackToList();
              }}
              className="jade-btn flex-1 py-2 text-center text-xs font-medium tracking-wide">
              继续对话 ↗
            </button>
            {/* 重播 — 按动作序列回放，仅用户会话显示 */}
            {onReplay && session?.source === 'user' && (
              <button
                type="button"
                onClick={async () => {
                  await onReplay(detailSessionId);
                  handleBackToList();
                }}
                className="flex items-center rounded-lg px-3 py-2 text-xs font-medium tracking-wide transition-all duration-200"
                style={{
                  color: '#0EA5E9',
                  background: isDarkMode ? 'rgba(14,165,233,0.15)' : 'rgba(14,165,233,0.10)',
                  border: '1px solid rgba(14,165,233,0.25)',
                }}
                title="按上次的动作序列回放">
                <FaRedo size={11} />
                <span className="ml-1">重播</span>
              </button>
            )}
            {/* 重跑 — 拿原始任务文本让 LLM 重新决策，仅用户会话显示 */}
            {onRerunTask && session?.source === 'user' && (
              <button
                type="button"
                onClick={async () => {
                  await onRerunTask(detailSessionId);
                  handleBackToList();
                }}
                className="flex items-center rounded-lg px-3 py-2 text-xs font-medium tracking-wide transition-all duration-200"
                style={{
                  color: '#40916C',
                  background: isDarkMode ? 'rgba(64,145,108,0.15)' : 'rgba(64,145,108,0.10)',
                  border: '1px solid rgba(64,145,108,0.25)',
                }}
                title="用原始任务让 AI 重新执行">
                <FaPlay size={10} />
                <span className="ml-1">重跑</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ====== 列表视图 ======
  return (
    <div className="flex h-full flex-col p-4">
      {/* 标题 */}
      <h2 className="mb-4 text-base font-bold tracking-wide" style={{ color: `var(--text-primary)` }}>
        {t('chat_history_title')}
        <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
          ({totalSessions})
        </span>
      </h2>

      {/* ===== Tab 切换栏 ===== */}
      <div
        className="mb-3 flex rounded-lg p-0.5"
        style={{
          background: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
          border: '1px solid var(--border-color)',
        }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          const count = tab.key === 'user' ? userCount : ballCount;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${
                isActive ? 'shadow-sm' : ''
              }`}
              style={{
                color: isActive
                  ? tab.key === 'user'
                    ? isDarkMode
                      ? '#74C69D'
                      : '#40916C'
                    : isDarkMode
                      ? '#F59E0B'
                      : '#D97706'
                  : 'var(--text-muted)',
                background: isActive
                  ? isDarkMode
                    ? tab.key === 'user'
                      ? 'rgba(116,198,157,0.15)'
                      : 'rgba(245,158,11,0.15)'
                    : tab.key === 'user'
                      ? 'rgba(64,145,108,0.10)'
                      : 'rgba(217,119,6,0.10)'
                  : 'transparent',
              }}>
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px]"
                style={{
                  background: isActive ? (isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : undefined,
                  opacity: count > 0 ? 1 : 0.35,
                }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 会话列表区域 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {currentItems.length === 0 ? (
          <div className="empty-state py-12 text-center text-sm">{t('chat_history_empty')}</div>
        ) : (
          <div className="space-y-1.5 pb-4">
            {currentItems.map((session, idx) => {
              return (
                <div
                  key={session.id}
                  className={`history-item group ${activeTab === 'ball' ? 'history-item-ball' : ''}`}
                  style={{ animationDelay: `${idx * 50}ms` }}>
                  <button
                    onClick={() => handleEnterDetail(session.id)}
                    className="relative z-10 w-full cursor-pointer text-left"
                    type="button">
                    <div className="flex items-center gap-2">
                      {/* 皮蛋来源的小标记 */}
                      {activeTab === 'ball' && (
                        <span className="shrink-0 text-sm" title="皮蛋发起">
                          🐾
                        </span>
                      )}
                      <h3 className="truncate pr-14 text-sm font-medium" style={{ color: `var(--text-primary)` }}>
                        {session.title}
                      </h3>
                    </div>
                    <p
                      className="mt-1 flex items-center gap-1.5 text-xs tracking-wide"
                      style={{ color: `var(--text-muted)` }}>
                      <span
                        className="size-1 rounded-full"
                        style={{ background: `var(--accent-color)`, opacity: 0.35 }}
                      />
                      {formatDate(session.createdAt)}
                    </p>
                  </button>
                  {/* ===== 操作按钮区域（不拦截点击穿透） ===== */}
                  {/* 收藏/取消收藏 — 仅图标变化 */}
                  {onSessionBookmark &&
                    (() => {
                      const isBookmarked = bookmarkedSessionIds?.has(session.id) ?? false;
                      return (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            onSessionBookmark(session.id);
                          }}
                          className="absolute right-9 top-2.5 z-20 flex size-6 items-center justify-center rounded-full transition-all duration-200"
                          style={{
                            color: isBookmarked ? '#FFF' : isDarkMode ? '#D4A017' : '#B8860B',
                            background: isBookmarked ? 'linear-gradient(135deg, #F59E0B, #D97706)' : undefined,
                            boxShadow: isBookmarked ? '0 2px 8px rgba(245,158,11,0.35)' : undefined,
                          }}
                          aria-label={isBookmarked ? '取消收藏' : '收藏'}
                          type="button">
                          <BsBookmark size={11} fill={isBookmarked ? '#FFF' : isDarkMode ? '#D4A017' : '#B8860B'} />
                        </button>
                      );
                    })()}
                  {/* 删除 */}
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onSessionDelete(session.id);
                    }}
                    className="icon-btn absolute right-2.5 top-3 z-20 !text-red-400/70 hover:!text-red-500"
                    aria-label={t('chat_history_delete')}
                    type="button">
                    <FaTrash size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHistoryList;
