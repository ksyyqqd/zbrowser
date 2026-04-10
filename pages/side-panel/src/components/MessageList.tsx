import type { Message } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo, useState } from 'react';
import { FiCopy, FiCheck, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { t } from '@extension/i18n';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
}

// 判断消息是否为"执行步骤"类消息（默认隐藏）
// Navigator / Planner / Validator / User / System 的消息全部隐藏，只保留关键回复
function isExecutionStepMessage(msg: Message): boolean {
  // 进度消息
  if (msg.content === 'Showing progress...') return true;
  // Navigator / Planner / Validator 的所有消息全部隐藏
  if (msg.actor === 'navigator' || msg.actor === 'planner' || msg.actor === 'validator') return true;
  // 用户发言和系统提示也默认折叠
  if (msg.actor === 'user' || msg.actor === 'system') return true;
  return false;
}

export default memo(function MessageList({ messages, isDarkMode = false }: MessageListProps) {
  const [showSteps, setShowSteps] = useState(false);

  // 分离关键消息和执行步骤
  const keyMessages = messages.filter(m => !isExecutionStepMessage(m));
  const stepMessages = messages.filter(m => isExecutionStepMessage(m));
  // 最新一条折叠消息（用于在折叠状态下展示）
  const latestStepMsg = stepMessages.length > 0 ? stepMessages[stepMessages.length - 1] : null;
  const displayMessages = showSteps ? messages : keyMessages;

  return (
    <div className="max-w-full space-y-3">
      {/* 执行步骤展开/收起控制 */}
      {stepMessages.length > 0 && (
        <button
          onClick={() => setShowSteps(!showSteps)}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all duration-200 ${
            isDarkMode ? 'text-gray-400 hover:bg-white/5' : 'text-gray-500 hover:bg-black/[0.03]'
          }`}
          type="button">
          {showSteps ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
          <span>{showSteps ? '收起' : '展开'}执行过程</span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px]"
            style={{
              background: isDarkMode ? 'rgba(116,198,157,0.15)' : 'rgba(64,145,108,0.1)',
              color: isDarkMode ? '#74C69D' : '#40916C',
            }}>
            {stepMessages.length}
          </span>
        </button>
      )}

      {/* 折叠状态下显示最新一条消息 */}
      {!showSteps && latestStepMsg && <LatestStepPreview message={latestStepMsg} isDarkMode={isDarkMode} />}

      {displayMessages.map((message, index) => (
        <MessageBlock
          key={`${message.actor}-${message.timestamp}-${index}`}
          message={message}
          isSameActor={index > 0 && displayMessages[index - 1].actor === message.actor}
          isDarkMode={isDarkMode}
          isStep={isExecutionStepMessage(message)}
        />
      ))}
    </div>
  );
});

interface MessageBlockProps {
  message: Message;
  isSameActor: boolean;
  isDarkMode?: boolean;
  isStep?: boolean;
}

// 折叠状态下的最新消息预览
function LatestStepPreview({ message }: { message: Message }) {
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  // 截断过长内容
  const preview = message.content.length > 80 ? message.content.slice(0, 80) + '...' : message.content;

  return (
    <div
      className="flex items-start gap-2.5 rounded-lg px-3 py-2 text-xs transition-all duration-200 cursor-pointer hover:bg-[var(--bg-card-hover)]"
      style={{
        background: 'var(--bg-card)',
        border: '1px dashed var(--border-color)',
      }}
      role="button"
      tabIndex={0}
      onClick={() => {
        /* 点击展开由父级按钮处理 */
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click();
      }}>
      {/* 小头像 */}
      <div
        className="shrink-0 size-6 rounded-full overflow-hidden ring-1"
        style={{ borderColor: 'var(--border-color)', opacity: 0.7 }}>
        <img src={actor.icon} alt={actor.name} className="size-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="font-medium shrink-0" style={{ color: 'var(--text-muted)' }}>
            {actor.name}
          </span>
          <span className="truncate" style={{ color: 'var(--text-secondary)', opacity: 0.8 }}>
            {preview}
          </span>
        </div>
      </div>
    </div>
  );
}

function MessageBlock({ message, isSameActor, isDarkMode = false, isStep = false }: MessageBlockProps) {
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
          ? `mt-4 pt-4 first:mt-0 first:pt-0 ${
              isDarkMode ? 'border-t border-jade-border/30' : 'border-t border-jade/10'
            }`
          : ''
      } ${isStep ? 'opacity-70' : ''}`}>
      {/* 角色头像 - 灵珠光环 */}
      {!isSameActor && (
        <div className="spirit-ring shrink-0">
          <img src={actor.icon} alt={actor.name} />
        </div>
      )}
      {isSameActor && <div className="w-8" />}

      <div className="min-w-0 flex-1">
        {/* 角色名称 */}
        {!isSameActor && (
          <div
            className="mb-1.5 flex items-center gap-2 text-sm font-semibold tracking-wide"
            style={{ color: `var(--text-primary)` }}>
            <span>{actor.name}</span>
            {isStep && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-normal"
                style={{
                  background: isDarkMode ? 'rgba(217,119,6,0.12)' : 'rgba(217,119,6,0.08)',
                  color: isDarkMode ? '#F59E0B' : '#D97706',
                }}>
                执行中
              </span>
            )}
            {!isStep && (
              <span className="size-1.5 rounded-full" style={{ background: 'var(--accent-color)', opacity: 0.5 }} />
            )}
          </div>
        )}

        <div className="space-y-1">
          <div className="relative">
            <div
              className="message-scroll whitespace-pre-wrap break-words text-sm pr-12"
              style={{ color: `var(--text-secondary)` }}>
              {isProgress ? (
                <div className="progress-bar-jade my-2 overflow-hidden">
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
                  copied ? '!text-green-500' : ''
                }`}
                title={copied ? t('chat_copied') : t('chat_copy')}>
                {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
              </button>
            )}
          </div>
          {/* 时间戳 */}
          {!isProgress && (
            <div className="text-right text-xs tracking-wide" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
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
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) return timeStr;
  if (isYesterday) return `Yesterday, ${timeStr}`;
  if (isThisYear) return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  return `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ${timeStr}`;
}
