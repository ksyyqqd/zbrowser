/**
 * 手动元素标记弹窗
 *
 * 用户主动从 SidePanel 顶栏入口打开，用于在 Agent 没主动问的情况下，
 * 把当前活动 tab 上的某个元素**预先**告诉皮蛋，存进元素事实库（elementHintsStore）。
 * 下次 Agent 在这个 hostname 操作时，state message 会自动注入这条 hint，
 * confidence 提到 0.9+，不再弹窗问。
 *
 * 流程：
 *   1) 弹窗打开时自动读取当前 active tab → 显示 hostname
 *   2) 点「在页面上拾取元素」→ 复用 background 的 pick_element_start runtime msg → 拿 selector/xpath/text
 *   3) 用户填 purpose（如「提交按钮」）
 *   4) 保存 → 直调 elementHintsStore.addHint，source: 'user_pick'
 *
 * 跟 ClarifyDialog 不复用是因为后者强耦合 ask_user 的 port 路由（requestId / clarify_ack），
 * 拆出来反而更复杂。两个文件视觉风格保持一致（同套 CSS 变量）。
 */

import { useEffect, useState } from 'react';
import { FiX, FiAlertTriangle, FiCheck } from 'react-icons/fi';
import { elementHintsStore, getHostnameFromUrl } from '@extension/storage';
import { useElementPicker } from '@src/hooks/useElementPicker';
import { PickerCard } from './PickerCard';

interface MarkElementDialogProps {
  /** 父级关闭回调（保存 / 取消 / Esc 都触发） */
  onClose: () => void;
}

export function MarkElementDialog({ onClose }: MarkElementDialogProps) {
  const [hostname, setHostname] = useState<string>('');
  const [tabId, setTabId] = useState<number | null>(null);
  const [purpose, setPurpose] = useState('');
  const picker = useElementPicker(tabId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 打开时自动读当前 active tab 的 hostname
  useEffect(() => {
    (async () => {
      try {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (active?.id) setTabId(active.id);
        setHostname(getHostnameFromUrl(active?.url));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // 拾取后自动用拾到的 text 作为 purpose 默认值（用户可改）
  const handlePick = async () => {
    await picker.pick();
    // pick 完成后 picker.state 会在下次 render 更新；我们用 ref 取最新值
  };
  // 监听 picker 状态 → 拾到了就预填 purpose
  useEffect(() => {
    if (picker.state.phase === 'picked' && !purpose.trim() && picker.state.text) {
      setPurpose(picker.state.text.trim().slice(0, 20));
    }
    // 仅在拾取完成时填一次，避免之后用户改 purpose 又被覆盖
  }, [picker.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!hostname) {
      setError('当前页面没有 hostname（chrome:// 或本地文件页面无法记录）');
      return;
    }
    if (picker.state.phase !== 'picked' || (!picker.state.selector && !picker.state.xpath)) {
      setError('请先拾取一个页面元素');
      return;
    }
    if (!purpose.trim()) {
      setError('请填写"用途描述"，让 AI 知道这个元素是干嘛的');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await elementHintsStore.addHint(hostname, {
        purpose: purpose.trim(),
        selector: picker.state.selector,
        xpath: picker.state.xpath,
        textContent: picker.state.text,
        source: 'user_pick',
      });
      setSaved(true);
      // 短暂展示"已保存"反馈后关闭
      setTimeout(onClose, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && !saved && picker.state.phase === 'picked' && !!purpose.trim() && !!hostname;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-3"
      role="dialog"
      aria-modal="true"
      aria-label="标记页面元素">
      <button
        type="button"
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: 'rgba(15,14,12,0.5)' }}
        aria-label="关闭"
        onClick={onClose}
      />
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
            🧠 标记元素到记忆
          </span>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="关闭">
            <FiX size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-4 py-4">
          <div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              告诉皮蛋当前网站上的某个元素是干什么用的。下次 AI 操作这个网站时会优先按这个记忆来选元素。
            </p>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              当前网站：
              <code className="ml-1">{hostname || '(无)'}</code>
              {!hostname && <span className="ml-1 text-red-400">— 该页面无法记录元素</span>}
            </p>
          </div>

          {/* Step 1: 拾取 */}
          <PickerCard
            state={picker.state}
            onPick={handlePick}
            onReset={picker.reset}
            title="第一步：在页面上拾取元素"
            disabled={!hostname}
          />

          {/* Step 2: 填 purpose */}
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--text-muted)' }}
              htmlFor="mark-purpose">
              第二步：用途描述（必填）
            </label>
            <input
              id="mark-purpose"
              type="text"
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              maxLength={30}
              placeholder='例如："提交按钮"、"搜索框"、"展开评论"'
              className="jade-input w-full px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              2-12 个字，越具体越好。AI 在 state 消息里会按 purpose 匹配。
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--gold-color)' }}>
              <FiAlertTriangle size={12} />
              <span>{error}</span>
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-color)' }}>
              <FiCheck size={12} />
              <span>已存入元素记忆</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border-color)' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border px-3 py-1.5 text-sm transition-all duration-200 hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            取消
          </button>
          <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="jade-btn px-4 py-1.5 text-sm">
            {saved ? '已保存' : submitting ? '保存中…' : '保存到记忆'}
          </button>
        </div>
      </div>
    </div>
  );
}
