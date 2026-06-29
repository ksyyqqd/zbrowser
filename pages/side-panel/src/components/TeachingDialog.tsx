/**
 * 教导模式弹窗（Teaching Mode）
 *
 * 一次性把当前页面所有可交互元素的 purpose 都教给皮蛋。
 *
 * 流程：
 *  1. 打开弹窗 → 通过 port 请求 background 'get_interactive_elements' 拉当前页面元素列表
 *  2. 拿到列表后立即请求 'infer_element_purposes' 让 LLM 批量推测 purpose+confidence
 *  3. 进入 review 阶段：列表 + 多选 + 编辑 + 高亮 + 手动补充
 *  4. 保存：调 elementHintsStore.addHints 批量入库
 *
 * 设计：
 *  - 与 ClarifyDialog/MarkElementDialog 视觉一致（玉质 + CSS 变量）
 *  - 默认勾选 confidence ≥ 0.85 的项
 *  - 用户编辑过 purpose 或勾选的项 source 标 'user_pick'，否则 'ai_inferred'
 *  - 手动补充：复用 useElementPicker hook
 */

import { useEffect, useMemo, useState } from 'react';
import { FiX, FiCheck, FiAlertTriangle, FiEye } from 'react-icons/fi';
import { elementHintsStore, getHostnameFromUrl } from '@extension/storage';
import { useElementPicker } from '@src/hooks/useElementPicker';
import { PickerCard } from './PickerCard';
import type { ElementRef } from '@src/types/elementRef';

interface TeachingDialogProps {
  port: chrome.runtime.Port | null;
  onClose: () => void;
  /** 用户点列表行 [index] → 把该元素引用到聊天框（SidePanel 处理插入 + 关闭弹窗） */
  onPickToChat?: (ref: ElementRef) => void;
}

interface RawElement {
  index: number;
  tagName: string;
  text: string;
  xpath?: string;
  attributes: Record<string, string>;
}

interface InferenceItem {
  index: number;
  purpose: string;
  confidence: number;
  reasoning?: string;
}

/** 列表行：合并了 raw element 和 LLM 推测，加 UI 状态 */
interface ReviewRow {
  /** 来源 index（来自 selectorMap）；负数表示用户手动补充的 */
  index: number;
  tagName: string;
  text: string;
  xpath?: string;
  /** 仅手动补充行有 selector */
  selector?: string;
  /** 当前 purpose 文本（用户可编辑） */
  purpose: string;
  /** LLM 原始 purpose（用于判断"用户改过没"） */
  originalPurpose: string;
  confidence: number;
  reasoning?: string;
  selected: boolean;
  /** 'ai_inferred' | 'manual'：决定 source 字段；用户编辑过 purpose 升级为 user_pick */
  origin: 'ai_inferred' | 'manual';
}

type Phase = 'loading' | 'inferring' | 'reviewing' | 'saving' | 'saved' | 'error';

const CONF_HIGH = 0.85;

