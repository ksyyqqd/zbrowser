/**
 * 「修改下一步」弹窗
 *
 * 用户在 TaskProgressBar 点了「修改下一步」时，SidePanel 先 pause 任务再挂这个弹窗。
 * 用户输入文本 + 提交 → SidePanel 发 port amend_next_step → resume 任务；
 * 取消 → 直接 resume，不注入文本。
 *
 * 不复用 ClarifyDialog（那个强耦合 ask_user 的 port 路由）；这里一次性单文本输入足矣。
 */

import { useEffect, useRef, useState } from 'react';
import { FiX } from 'react-icons/fi';

interface AmendNextStepDialogProps {
  /** 用户点「提交」时回调：text 已 trim 过 */
  onSubmit: (text: string) => void;
  /** 用户点「取消」或 ESC */
  onCancel: () => void;
}

export function AmendNextStepDialog({ onSubmit, onCancel }: AmendNextStepDialogProps) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 打开后自动聚焦输入框
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter 快速提交；Esc 取消
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-3"
      role="dialog"
      aria-modal="true"
      aria-label="修改下一步">
      <button
        type="button"
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: 'rgba(15,14,12,0.5)' }}
        aria-label="关闭"
        onClick={onCancel}
      />
      <div
        className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl border"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-color)',
          boxShadow: 'var(--shadow-lg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}>
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--border-color)' }}>
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent-color)' }}>
            📝 修改下一步
          </span>
          <button type="button" onClick={onCancel} className="icon-btn" aria-label="关闭">
            <FiX size={16} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            告诉皮蛋接下来该怎么做：
          </p>
          <textarea
            ref={taRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              '例如：\n- 先把弹出广告关掉再继续\n- 换用另一种方式（点链接而不是按钮）\n- 直接打开 https://… 而不是从首页找'
            }
            className="jade-input min-h-[100px] w-full resize-y px-3 py-2 text-sm"
            maxLength={500}
          />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            提交后任务从下一轮重新规划。Ctrl/⌘ + Enter 快速提交。
          </p>
        </div>

        <div
          className="flex items-center justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border-color)' }}>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border px-3 py-1.5 text-sm transition-all hover:bg-[var(--bg-card-hover)]"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            取消
          </button>
          <button type="button" onClick={handleSubmit} disabled={!text.trim()} className="jade-btn px-4 py-1.5 text-sm">
            提交并继续
          </button>
        </div>
      </div>
    </div>
  );
}
