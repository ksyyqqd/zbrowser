/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from 'react';
import { FaTrash, FaChevronLeft, FaPlus, FaRedo } from 'react-icons/fa';
import { BsBookmark } from 'react-icons/bs';
import { t } from '@extension/i18n';

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
  /** 用历史会话的第一条用户消息内容填充输入框 */
  onFillInputFromHistory?: (content: string) => void;
  /** 触发重播 */
  onReplay?: (sessionId: string) => void;
  visible: boolean;
  isDarkMode?: boolean;
}

// Tab 配置
const TABS = [
  { key: 'user' as const, label: '主人的对话', icon: '\u{1F4AC}' }, // 💬
  { key: 'ball' as const, label: '球球的行动', icon: '\u{1F43E}' }, // 🐾
] as const;

const ACTORS: Record<string, { label: string; color: string }> = {
  system: { label: '系统', color: '#8B5CF6' },
  user: { label: '用户', color: '#40916C' },
  planner: { label: '规划师', color: '#0EA5E9' },
  navigator: { label: '导航员', color: '#F59E0B' },
  validator: { label: '验证员', color: '#EC4899' },
};

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  bookmarkedSessionIds,
  onFillInputFromHistory,
  onReplay,
  visible,
  isDarkMode = false,
}) => {
  if (!visible) return null;

  const [activeTab, setActiveTab] = useState<'user' | 'ball'>('user');
  // 详情模式：选中某条历史后，在面板内展示完整消息
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);
  const [detailMessages, setDetailMessages] = useState<ChatMessage[]>([]);
  // 缓存 store 引用，避免每次动态 import
  const storeRef = useRef<any>(null);
  const [storeReady, setStoreReady] = useState(false);

  // 组件挂载时预加载 storage 模块
  useEffect(() => {
    import('@extension/storage')
      .then(mod => {
        storeRef.current = mod.chatHistoryStore;
        setStoreReady(true);
      })
      .catch(() => {
        setStoreReady(false);
      });
  }, []);

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

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
        setStoreReady(true);
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
            style={{ color: bookmarkedSessionIds?.has(detailSessionId) ? 'var(--gold-color)' : 'var(--gold-color)' }}
            aria-label="收藏">
            <BsBookmark size={13} fill={bookmarkedSessionIds?.has(detailSessionId) ? 'currentColor' : undefined} />
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

        {/* 消息列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {detailMessages.length === 0 ? (
            <div className="empty-state py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              该会话暂无消息内容
            </div>
          ) : (
            detailMessages.map((msg, idx) => {
              const actorInfo = ACTORS[msg.actor] || { label: msg.actor, color: 'var(--text-muted)' };
              return (
                <div
                  key={msg.id || idx}
                  className="rounded-lg px-3 py-2"
                  style={{
                    background: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                    borderLeft: `3px solid ${actorInfo.color}`,
                  }}>
                  <div className="mb-0.5 flex items-center gap-2">
                    <span
                      className="inline-block rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: actorInfo.color, background: `${actorInfo.color}15` }}>
                      {actorInfo.label}
                    </span>
                    <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <p
                    className="text-xs leading-relaxed whitespace-pre-wrap break-words"
                    style={{ color: 'var(--text-primary)' }}>
                    {msg.content || '\u00A0'}
                  </p>
                </div>
              );
            })
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
              className="jade-btn flex-1 py-2 text-xs font-medium tracking-wide text-center">
              继续对话 ↗
            </button>
            {/* 重播 — 仅用户会话显示 */}
            {onReplay && session?.source === 'user' && (
              <button
                type="button"
                onClick={async () => {
                  // 先执行重播（异步），完成后切回聊天页
                  await onReplay(detailSessionId);
                  // 重播已创建新会话并设置 sessionIdRef，用 select 切到聊天视图
                  onSessionSelect(detailSessionId);
                }}
                className="px-3 py-2 rounded-lg text-xs font-medium tracking-wide transition-all duration-200"
                style={{
                  color: '#0EA5E9',
                  background: isDarkMode ? 'rgba(14,165,233,0.15)' : 'rgba(14,165,233,0.10)',
                  border: '1px solid rgba(14,165,233,0.25)',
                }}
                title="重播此任务">
                <FaRedo size={12} />
                <span className="ml-1">重播</span>
              </button>
            )}
            {/* 填充输入框 — 仅用户会话显示 */}
            {onFillInputFromHistory && session?.source === 'user' && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const store = storeRef.current || (await import('@extension/storage')).chatHistoryStore;
                    if (!store) return;
                    const full = await store.getSession(detailSessionId);
                    if (full?.messages) {
                      const firstUserMsg = full.messages.find((m: ChatMessage) => m.actor === 'user');
                      if (firstUserMsg?.content) {
                        onFillInputFromHistory(firstUserMsg.content);
                        handleBackToList();
                      }
                    }
                  } catch {
                    /* ignore */
                  }
                }}
                className="px-3 py-2 rounded-lg text-xs font-medium tracking-wide transition-all duration-200"
                style={{
                  color: '#40916C',
                  background: isDarkMode ? 'rgba(64,145,108,0.15)' : 'rgba(64,145,108,0.10)',
                  border: '1px solid rgba(64,145,108,0.25)',
                }}
                title="将任务命令填入对话框">
                <FaPlus size={11} />
                <span className="ml-1">填入</span>
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
          <div className="empty-state py-12 text-sm text-center">{t('chat_history_empty')}</div>
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
                    className="relative z-10 w-full text-left cursor-pointer"
                    type="button">
                    <div className="flex items-center gap-2">
                      {/* 球球来源的小标记 */}
                      {activeTab === 'ball' && (
                        <span className="shrink-0 text-sm" title="球球发起">
                          🐾
                        </span>
                      )}
                      <h3 className="truncate text-sm font-medium pr-14" style={{ color: `var(--text-primary)` }}>
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
                          className="absolute right-9 top-2.5 z-20 flex items-center justify-center size-6 rounded-full transition-all duration-200"
                          style={{
                            color: isBookmarked ? '#FFF' : 'var(--gold-color)',
                            background: isBookmarked ? 'linear-gradient(135deg, #F59E0B, #D97706)' : undefined,
                            boxShadow: isBookmarked ? '0 2px 8px rgba(245,158,11,0.35)' : undefined,
                          }}
                          aria-label={isBookmarked ? '取消收藏' : '收藏'}
                          type="button">
                          <BsBookmark size={11} fill={isBookmarked ? '#FFF' : undefined} />
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
