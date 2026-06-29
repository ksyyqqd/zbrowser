/**
 * 元素拾取 UI 卡片
 *
 * 配合 useElementPicker hook 使用。给三个弹窗（ClarifyDialog/MarkElementDialog/TeachingDialog）
 * 提供统一的"拾取按钮 + picking 状态 + picked 结果 + 错误"展示。
 *
 * 样式复用 SidePanel 的 CSS 变量（玉绿/宣纸主题），明暗模式自动跟随。
 */

import { FiTarget } from 'react-icons/fi';
import type { PickerState } from '@src/hooks/useElementPicker';

export interface PickerCardProps {
  state: PickerState;
  onPick: () => void;
  onReset: () => void;
  /** 自定义标题；不传用默认「在页面上手动指给 AI」 */
  title?: string;
  /** 自定义按钮文案 */
  buttonLabel?: string;
  /** 拾取被禁用（如 hostname 无效）时传 true */
  disabled?: boolean;
  /** 紧凑模式：减小内边距和文字（用于 TeachingDialog 列表底部） */
  compact?: boolean;
}

export function PickerCard({
  state,
  onPick,
  onReset,
  title = '在页面上手动指给 AI',
  buttonLabel = '🎯 在页面上拾取元素',
  disabled = false,
  compact = false,
}: PickerCardProps) {
  return (
    <div
      className={`rounded-lg border ${compact ? 'p-2' : 'p-3'}`}
      style={{ background: 'var(--accent-glow)', borderColor: 'var(--spirit-border)' }}>
      {title && (
        <div className="mb-2 flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          <FiTarget size={12} />
          <span>{title}</span>
        </div>
      )}
      {state.phase === 'idle' && (
        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className={`jade-btn ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} disabled:opacity-50`}>
          {buttonLabel}
        </button>
      )}
      {state.phase === 'picking' && (
        <p className={compact ? 'text-xs' : 'text-sm'} style={{ color: 'var(--text-muted)' }}>
          拾取中… 在页面上点击目标元素，Esc 取消
        </p>
      )}
      {state.phase === 'picked' && (
        <div className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {state.selector && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>selector:</span>{' '}
              <code className="break-all">{state.selector}</code>
            </div>
          )}
          {state.xpath && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>xpath:</span>{' '}
              <code className="break-all">{state.xpath}</code>
            </div>
          )}
          {state.text && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>text:</span> <span className="break-all">{state.text}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              onReset();
              onPick();
            }}
            className="mt-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-[var(--bg-card-hover)]"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            重新拾取
          </button>
        </div>
      )}
      {state.phase === 'error' && (
        <div className={compact ? 'text-xs' : 'text-sm'} style={{ color: '#dc2626' }}>
          拾取失败：{state.message}
          <button type="button" onClick={onReset} className="ml-2 underline hover:opacity-80">
            重试
          </button>
        </div>
      )}
    </div>
  );
}
