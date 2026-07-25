/**
 * 任务失败诊断弹窗
 *
 * 触发：TASK_FAIL_DIAGNOSIS 事件到达 SidePanel 时挂载（也就是 TASK_FAIL 之后那一帧）。
 * 内容：LLM 一句话原因 + 3 条修复建议 + 重试 / 关闭 两个动作。
 *
 * 故意不在每次失败都挂——只有 LLM 真的产出了诊断才出现，否则消息流里的红色 STEP_FAIL
 * 已经够用了。
 */

import { FiX, FiCheck, FiRefreshCw, FiAlertOctagon } from 'react-icons/fi';
import type { TaskFailDiagnosis } from '@extension/shared';

interface FailDiagnosisDialogProps {
  diagnosis: TaskFailDiagnosis;
  /** 用户点「重试」：父级把原 task 重发一次 new_task */
  onRetry: () => void;
  onClose: () => void;
}

export function FailDiagnosisDialog({ diagnosis, onRetry, onClose }: FailDiagnosisDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-3"
      role="dialog"
      aria-modal="true"
      aria-label="任务失败诊断">
      <button
        type="button"
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: 'rgba(15,14,12,0.5)' }}
        aria-label="关闭"
        onClick={onClose}
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
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>
            <FiAlertOctagon size={11} />
            任务失败
          </span>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="关闭">
            <FiX size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {/* 一句话原因 */}
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              原因
            </p>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {diagnosis.summary}
            </p>
          </div>

          {/* 修复建议 */}
          {diagnosis.suggestions.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                修复建议
              </p>
              <ul className="space-y-1.5">
                {diagnosis.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                    <FiCheck className="mt-0.5 shrink-0" size={13} style={{ color: 'var(--accent-color)' }} />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border-color)' }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm transition-all hover:bg-[var(--bg-card-hover)]"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            关闭
          </button>
          <button type="button" onClick={onRetry} className="jade-btn flex items-center gap-1 px-4 py-1.5 text-sm">
            <FiRefreshCw size={12} />
            重试任务
          </button>
        </div>
      </div>
    </div>
  );
}
