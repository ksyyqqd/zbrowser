/**
 * 教导模式弹窗（Teaching Mode）
 *
 * 只保留手动拾取与保存，不再做页面元素批量扫描/LLM 推测。
 *
 * 设计：
 *  - 与 ClarifyDialog/MarkElementDialog 视觉一致（玉质 + CSS 变量）
 *  - 用户可反复手动拾取多个元素，批量保存到元素记忆
 *  - 拾取结果默认按文本生成一个可编辑的用途草稿
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FiX, FiCheck, FiAlertTriangle } from 'react-icons/fi';
import { elementHintsStore, getHostnameFromUrl } from '@extension/storage';
import { useElementPicker } from '@src/hooks/useElementPicker';
import { PickerCard } from './PickerCard';

interface TeachingDialogProps {
  onClose: () => void;
}

interface ReviewRow {
  index: number;
  selector?: string;
  xpath?: string;
  text: string;
  purpose: string;
  selected: boolean;
}

type Phase = 'reviewing' | 'saving' | 'saved' | 'error';

export function TeachingDialog({ onClose }: TeachingDialogProps) {
  const [phase, setPhase] = useState<Phase>('reviewing');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hostname, setHostname] = useState('');
  const [tabId, setTabId] = useState<number | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const nextManualIndexRef = useRef(-1);
  const picker = useElementPicker(tabId);

  // 拿当前 tab + hostname
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

  // 监听手动拾取完成 → 加一行
  useEffect(() => {
    if (picker.state.phase !== 'picked') return;
    const ps = picker.state;
    if (!ps.selector && !ps.xpath) return;
    setRows(prev => [
      ...prev,
      {
        index: nextManualIndexRef.current--,
        selector: ps.selector,
        xpath: ps.xpath,
        text: ps.text || '',
        purpose: ps.text ? ps.text.trim().slice(0, 20) : '',
        selected: true,
      },
    ]);
    picker.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker.state]);

  const selectedCount = useMemo(() => rows.filter(r => r.selected && r.purpose.trim()).length, [rows]);

  const togglePurposeEdit = (index: number, value: string) => {
    setRows(prev => prev.map(r => (r.index === index ? { ...r, purpose: value } : r)));
  };
  const toggleSelected = (index: number) => {
    setRows(prev => prev.map(r => (r.index === index ? { ...r, selected: !r.selected } : r)));
  };
  const removeRow = (index: number) => {
    setRows(prev => prev.filter(r => r.index !== index));
  };
  const selectAll = () => setRows(prev => prev.map(r => ({ ...r, selected: true })));
  const selectNone = () => setRows(prev => prev.map(r => ({ ...r, selected: false })));

  const handleSave = async () => {
    if (!hostname) {
      setErrorMsg('当前页面没有 hostname');
      return;
    }
    const toSave = rows.filter(r => r.selected && r.purpose.trim() && (r.selector || r.xpath));
    if (toSave.length === 0) {
      setErrorMsg('请至少勾选一项并填写用途');
      return;
    }
    setErrorMsg(null);
    setPhase('saving');
    try {
      await elementHintsStore.addHints(
        hostname,
        toSave.map(r => ({
          purpose: r.purpose.trim(),
          selector: r.selector,
          xpath: r.xpath,
          textContent: r.text || undefined,
          source: 'user_pick',
        })),
      );
      setPhase('saved');
      setTimeout(onClose, 1000);
    } catch (e) {
      setPhase('reviewing');
      setErrorMsg(e instanceof Error ? e.message : '保存失败');
    }
  };

  // ===== 渲染 =====
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-3"
      role="dialog"
      aria-modal="true"
      aria-label="教导皮蛋认识当前网站">
      <button
        type="button"
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: 'rgba(15,14,12,0.5)' }}
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border"
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
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ background: 'var(--accent-glow)', color: 'var(--accent-color)' }}>
              🎓 教导皮蛋
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {hostname || '(无 hostname)'}
            </span>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" aria-label="关闭">
            <FiX size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {phase === 'error' && (
            <div className="flex items-center gap-1 text-sm" style={{ color: 'var(--gold-color)' }}>
              <FiAlertTriangle size={14} />
              <span>{errorMsg || '出错了'}</span>
            </div>
          )}

          {phase === 'reviewing' && (
            <>
              {/* 头部操作栏 */}
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span style={{ color: 'var(--text-muted)' }}>只保留手动拾取的元素，支持批量保存</span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="rounded border px-2 py-0.5 transition-colors hover:bg-[var(--bg-card-hover)]"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={selectNone}
                    className="rounded border px-2 py-0.5 transition-colors hover:bg-[var(--bg-card-hover)]"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                    全不选
                  </button>
                </div>
              </div>

              {/* 列表 */}
              {rows.length === 0 ? (
                <div
                  className="rounded-md border border-dashed p-6 text-center text-sm"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
                  还没有手动拾取元素。可在下方开始拾取。
                </div>
              ) : (
                <ul className="space-y-2">
                  {rows.map(row => (
                    <li
                      key={row.index}
                      className="rounded-md border p-2"
                      style={{
                        background: row.selected ? 'var(--accent-glow)' : 'var(--bg-surface)',
                        borderColor: row.selected ? 'var(--accent-color)' : 'var(--border-color)',
                      }}>
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={() => toggleSelected(row.index)}
                          className="mt-1 size-4 shrink-0 cursor-pointer"
                        />
                        <div className="flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span
                              className="rounded px-1.5 py-0.5"
                              style={{ background: 'var(--accent-glow)', color: 'var(--accent-color)' }}>
                              👆 手动
                            </span>
                            {row.text && (
                              <span
                                className="truncate text-xs"
                                style={{ color: 'var(--text-muted)', maxWidth: '200px' }}>
                                &quot;{row.text}&quot;
                              </span>
                            )}
                            <span className="ml-auto text-[11px]" style={{ color: 'var(--text-muted)' }}>
                              可编辑 / 可删除
                            </span>
                            <button
                              type="button"
                              onClick={() => removeRow(row.index)}
                              className="rounded border px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-card-hover)]"
                              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                              title="从列表中移除（不影响其他项）">
                              ×
                            </button>
                          </div>
                          <input
                            type="text"
                            value={row.purpose}
                            onChange={e => togglePurposeEdit(row.index, e.target.value)}
                            maxLength={30}
                            placeholder="用途描述（必填）"
                            className="jade-input w-full px-2 py-1 text-sm"
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* 手动补充区 */}
              <div className="mt-4">
                <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  手动拾取元素：
                </p>
                <PickerCard
                  state={picker.state}
                  onPick={() => picker.pick()}
                  onReset={picker.reset}
                  title="在页面上手动拾取"
                  buttonLabel="🎯 在页面上拾取一个元素"
                  compact
                />
              </div>

              {errorMsg && (
                <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: 'var(--gold-color)' }}>
                  <FiAlertTriangle size={12} />
                  <span>{errorMsg}</span>
                </div>
              )}
            </>
          )}
          {phase === 'saved' && (
            <div className="flex items-center gap-1 text-sm" style={{ color: 'var(--accent-color)' }}>
              <FiCheck size={14} />
              <span>已保存 {selectedCount} 项到元素记忆</span>
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
            disabled={phase === 'saving'}
            className="rounded-md border px-3 py-1.5 text-sm transition-all duration-200 hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={phase !== 'reviewing' || selectedCount === 0 || !hostname}
            className="jade-btn px-4 py-1.5 text-sm">
            {phase === 'saving' ? '保存中…' : phase === 'saved' ? '已保存' : `保存 ${selectedCount} 项到记忆`}
          </button>
        </div>
      </div>
    </div>
  );
}
