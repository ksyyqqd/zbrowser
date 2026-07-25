/**
 * 任务执行进度条 + 控制按钮（跳过 / 修改下一步）
 *
 * 仅当任务执行中（showStopButton === true）且收到过 STEP_START 事件（taskProgress 非空）
 * 才挂载。位置：消息列表上方、ChatInput 之上。
 *
 * 数据源：handleTaskState 从 event.data.step / maxSteps 解出 taskProgress state。
 * 这两个字段在 EventData 里一直存在，只是之前前端没用。
 */

import { FiSkipForward, FiEdit2 } from 'react-icons/fi';

interface TaskProgressBarProps {
  step: number;
  maxSteps: number;
  /** 用户点「跳过此步」 */
  onSkip: () => void;
  /** 用户点「修改下一步」（SidePanel 会先 pause 再弹 AmendNextStepDialog） */
  onAmend: () => void;
  /** 任务是否被暂停（按了「修改下一步」时为 true，按钮置灰避免重复点） */
  isPaused?: boolean;
}

export function TaskProgressBar({ step, maxSteps, onSkip, onAmend, isPaused = false }: TaskProgressBarProps) {
  // 1-indexed 显示，最多 100%
  const pct = maxSteps > 0 ? Math.min(100, Math.max(0, ((step - 1) / maxSteps) * 100)) : 0;
  return (
    <div
      className="flex items-center gap-2 border-b px-3 py-1.5"
      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-surface)' }}>
      {/* 进度条 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>
            {isPaused ? '已暂停' : '执行中'} · 步骤 {step} / {maxSteps}
          </span>
          <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {Math.round(pct)}%
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-secondary)' }}>
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${pct}%`,
              background: isPaused ? 'var(--gold-color)' : 'var(--accent-color)',
            }}
          />
        </div>
      </div>
      {/* 操作 */}
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={onSkip}
          disabled={isPaused}
          title="跳过当前步（下一轮直接进入新步骤）"
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors hover:bg-[var(--bg-card-hover)] disabled:opacity-40"
          style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          <FiSkipForward size={11} />
          跳过
        </button>
        <button
          type="button"
          onClick={onAmend}
          disabled={isPaused}
          title="修改下一步：暂停任务，告诉 AI 接下来该怎么做"
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors hover:bg-[var(--bg-card-hover)] disabled:opacity-40"
          style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          <FiEdit2 size={11} />
          修改
        </button>
      </div>
    </div>
  );
}
