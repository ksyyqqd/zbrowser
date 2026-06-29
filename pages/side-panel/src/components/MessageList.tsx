import type { Message } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo, useState } from 'react';
import { FiCopy, FiCheck, FiChevronDown, FiChevronRight, FiDownload, FiX, FiZoomIn } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { MarkdownRenderer, MessageExportButton, MessageContentExportButton } from '@extension/ui';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
  /** 禁用执行步骤的过滤/折叠/最新预览，全部消息平铺展示（如历史详情视图） */
  disableStepFiltering?: boolean;
}

// 判断消息是否为"执行步骤"类消息（默认隐藏）
// Navigator / Planner / Validator / User 的消息全部隐藏，只保留关键回复
// System 消息：只有带流程前缀（⏳✓✗▶❌✅🔀）的折叠，其他独立展示（如 output 节点输出）
function isExecutionStepMessage(msg: Message): boolean {
  // 进度消息
  if (msg.content === 'Showing progress...') return true;
  // Navigator / Planner / Validator 的所有消息全部隐藏
  if (msg.actor === 'navigator' || msg.actor === 'planner' || msg.actor === 'validator') return true;
  // 用户发言默认折叠
  if (msg.actor === 'user') return true;
  // System 消息：带执行流程前缀的折叠，其余保留（如 output 节点的最终输出）
  if (msg.actor === 'system') {
    const prefixes = ['⏳', '✓', '✗', '▶', '❌', '✅', '🔀'];
    return prefixes.some(p => msg.content.startsWith(p));
  }
  return false;
}

export default memo(function MessageList({
  messages,
  isDarkMode = false,
  disableStepFiltering = false,
}: MessageListProps) {
  const [showSteps, setShowSteps] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ base64: string; name?: string } | null>(null);

  // 分离关键消息和执行步骤（disableStepFiltering 时全部消息当作非步骤平铺）
  const keyMessages = disableStepFiltering ? messages : messages.filter(m => !isExecutionStepMessage(m));
  const stepMessages = disableStepFiltering ? [] : messages.filter(m => isExecutionStepMessage(m));
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
            isDarkMode ? 'text-[#95D5B2] hover:bg-white/5' : 'text-[#78716C] hover:bg-black/[0.03]'
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
      {!showSteps && latestStepMsg && (
        <LatestStepPreview message={latestStepMsg} isDarkMode={isDarkMode} onImagePreview={setPreviewImage} />
      )}

      {displayMessages.map((message, index) => (
        <MessageBlock
          key={`${message.actor}-${message.timestamp}-${index}`}
          message={message}
          isSameActor={index > 0 && displayMessages[index - 1].actor === message.actor}
          isDarkMode={isDarkMode}
          isStep={isExecutionStepMessage(message)}
          onImagePreview={setPreviewImage}
        />
      ))}

      {/* Image Preview Modal */}
      {previewImage && (
        <ImagePreviewModal image={previewImage} isDarkMode={isDarkMode} onClose={() => setPreviewImage(null)} />
      )}
    </div>
  );
});

interface MessageBlockProps {
  message: Message;
  isSameActor: boolean;
  isDarkMode?: boolean;
  isStep?: boolean;
  onImagePreview?: (img: { base64: string; name?: string }) => void;
}

// 折叠状态下的最新消息预览 — 显示完整内容
function LatestStepPreview({
  message,
  isDarkMode = false,
  onImagePreview,
}: {
  message: Message;
  isDarkMode?: boolean;
  onImagePreview?: (img: { base64: string; name?: string }) => void;
}) {
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const [copied, setCopied] = useState(false);
  const isProgress = message.content === 'Showing progress...';

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="group flex items-start gap-2.5 rounded-lg px-3 py-2 text-xs transition-all duration-200 cursor-pointer hover:bg-[var(--bg-card-hover)]"
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
        style={{
          borderColor: isDarkMode ? 'rgba(116,198,157,0.25)' : 'rgba(139,115,85,0.3)',
          background: (actor as any).iconBackground || '#6B7280',
        }}>
        <img src={actor.icon} alt={actor.name} className="size-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between">
          <span className="font-medium shrink-0" style={{ color: 'var(--text-muted)' }}>
            {actor.name}
          </span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <MessageContentExportButton content={message.content} isDarkMode={isDarkMode} />
            <MessageExportButton content={message.content} isDarkMode={isDarkMode} />
            <button
              onClick={handleCopy}
              className={`rounded-md p-1 transition-all duration-200 ${copied ? '!text-green-500' : ''}`}
              style={copied ? undefined : { color: isDarkMode ? '#95D5B2' : '#78716C' }}
              title={copied ? t('chat_copied') : t('chat_copy')}
              type="button"
              aria-label={t('chat_copy')}>
              {copied ? <FiCheck size={11} /> : <FiCopy size={11} />}
            </button>
          </div>
        </div>
        {/* Render images if present */}
        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {message.images.map((img, idx) => (
              <div
                key={`${message.timestamp}-${idx}`}
                className="relative group/img cursor-pointer"
                onDoubleClick={() => onImagePreview?.(img)}>
                <img
                  src={`data:image/png;base64,${img.base64}`}
                  alt={img.name || `Image ${idx + 1}`}
                  className="max-w-[120px] max-h-[80px] object-cover rounded hover:opacity-90 transition-opacity"
                  loading="lazy"
                />
                <FiZoomIn className="absolute inset-0 m-auto h-4 w-4 opacity-0 group-hover/img:opacity-100 transition-opacity text-white drop-shadow-lg" />
              </div>
            ))}
          </div>
        )}
        {/* 内容区：思考中（progress 占位）显示三点动画，其它正常渲染 */}
        {isProgress ? (
          <div
            className="mt-0.5 flex items-center gap-1.5 leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
            aria-label="thinking">
            <span>{actor.name} 正在思考</span>
            <span className="inline-flex gap-0.5">
              <span
                className="inline-block size-1 animate-bounce rounded-full"
                style={{ background: 'currentColor', animationDelay: '0ms' }}
              />
              <span
                className="inline-block size-1 animate-bounce rounded-full"
                style={{ background: 'currentColor', animationDelay: '150ms' }}
              />
              <span
                className="inline-block size-1 animate-bounce rounded-full"
                style={{ background: 'currentColor', animationDelay: '300ms' }}
              />
            </span>
          </div>
        ) : (
          <MarkdownRenderer content={message.content} isDarkMode={isDarkMode} className="leading-relaxed" />
        )}
      </div>
    </div>
  );
}

