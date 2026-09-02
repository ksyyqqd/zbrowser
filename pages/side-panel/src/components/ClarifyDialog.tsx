/**
 * 用户澄清弹窗 (ask_user)
 *
 * 当 Agent 在执行中调用 ask_user action（Navigator）或 Planner 在 plan 中输出 ask_user 时，
 * background 会广播 ExecutionState.ASK_USER 事件，SidePanel 解析 payload 后挂载本组件。
 *
 * 交互：
 * - 单选若干 options（如有）
 * - 自由文本（如 allowFreeText）
 * - 拾取元素（如 allowElementPick）—— 调 background 'pick_element_start' 复用已有 picker overlay
 * - 提交 / 取消 / 终止任务 → 三个 ClarifyResponse 形态
 *
 * 提交期间若 background ack 失败（任务已结束 / service worker 重启），显示 toast 自关。
 *
 * 样式：复用侧边栏「宣纸 + 玉质」设计系统的 CSS 变量与现成类（.jade-input / .jade-btn /
 * .icon-btn / 全局 code 样式）。本组件渲染在 SidePanel 的 .dark 包裹层内，故明暗模式由
 * CSS 变量自动跟随，无需 isDarkMode 分支。
 */

import { useEffect, useState } from 'react';
import { FiX, FiAlertTriangle, FiCheck } from 'react-icons/fi';
import type { AskUserPayload, ClarifyResponse } from '@extension/shared';
import { useElementPicker } from '@src/hooks/useElementPicker';
import { PickerCard } from './PickerCard';

interface ClarifyDialogProps {
  payload: AskUserPayload;
  port: chrome.runtime.Port | null;
  /** 父级清空 pendingClarify 的回调（提交或取消后调用） */
  onClose: () => void;
}

export function ClarifyDialog({ payload, port, onClose }: ClarifyDialogProps) {
  const [choiceId, setChoiceId] = useState<string | undefined>(undefined);
  const [text, setText] = useState('');
  // payload.pickTabId 可能没有，picker hook 会自动 fallback 到 active tab
  const picker = useElementPicker(payload.pickTabId ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  // background 用 port 回 'clarify_ack'；本组件直接订阅 port message，找匹配 requestId
  useEffect(() => {
    if (!port) return;
    const handler = (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as { type?: string; requestId?: string; ok?: boolean };
      if (m.type !== 'clarify_ack' || m.requestId !== payload.requestId) return;
      setSubmitting(false);
      if (m.ok) {
        onClose();
      } else {
        setAckError('任务已结束，回答未送达。');
        // 短暂展示后自关
        setTimeout(onClose, 1800);
      }
    };
    port.onMessage.addListener(handler);
    return () => port.onMessage.removeListener(handler);
  }, [port, payload.requestId, onClose]);

  const send = (response: Omit<ClarifyResponse, 'requestId'>) => {
    if (!port) {
      setAckError('与后台连接已断开');
      setTimeout(onClose, 1800);
      return;
    }
    setSubmitting(true);
    port.postMessage({
      type: 'clarify_response',
      requestId: payload.requestId,
      response: { ...response, requestId: payload.requestId },
    });
    // ack 处理在上面的 onMessage handler 里完成
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    const ps = picker.state;
    send({
      choiceId,
      text: trimmed || undefined,
      pickedSelector: ps.phase === 'picked' ? ps.selector : undefined,
      pickedStableSelector: ps.phase === 'picked' ? ps.stableSelector : undefined,
      pickedXpath: ps.phase === 'picked' ? ps.xpath : undefined,
      pickedText: ps.phase === 'picked' ? ps.text : undefined,
      pickedDisabled: ps.phase === 'picked' ? ps.evidence?.disabled : undefined,
    });
  };

  const canSubmit = !submitting && (!!choiceId || !!text.trim() || picker.state.phase === 'picked');

  const sourceBadge = payload.source === 'planner' ? '📋 规划师' : '🧭 导航员';

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-3"
      role="dialog"
      aria-modal="true"
      aria-label="用户澄清">
      {/* 半透明遮罩，点击不可关闭 —— 防止误关导致 Agent 一直 pause */}
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'rgba(15,14,12,0.5)' }} aria-hidden />
      <div
        className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-color)',
          boxShadow: 'var(--shadow-lg)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}>
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--border-color)' }}>
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ background: 'var(--accent-glow)', color: 'var(--accent-color)' }}>
            {sourceBadge} · 请澄清
          </span>
          <button
            type="button"
            onClick={() => send({ cancelled: true })}
            disabled={submitting}
            className="icon-btn"
            title="取消（让 Agent 自行决定下一步）"
            aria-label="取消">
            <FiX size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-4 py-4">
          <div>
            <p className="text-base font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
              {payload.question}
            </p>
            {payload.context && (
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {payload.context}
              </p>
            )}
          </div>

          {/* Options */}
          {payload.options && payload.options.length > 0 && (
            <div className="space-y-2">
              {payload.options.map(opt => {
                const active = choiceId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setChoiceId(opt.id)}
                    className="flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all duration-200"
                    style={{
                      background: active ? 'var(--accent-glow)' : 'var(--bg-surface)',
                      borderColor: active ? 'var(--accent-color)' : 'var(--border-color)',
                      boxShadow: active ? '0 0 14px var(--spirit-aura)' : 'none',
                    }}>
                    <span
                      className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors"
                      style={{
                        borderColor: active ? 'var(--accent-color)' : 'var(--border-color)',
                        background: active ? 'var(--accent-color)' : 'transparent',
                      }}>
                      {active && <FiCheck size={10} className="text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-muted)' }}>
                          {opt.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Free text */}
          {payload.allowFreeText !== false && (
            <div>
              <label className="mb-1 block text-xs" style={{ color: 'var(--text-muted)' }} htmlFor="clarify-text">
                {payload.options && payload.options.length > 0 ? '或自由输入：' : '请输入你的回答：'}
              </label>
              <textarea
                id="clarify-text"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="也可以直接输入回答…"
                className="jade-input min-h-[64px] w-full resize-y px-3 py-2 text-sm"
              />
            </div>
          )}

          {/* Element picker */}
          {payload.allowElementPick && (
            <PickerCard state={picker.state} onPick={() => picker.pick()} onReset={picker.reset} />
          )}

          {ackError && (
            <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--gold-color)' }}>
              <FiAlertTriangle size={12} />
              <span>{ackError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border-color)' }}>
          <button
            type="button"
            onClick={() => send({ abortTask: true })}
            disabled={submitting}
            className="text-xs font-medium transition-colors hover:underline disabled:opacity-40"
            style={{ color: '#dc2626' }}
            title="放弃整个任务">
            终止任务
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => send({ cancelled: true })}
              disabled={submitting}
              className="rounded-md border px-3 py-1.5 text-sm transition-all duration-200 hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
              取消
            </button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="jade-btn px-4 py-1.5 text-sm">
              {submitting ? '发送中…' : '提交'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
