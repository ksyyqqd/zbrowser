import type { Message } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo, useState } from 'react';
import { FiCopy, FiCheck } from 'react-icons/fi';
import { t } from '@extension/i18n';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
}

export default memo(function MessageList({ messages, isDarkMode = false }: MessageListProps) {
  return (
    <div className="max-w-full space-y-4">
      {messages.map((message, index) => (
        <MessageBlock
          key={`${message.actor}-${message.timestamp}-${index}`}
          message={message}
          isSameActor={index > 0 ? messages[index - 1].actor === message.actor : false}
          isDarkMode={isDarkMode}
        />
      ))}
    </div>
  );
});

interface MessageBlockProps {
  message: Message;
  isSameActor: boolean;
  isDarkMode?: boolean;
}

function MessageBlock({ message, isSameActor, isDarkMode = false }: MessageBlockProps) {
  const [copied, setCopied] = useState(false);
  if (!message.actor) {
    console.error('No actor found');
    return <div />;
  }
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const isProgress = message.content === 'Showing progress...';

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div
      className={`flex max-w-full gap-3 ${
        !isSameActor
          ? `mt-5 pt-5 first:mt-0 first:pt-0 ${
              isDarkMode ? 'border-t border-cyber-border/30' : 'border-t border-neon-sky/10'
            }`
          : ''
      }`}>
      {/* 角色头像 - 科幻发光环 */}
      {!isSameActor && (
        <div className={`avatar-ring shrink-0 ${!isDarkMode ? 'shadow-cyber-sm-light' : ''}`}>
          <img src={actor.icon} alt={actor.name} />
        </div>
      )}
      {isSameActor && <div className="w-8" />}

      <div className="min-w-0 flex-1">
        {/* 角色名称 */}
        {!isSameActor && (
          <div
            className={`mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide ${
              isDarkMode ? 'text-gray-100' : 'text-gray-800'
            }`}>
            <span>{actor.name}</span>
            <span
              className={`size-1.5 rounded-full ${isDarkMode ? 'bg-cyber-primary/60 animate-[cyber-pulse_2s_ease-in-out_infinite]' : 'bg-neon-sky/50'}`}
            />
          </div>
        )}

        <div className="space-y-1">
          <div className="relative">
            <div
              className={`message-bubble whitespace-pre-wrap break-words text-sm pr-12 ${
                isDarkMode ? 'text-gray-300' : 'text-gray-600'
              }`}>
              {isProgress ? (
                <div className="progress-bar-cyber my-2 overflow-hidden">
                  <div className="progress-fill" style={{ width: '60%' }} />
                </div>
              ) : (
                message.content
              )}
            </div>
            {/* 复制按钮 */}
            {!isProgress && (
              <button
                onClick={copyToClipboard}
                className={`icon-btn absolute right-1 top-2 rounded-md p-1.5 transition-all duration-200 ${
                  copied
                    ? isDarkMode
                      ? 'text-green-400'
                      : 'text-green-500'
                    : isDarkMode
                      ? 'text-gray-500 hover:text-gray-200'
                      : 'text-gray-400 hover:text-gray-700'
                }`}
                title={copied ? t('chat_copied') : t('chat_copy')}>
                {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
              </button>
            )}
          </div>
          {/* 时间戳 */}
          {!isProgress && (
            <div className={`text-right text-xs tracking-wide ${isDarkMode ? 'text-gray-500/70' : 'text-gray-300'}`}>
              {formatTimestamp(message.timestamp)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Formats a timestamp (in milliseconds) to a readable time string
 * @param timestamp Unix timestamp in milliseconds
 * @returns Formatted time string
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  // Check if the message is from today
  const isToday = date.toDateString() === now.toDateString();

  // Check if the message is from yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  // Check if the message is from this year
  const isThisYear = date.getFullYear() === now.getFullYear();

  // Format the time (HH:MM)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr; // Just show the time for today's messages
  }

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  if (isThisYear) {
    // Show month and day for this year
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  // Show full date for older messages
  return `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ${timeStr}`;
}