function MessageBlock({ message, isSameActor, isDarkMode = false, isStep = false, onImagePreview }: MessageBlockProps) {
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
      {/* 角色头像 - 圆形小头像 */}
      {!isSameActor && (
        <div
          className="shrink-0 size-8 rounded-full overflow-hidden ring-1"
          style={{
            borderColor: isDarkMode ? 'rgba(116,198,157,0.25)' : 'rgba(139,115,85,0.3)',
            background: (actor as any).iconBackground || '#6B7280',
          }}>
          <img src={actor.icon} alt={actor.name} className="size-full object-cover" />
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
          {/* Render images if present */}
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.images.map((img, idx) => (
                <div
                  key={`${message.timestamp}-${idx}`}
                  className={`relative group/img rounded-lg overflow-hidden cursor-pointer ${
                    isDarkMode ? 'bg-slate-800' : 'bg-gray-100'
                  }`}
                  onDoubleClick={() => onImagePreview?.(img)}>
                  <img
                    src={`data:image/png;base64,${img.base64}`}
                    alt={img.name || `Image ${idx + 1}`}
                    className="max-w-full max-h-[300px] object-contain rounded-lg hover:opacity-90 transition-opacity"
                    loading="lazy"
                  />
                  {/* Zoom icon overlay */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
                    <FiZoomIn className="h-6 w-6 text-white drop-shadow-lg" />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = `data:image/png;base64,${img.base64}`;
                      link.download = img.name || `image-${Date.now()}.png`;
                      link.click();
                    }}
                    className={`absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover/img:opacity-100 transition-opacity ${
                      isDarkMode
                        ? 'bg-slate-600 hover:bg-slate-500 text-gray-300'
                        : 'bg-white hover:bg-gray-100 text-gray-700'
                    }`}
                    title={t('chat_download')}>
                    <FiDownload className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="relative">
            {isProgress ? (
              <div className="message-scroll text-sm">
                <div className="progress-bar-jade my-2 overflow-hidden">
                  <div className="progress-fill" style={{ width: '60%' }} />
                </div>
              </div>
            ) : (
              <div className="message-scroll text-sm" style={{ color: `var(--text-secondary)` }}>
                <MarkdownRenderer content={message.content} isDarkMode={isDarkMode} />
              </div>
            )}
            {/* 右侧操作按钮组 */}
            {!isProgress && (
              <div className="absolute right-1 top-2 flex items-center gap-1">
                <MessageContentExportButton content={message.content} isDarkMode={isDarkMode} />
                <MessageExportButton content={message.content} isDarkMode={isDarkMode} />
                <button
                  onClick={copyToClipboard}
                  className={`icon-btn rounded-md p-1.5 transition-all duration-200 ${copied ? '!text-green-500' : ''}`}
                  style={copied ? undefined : { color: isDarkMode ? '#95D5B2' : '#78716C' }}
                  title={copied ? t('chat_copied') : t('chat_copy')}>
                  {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
                </button>
              </div>
            )}
          </div>
          {/* 时间戳 */}
          {!isProgress && (
            <div
              className="text-right text-xs tracking-wide"
              style={{ color: isDarkMode ? '#78716C' : '#A8A29E', opacity: 0.85 }}>
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

/**
 * Image Preview Modal - full size image display
 */
function ImagePreviewModal({
  image,
  isDarkMode,
  onClose,
}: {
  image: { base64: string; name?: string };
  isDarkMode?: boolean;
  onClose: () => void;
}) {
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${image.base64}`;
    link.download = image.name || `image-${Date.now()}.png`;
    link.click();
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      onClick={onClose}
      onKeyDown={e => e.key === 'Escape' && onClose()}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 ${isDarkMode ? 'bg-black/80' : 'bg-black/60'} backdrop-blur-sm`}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className={`absolute -top-10 right-0 p-2 rounded-lg transition-colors ${
            isDarkMode ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-white hover:bg-gray-100 text-gray-700'
          }`}
          title={t('options_models_providers_btnCancel')}>
          <FiX className="h-5 w-5" />
        </button>

        {/* Image */}
        <img
          src={`data:image/png;base64,${image.base64}`}
          alt={image.name || 'Preview'}
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
        />

        {/* Download button */}
        <button
          type="button"
          onClick={handleDownload}
          className={`absolute bottom-2 right-2 p-2 rounded-lg transition-colors ${
            isDarkMode ? 'bg-slate-700 hover:bg-slate-600 text-gray-300' : 'bg-white hover:bg-gray-100 text-gray-700'
          }`}
          title={t('chat_download')}>
          <FiDownload className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