export function TeachingDialog({ port, onClose, onPickToChat }: TeachingDialogProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hostname, setHostname] = useState('');
  const [tabId, setTabId] = useState<number | null>(null);
  const [rawElements, setRawElements] = useState<RawElement[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  // 手动补充用的 picker
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

  // 启动：拉元素 → 推 purpose
  useEffect(() => {
    if (!port) {
      setPhase('error');
      setErrorMsg('与后台连接已断开');
      return;
    }
    let cancelled = false;
    const handler = (msg: unknown) => {
      if (cancelled || !msg || typeof msg !== 'object') return;
      const m = msg as {
        type?: string;
        elements?: RawElement[];
        items?: InferenceItem[];
        url?: string;
        error?: string;
      };
      if (m.type === 'interactive_elements') {
        const els = m.elements || [];
        setRawElements(els);
        if (m.url && !hostname) setHostname(getHostnameFromUrl(m.url));
        if (els.length === 0) {
          setPhase('reviewing');
          setRows([]);
          return;
        }
        setPhase('inferring');
        // 立即发推测请求
        port.postMessage({ type: 'infer_element_purposes', elements: els, url: m.url || '' });
      } else if (m.type === 'inferred_purposes') {
        const items = m.items || [];
        // 合并 raw + inference → ReviewRow
        const byIdx = new Map(items.map(i => [i.index, i]));
        const merged: ReviewRow[] = [];
        for (const el of rawElements) {
          const inf = byIdx.get(el.index);
          // LLM 没推荐的元素不展示（保持列表简洁，且这些元素 confidence < 0.4 不值得入库）
          if (!inf) continue;
          merged.push({
            index: el.index,
            tagName: el.tagName,
            text: el.text,
            xpath: el.xpath,
            purpose: inf.purpose,
            originalPurpose: inf.purpose,
            confidence: inf.confidence,
            reasoning: inf.reasoning,
            selected: inf.confidence >= CONF_HIGH,
            origin: 'ai_inferred',
          });
        }
        // 按 confidence 倒序
        merged.sort((a, b) => b.confidence - a.confidence);
        setRows(merged);
        setPhase('reviewing');
      } else if (m.type === 'error' && (phase === 'loading' || phase === 'inferring')) {
        setPhase('error');
        setErrorMsg(m.error || '未知错误');
      }
    };
    port.onMessage.addListener(handler);
    // 触发拉元素
    port.postMessage({ type: 'get_interactive_elements' });
    return () => {
      cancelled = true;
      port.onMessage.removeListener(handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, rawElements]);

  // 监听手动拾取完成 → 加一行
  useEffect(() => {
    if (picker.state.phase !== 'picked') return;
    const ps = picker.state;
    if (!ps.selector && !ps.xpath) return;
    // 用一个负数 index 区分手动行（不与 selectorMap index 冲突）
    const manualIdx = -(rows.filter(r => r.origin === 'manual').length + 1);
    setRows(prev => [
      ...prev,
      {
        index: manualIdx,
        tagName: 'manual',
        text: ps.text || '',
        xpath: ps.xpath,
        selector: ps.selector,
        purpose: ps.text ? ps.text.trim().slice(0, 20) : '',
        originalPurpose: '',
        confidence: 1, // 手动拾取的视为最高置信
        selected: true,
        origin: 'manual',
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
  const selectHigh = () =>
    setRows(prev => prev.map(r => ({ ...r, selected: r.confidence >= CONF_HIGH || r.origin === 'manual' })));

  const handleHighlight = (row: ReviewRow) => {
    if (!port || typeof tabId !== 'number') return;
    port.postMessage({
      type: 'highlight_element',
      tabId,
      selector: row.selector,
      xpath: row.xpath,
      duration: 2000,
    });
  };

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
          // 用户编辑过 purpose 视为亲自确认，升级为 user_pick；手动拾取也是 user_pick
          source: r.origin === 'manual' || r.purpose.trim() !== r.originalPurpose.trim() ? 'user_pick' : 'ai_inferred',
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
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {phase === 'loading' && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              正在扫描当前页面元素…
            </p>
          )}
          {phase === 'inferring' && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              已找到 {rawElements.length} 个可交互元素，AI 正在推测每个元素的用途…
            </p>
          )}
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
                <span style={{ color: 'var(--text-muted)' }}>
                  AI 推测了 {rows.filter(r => r.origin === 'ai_inferred').length} 个、 你补充了{' '}
                  {rows.filter(r => r.origin === 'manual').length} 个
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={selectHigh}
                    className="rounded border px-2 py-0.5 transition-colors hover:bg-[var(--bg-card-hover)]"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                    只选高把握
                  </button>
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
                  AI 没有推荐任何元素。可在下方手动补充。
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
                            {row.origin === 'manual' ? (
                              <span
                                className="rounded px-1.5 py-0.5"
                                style={{ background: 'var(--accent-glow)', color: 'var(--accent-color)' }}>
                                👆 手动
                              </span>
                            ) : onPickToChat ? (
                              <button
                                type="button"
                                onClick={() => {
                                  // 把这一行作为引用插到聊天框；不影响事实库勾选保存
                                  onPickToChat({
                                    label: `${row.purpose.trim() || row.tagName} #${row.index}`,
                                    purpose: row.purpose.trim() || row.tagName,
                                    index: row.index,
                                    xpath: row.xpath,
                                    selector: row.selector,
                                    text: row.text,
                                    origin: 'teaching',
                                  });
                                }}
                                className="rounded px-1.5 py-0.5 transition-colors hover:!bg-[var(--accent-glow)] hover:!text-[var(--accent-color)]"
                                style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
                                title="引用到聊天框（点击）">
                                [{row.index}] {row.tagName}
                              </button>
                            ) : (
                              <span
                                className="rounded px-1.5 py-0.5"
                                style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                                [{row.index}] {row.tagName}
                              </span>
                            )}
                            <ConfidenceBadge value={row.confidence} />
                            {row.text && (
                              <span
                                className="truncate text-xs"
                                style={{ color: 'var(--text-muted)', maxWidth: '200px' }}>
                                "{row.text}"
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleHighlight(row)}
                              className="ml-auto flex items-center gap-0.5 rounded border px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-card-hover)]"
                              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                              title="在页面上高亮该元素 2 秒">
                              <FiEye size={11} />
                              <span>看</span>
                            </button>
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
                          {row.reasoning && (
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              💭 {row.reasoning}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* 手动补充区 */}
              <div className="mt-4">
                <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  AI 没列出的元素？手动补充：
                </p>
                <PickerCard
                  state={picker.state}
                  onPick={() => picker.pick()}
                  onReset={picker.reset}
                  title="补充列表外的元素"
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

function ConfidenceBadge({ value }: { value: number }) {
  const pct = (value * 100).toFixed(0);
  let bg = 'var(--bg-secondary)';
  let color = 'var(--text-muted)';
  if (value >= 0.85) {
    bg = 'rgba(64,145,108,0.15)';
    color = '#40916c';
  } else if (value >= 0.7) {
    bg = 'rgba(217,119,6,0.12)';
    color = '#d97706';
  } else {
    bg = 'rgba(220,38,38,0.12)';
    color = '#dc2626';
  }
  return (
    <span className="rounded px-1.5 py-0.5 text-xs font-medium tabular-nums" style={{ background: bg, color }}>
      {pct}%
    </span>
  );
}
