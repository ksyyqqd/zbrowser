/* eslint-disable react/prop-types */
import { FaTrash } from 'react-icons/fa';
import { BsBookmark } from 'react-icons/bs';
import { t } from '@extension/i18n';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
}

interface ChatHistoryListProps {
  sessions: ChatSession[];
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionBookmark: (sessionId: string) => void;
  visible: boolean;
  isDarkMode?: boolean;
}

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  visible,
  isDarkMode = false,
}) => {
  if (!visible) return null;

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className={`mb-5 text-base font-bold tracking-wide ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
        {t('chat_history_title')}
      </h2>
      {sessions.length === 0 ? (
        <div className="empty-state text-sm">
          <p>{t('chat_history_empty')}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sessions.map((session, index) => (
            <div key={session.id} className={`history-item group`} style={{ animationDelay: `${index * 60}ms` }}>
              <button
                onClick={() => onSessionSelect(session.id)}
                className="relative z-10 w-full text-left"
                type="button">
                <h3
                  className={`text-sm font-medium tracking-wide truncate pr-16 ${
                    isDarkMode ? 'text-gray-200' : 'text-gray-800'
                  }`}>
                  {session.title}
                </h3>
                <p
                  className={`mt-1.5 flex items-center gap-1.5 text-xs tracking-wide ${
                    isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                  <span className={`size-1 rounded-full ${isDarkMode ? 'bg-cyber-primary/40' : 'bg-neon-sky/30'}`} />
                  {formatDate(session.createdAt)}
                </p>
              </button>

              {/* Bookmark button */}
              {onSessionBookmark && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onSessionBookmark(session.id);
                  }}
                  className={`icon-btn absolute right-9 top-3.5 opacity-0 transition-all duration-200 group-hover:opacity-100 z-10 ${
                    isDarkMode ? '!text-cyber-primary' : '!text-neon-sky'
                  }`}
                  aria-label={t('chat_history_bookmark')}
                  type="button">
                  <BsBookmark size={13} />
                </button>
              )}

              {/* Delete button */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  onSessionDelete(session.id);
                }}
                className={`icon-btn absolute right-2.5 top-3.5 opacity-0 transition-all duration-200 group-hover:opacity-100 z-10`}
                aria-label={t('chat_history_delete')}
                type="button">
                <FaTrash size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatHistoryList;
