/**
 * 聊天输入框的 @ 元素引用面板
 *
 * 弹出位置：ChatInput 工具栏 @ 按钮上方（绝对定位）。
 * 内容：
 *  - 顶部搜索框（按 purpose 过滤）
 *  - 中部：当前 hostname 的事实库列表，点击 → 引用 + 关面板
 *  - 底部：「在页面上拾取新的」→ useElementPicker → 让用户填 purpose → 引用 + 落库
 *
 * 不持久化勾选；点一项就直接出（mouse-friendly，键盘 mention 模式留给以后）
 */

import { useEffect, useMemo, useState } from 'react';
import { FiX, FiSearch } from 'react-icons/fi';
import { elementHintsStore, getHostnameFromUrl, type ElementHint } from '@extension/storage';
import { useElementPicker } from '@src/hooks/useElementPicker';
import { PickerCard } from './PickerCard';
import type { ElementRef } from '@src/types/elementRef';

interface ElementRefPanelProps {
  /** 父级提供：往 refs 数组加一条 + 把可见 token 插到 textarea 光标处 */
  onPick: (ref: ElementRef) => void;
  onClose: () => void;
}

export function ElementRefPanel({ onPick, onClose }: ElementRefPanelProps) {
  const [hostname, setHostname] = useState('');
  const [tabId, setTabId] = useState<number | null>(null);
  const [hints, setHints] = useState<ElementHint[]>([]);
  const [search, setSearch] = useState('');
  // 拾取后让用户填 purpose 的迷你流程
  const [pendingPurpose, setPendingPurpose] = useState('');
  const picker = useElementPicker(tabId);

  useEffect(() => {
    (async () => {
      try {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (active?.id) setTabId(active.id);
        const host = getHostnameFromUrl(active?.url);
        setHostname(host);
        if (host) {
          // getByHostname 已剔除过期项并按注入优先级排好序，这里不再另排 ——
          // 面板里的顺序要和真正注入给 AI 的顺序一致，否则用户以为第一条会被优先用。
          setHints(await elementHintsStore.getByHostname(host));
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // 拾取完毕 → 填 purpose 默认值
  useEffect(() => {
    if (picker.state.phase === 'picked' && !pendingPurpose && picker.state.text) {
      setPendingPurpose(picker.state.text.trim().slice(0, 20));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker.state]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hints;
    return hints.filter(h => h.purpose.toLowerCase().includes(q));
  }, [hints, search]);

  const handlePickFromMemory = (h: ElementHint) => {
    onPick({
      label: h.purpose, // 库内 hint 没 selectorMap index → label 不带 #N
      purpose: h.purpose,
      index: -1,
      selector: h.selector,
      xpath: h.xpath,
      text: h.textContent,
      origin: 'memory',
    });
    onClose();
  };

  const handleCommitNewPick = async () => {
    if (picker.state.phase !== 'picked') return;
    const purpose = pendingPurpose.trim();
    if (!purpose) return;
    const ps = picker.state;
    // 同步落库：用户主动拾取并指定了 purpose = user_pick
    try {
      if (hostname) {
        await elementHintsStore.addHint(hostname, {
          purpose,
          selector: ps.selector,
          xpath: ps.xpath,
          textContent: ps.text,
          source: 'user_pick',
        });
      }
    } catch {
      /* 落库失败不阻塞引用 */
    }
    onPick({
      label: purpose,
      purpose,
      index: -1,
      selector: ps.selector,
      xpath: ps.xpath,
      text: ps.text,
      origin: 'pick',
    });
    onClose();
  };

  return (
    <div
      className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-lg border shadow-xl"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-color)',
        boxShadow: 'var(--shadow-lg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}>
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: 'var(--border-color)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          @ 引用页面元素
        </span>
        <button type="button" onClick={onClose} className="icon-btn" aria-label="关闭">
          <FiX size={12} />
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto p-2">
        {/* 当前网站 */}
        <div className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {hostname ? (
            <>
              当前网站：<code>{hostname}</code>
            </>
          ) : (
            '当前页面无法记录元素'
          )}
        </div>

        {/* 搜索 */}
        {hints.length > 0 && (
          <div className="relative mb-2">
            <FiSearch
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="按用途搜索…"
              className="jade-input w-full py-1 pl-7 pr-2 text-xs"
            />
          </div>
        )}

        {/* 列表 */}
        {hints.length === 0 ? (
          <div
            className="rounded border border-dashed px-2 py-3 text-center text-xs"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }}>
            该网站还没有元素记忆
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="rounded border border-dashed px-2 py-3 text-center text-xs"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }}>
            没有匹配项
          </div>
        ) : (
          <ul className="space-y-1">
            {filtered.map(h => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => handlePickFromMemory(h)}
                  className="flex w-full items-start gap-2 rounded border px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-card-hover)]"
                  style={{ borderColor: 'var(--border-color)' }}>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {h.purpose}
                  </span>
                  <span className="ml-auto shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {h.useCount}×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 现场拾取 */}
        <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--border-color)' }}>
          {picker.state.phase !== 'picked' ? (
            <PickerCard
              state={picker.state}
              onPick={() => picker.pick()}
              onReset={picker.reset}
              title="或拾取一个新的元素"
              buttonLabel="🎯 在页面上拾取"
              disabled={!hostname}
              compact
            />
          ) : (
            <div className="space-y-2">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                已拾取，给它一个用途名字：
              </p>
              <input
                type="text"
                value={pendingPurpose}
                onChange={e => setPendingPurpose(e.target.value)}
                maxLength={30}
                placeholder='例："搜索框"、"提交按钮"'
                className="jade-input w-full px-2 py-1 text-xs"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    picker.reset();
                    setPendingPurpose('');
                  }}
                  className="flex-1 rounded border px-2 py-1 text-xs transition-colors hover:bg-[var(--bg-card-hover)]"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                  重新拾取
                </button>
                <button
                  type="button"
                  onClick={handleCommitNewPick}
                  disabled={!pendingPurpose.trim()}
                  className="jade-btn flex-1 px-2 py-1 text-xs disabled:opacity-50">
                  引用并入库
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
