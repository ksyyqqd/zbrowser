/* eslint-disable react/prop-types */
import { FaTrash } from 'react-icons/fa';
import { BsBookmark } from 'react-icons/bs';
import { t } from '@extension/i18n';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  source?: 'user' | 'ball'; // 新增：会话来源
}

interface ChatHistoryListProps {
  sessions: ChatSession[];
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionBookmark: (sessionId: string) => void;
  visible: boolean;
  isDarkMode?: boolean;
}

// 来源分组配置
const SOURCE_GROUPS = [
  { key: 'user' as const, label: '主人的对话', icon: '\u{1F4AC}' }, // 💬
  { key: 'ball' as const, label: '球球的行动', icon: '\u{1F43E}' }, // 🐾
] as const;

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  visible,
  isDarkMode = false,
}) => {
  if (!visible) return null;

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  // 按来源分组，每组内按时间倒序排列
  const grouped = SOURCE_GROUPS.map(group => ({
    ...group,
    items: sessions.filter(s => s.source === group.key).sort((a, b) => b.createdAt - a.createdAt),
  }));

  const totalSessions = sessions.length;

  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="mb-5 text-base font-bold tracking-wide" style={{ color: `var(--text-primary)` }}>
        {t('chat_history_title')}
        <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
          ({totalSessions})
        </span>
      </h2>

      {totalSessions === 0 ? (
        <div className="empty-state text-sm">{t('chat_history_empty')}</div>
      ) : (
        <div className="space-y-5">
          {grouped
            .filter(g => g.items.length > 0)
            .map(group => (
              // ===== 分组区块 =====
              <div key={group.key}>
                {/* 分组标题 */}
                <div className="mb-2 flex items-center gap-1.5 px-1">
                  <span>{group.icon}</span>
                  <span
                    className="text-[11px] font-semibold tracking-wider uppercase"
                    style={{
                      color:
                        group.key === 'user'
                          ? isDarkMode
                            ? '#74C69D'
                            : '#40916C'
                          : isDarkMode
                            ? '#F59E0B'
                            : '#D97706',
                    }}>
                    {group.label}
                  </span>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px]"
                    style={{
                      background:
                        group.key === 'user'
                          ? isDarkMode
                            ? 'rgba(116,198,157,0.12)'
                            : 'rgba(64,145,108,0.08)'
                          : isDarkMode
                            ? 'rgba(245,158,11,0.12)'
                            : 'rgba(217,119,6,0.08)',
                      color:
                        group.key === 'user'
                          ? isDarkMode
                            ? '#74C69D'
                            : '#40916C'
                          : isDarkMode
                            ? '#F59E0B'
                            : '#D97706',
                    }}>
                    {group.items.length}
                  </span>
                </div>

                {/* 分组下的会话列表 */}
                <div className="space-y-1.5">
                  {group.items.map((session, idx) => (
                    <div
                      key={session.id}
                      className={`history-item group ${group.key === 'ball' ? 'history-item-ball' : ''}`}
                      style={{ animationDelay: `${idx * 50}ms` }}>
                      <button
                        onClick={() => onSessionSelect(session.id)}
                        className="relative z-10 w-full text-left"
                        type="button">
                        <div className="flex items-center gap-2">
                          {/* 球球来源的小标记 */}
                          {group.key === 'ball' && (
                            <span className="shrink-0 text-sm" title="球球发起">
                              🐾
                            </span>
                          )}
                          <h3 className="text-sm font-medium truncate pr-14" style={{ color: `var(--text-primary)` }}>
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
                      {onSessionBookmark && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            onSessionBookmark(session.id);
                          }}
                          className="icon-btn absolute right-8 top-3 opacity-0 group-hover:opacity-100 z-10"
                          style={{ color: `var(--gold-color)` }}
                          aria-label={t('chat_history_bookmark')}
                          type="button">
                          <BsBookmark size={12} />
                        </button>
                      )}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onSessionDelete(session.id);
                        }}
                        className="icon-btn absolute right-2.5 top-3 opacity-0 group-hover:opacity-100 z-10"
                        aria-label={t('chat_history_delete')}
                        type="button">
                        <FaTrash size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default ChatHistoryList;
