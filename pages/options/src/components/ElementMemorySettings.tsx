import { useState, useEffect, useCallback } from 'react';
import {
  elementHintsStore,
  isHintExpired,
  sortHintsByPriority,
  HINT_TTL_DAYS,
  MAX_STALE_HITS,
  type ElementHintsBucket,
} from '@extension/storage';
import { FiTrash2, FiRefreshCw, FiChevronDown, FiChevronRight, FiStar } from 'react-icons/fi';

interface ElementMemorySettingsProps {
  isDarkMode?: boolean;
}

/**
 * 元素事实库 (Element Memory) 管理 UI
 *
 * 设计意图：用户能审计 / 清理 AI 持久化的元素，但**不能手动添加**（保持事实性——
 * 只有 AI 通过 user_pick 或 ai_success 路径才能写入）。
 *
 * 来自 elementHintsStore（按 hostname 索引）。
 */
export function ElementMemorySettings({ isDarkMode = false }: ElementMemorySettingsProps) {
  const [buckets, setBuckets] = useState<ElementHintsBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const list = await elementHintsStore.listBuckets();
    setBuckets(list);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const toggleExpand = (hostname: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(hostname) ? next.delete(hostname) : next.add(hostname);
      return next;
    });
  };

  const handleDeleteHint = async (hostname: string, id: string) => {
    await elementHintsStore.removeHint(hostname, id);
    await refresh();
  };

  const handleClearHostname = async (hostname: string) => {
    if (!window.confirm(`确认清空 ${hostname} 下的全部元素记忆？`)) return;
    await elementHintsStore.clearHostname(hostname);
    await refresh();
  };

  const handleResetAll = async () => {
    if (!window.confirm('确认清空全部元素记忆？所有网站的历史拾取都会丢失。')) return;
    await elementHintsStore.resetAll();
    await refresh();
  };

  const handleTogglePin = async (hostname: string, id: string, pinned: boolean) => {
    await elementHintsStore.setHintPinned(hostname, id, pinned);
    await refresh();
  };

  const handlePruneExpired = async () => {
    const removed = await elementHintsStore.pruneExpired();
    await refresh();
    window.alert(removed > 0 ? `已清理 ${removed} 条过期记忆。` : '没有需要清理的过期记忆。');
  };

  const cardClass = `rounded-lg border ${
    isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'
  } p-6 text-left shadow-sm`;
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';

  const totalHints = buckets.reduce((sum, b) => sum + b.hints.length, 0);
  // listBuckets 返回原始数据（含过期项），管理 UI 要能看到并手动清理它们
  const expiredCount = buckets.reduce((sum, b) => sum + b.hints.filter(h => isHintExpired(h)).length, 0);

  return (
    <section className="space-y-6">
      <div className={cardClass}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>🧠 元素记忆</h2>
            <p className={`mt-1 text-sm ${muted}`}>
              皮蛋在每个网站上拾取或摸索成功的元素都会记到这里，下次访问同一网站时自动复用， 避免反复弹窗问。
              <b>无法手动添加</b>——只能由 AI 写入。
            </p>
            <p className={`mt-1 text-xs ${muted}`}>
              当前已记 <b>{buckets.length}</b> 个网站，共 <b>{totalHints}</b> 条元素
              {expiredCount > 0 && (
                <>
                  ，其中 <b className="text-amber-500">{expiredCount}</b> 条已过期（不再注入给 AI）
                </>
              )}
              。
            </p>
            <p className={`mt-1 text-xs ${muted}`}>
              注入给 AI 时按优先级取前几条：<b>来源可信度 + 使用次数 × 新鲜度衰减</b>。 长期没用到的会自动过期（用户拾取
              {HINT_TTL_DAYS.user_pick} 天 / AI 成功 {HINT_TTL_DAYS.ai_success} 天 / AI 推测 {HINT_TTL_DAYS.ai_inferred}{' '}
              天，从上次用到时算起）， 连续 {MAX_STALE_HITS} 次定位失败也判过期（站点改版）。<b>置顶</b>
              的条目永不过期且优先注入。
            </p>
          </div>
          {buckets.length > 0 && (
            <div className="flex shrink-0 items-center gap-2">
              {expiredCount > 0 && (
                <button
                  type="button"
                  onClick={handlePruneExpired}
                  className={`flex shrink-0 items-center gap-1 rounded-md border px-3 py-1.5 text-sm ${
                    isDarkMode
                      ? 'border-amber-700 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50'
                      : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}
                  title="立即删除所有已过期的记忆">
                  清理过期 ({expiredCount})
                </button>
              )}
              <button
                type="button"
                onClick={handleResetAll}
                className={`flex shrink-0 items-center gap-1 rounded-md border px-3 py-1.5 text-sm ${
                  isDarkMode
                    ? 'border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
                title="清空全部">
                <FiRefreshCw size={14} />
                清空全部
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <p className={`text-sm ${muted}`}>加载中…</p>
        ) : buckets.length === 0 ? (
          <div
            className={`rounded-md border border-dashed p-8 text-center text-sm ${
              isDarkMode ? 'border-slate-600 text-gray-400' : 'border-gray-300 text-gray-500'
            }`}>
            还没有任何元素记忆。
            <br />
            <span className="text-xs">让皮蛋去执行任务时会自动积累——尤其是触发用户澄清弹窗后你拾取的元素。</span>
          </div>
        ) : (
          <ul className="space-y-3">
            {buckets.map(bucket => {
              const isOpen = expanded.has(bucket.hostname);
              const bucketExpired = bucket.hints.filter(h => isHintExpired(h)).length;
              // 按注入优先级展示未过期的，过期的沉到最后 —— 列表顺序就是 AI 实际看到的顺序，
              // 用户排查「为什么 AI 没用我教的那条」时能直接看出它排在第几位
              const ordered = [...sortHintsByPriority(bucket.hints), ...bucket.hints.filter(h => isHintExpired(h))];
              return (
                <li
                  key={bucket.hostname}
                  className={`rounded-md border ${
                    isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'
                  }`}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(bucket.hostname)}
                      className={`flex flex-1 items-center gap-2 text-left ${
                        isDarkMode ? 'text-gray-200' : 'text-gray-800'
                      }`}>
                      {isOpen ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                      <span className="font-medium">{bucket.hostname}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          isDarkMode ? 'bg-slate-600 text-gray-300' : 'bg-blue-100 text-blue-700'
                        }`}>
                        {bucket.hints.length}
                      </span>
                      {bucketExpired > 0 && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            isDarkMode ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-50 text-amber-700'
                          }`}
                          title="已过期，不再注入给 AI">
                          {bucketExpired} 过期
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleClearHostname(bucket.hostname)}
                      className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-500"
                      title="清空此网站的全部记忆">
                      <FiTrash2 size={14} />
                    </button>
                  </div>

                  {isOpen && (
                    <div
                      className={`space-y-2 border-t px-3 py-2 ${isDarkMode ? 'border-slate-600' : 'border-gray-200'}`}>
                      {ordered.map((hint, idx) => {
                        const expired = isHintExpired(hint);
                        return (
                          <div
                            key={hint.id}
                            className={`rounded-md border p-2 text-xs ${expired ? 'opacity-60' : ''} ${
                              isDarkMode ? 'border-slate-600 bg-slate-800' : 'border-gray-200 bg-white'
                            }`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className={`font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                                    {hint.purpose || '(无描述)'}
                                  </span>
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                                      hint.source === 'user_pick'
                                        ? isDarkMode
                                          ? 'bg-emerald-900/40 text-emerald-300'
                                          : 'bg-emerald-50 text-emerald-700'
                                        : hint.source === 'ai_inferred'
                                          ? isDarkMode
                                            ? 'bg-sky-900/40 text-sky-300'
                                            : 'bg-sky-50 text-sky-700'
                                          : isDarkMode
                                            ? 'bg-slate-700 text-gray-400'
                                            : 'bg-gray-100 text-gray-600'
                                    }`}
                                    title={
                                      hint.source === 'user_pick'
                                        ? '用户在弹窗里手动拾取的元素'
                                        : hint.source === 'ai_success'
                                          ? 'AI 自主选择并成功操作的元素'
                                          : hint.source === 'ai_inferred'
                                            ? '教导模式中由 AI 推测、用户未改 purpose 直接入库'
                                            : '手动添加'
                                    }>
                                    {hint.source === 'user_pick'
                                      ? '👆 用户拾取'
                                      : hint.source === 'ai_success'
                                        ? '🤖 AI 成功'
                                        : hint.source === 'ai_inferred'
                                          ? '🔍 AI 推测'
                                          : '✏️ 手动'}
                                  </span>
                                  <span className={muted}>用过 {hint.useCount} 次</span>
                                  {hint.pinned && (
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                                        isDarkMode ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-50 text-amber-700'
                                      }`}
                                      title="已置顶：永不过期，优先注入给 AI">
                                      ⭐ 置顶
                                    </span>
                                  )}
                                  {!expired && !hint.pinned && (
                                    <span className={`${muted} text-[10px]`} title="注入给 AI 时的排序位置">
                                      #{idx + 1}
                                    </span>
                                  )}
                                  {expired && (
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                                        isDarkMode ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-50 text-amber-700'
                                      }`}
                                      title={
                                        (hint.staleHits ?? 0) >= MAX_STALE_HITS
                                          ? `连续 ${hint.staleHits} 次定位失败，判定站点已改版`
                                          : `超过 ${HINT_TTL_DAYS[hint.source] ?? HINT_TTL_DAYS.ai_inferred} 天没用到`
                                      }>
                                      ⏳ 已过期
                                    </span>
                                  )}
                                  {!expired && (hint.staleHits ?? 0) > 0 && (
                                    <span
                                      className={`${muted} text-[10px]`}
                                      title={`定位失败 ${hint.staleHits} 次，累计到 ${MAX_STALE_HITS} 次会判过期`}>
                                      失效 {hint.staleHits}/{MAX_STALE_HITS}
                                    </span>
                                  )}
                                </div>
                                {hint.selector && (
                                  <div className={muted}>
                                    selector: <code className="break-all">{hint.selector}</code>
                                  </div>
                                )}
                                {hint.xpath && (
                                  <div className={muted}>
                                    xpath: <code className="break-all">{hint.xpath}</code>
                                  </div>
                                )}
                                {hint.textContent && (
                                  <div className={muted}>
                                    text: <span className="break-all">{hint.textContent.slice(0, 80)}</span>
                                  </div>
                                )}
                                <div className={`${muted} text-[10px]`}>
                                  上次用：{new Date(hint.lastUsedAt).toLocaleString()}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleTogglePin(bucket.hostname, hint.id, !hint.pinned)}
                                  className={`rounded p-1 ${
                                    hint.pinned
                                      ? 'text-amber-500 hover:bg-amber-50'
                                      : `${muted} hover:bg-gray-100 hover:text-amber-500`
                                  }`}
                                  title={hint.pinned ? '取消置顶' : '置顶（永不过期 + 优先注入）'}>
                                  <FiStar size={12} fill={hint.pinned ? 'currentColor' : 'none'} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteHint(bucket.hostname, hint.id)}
                                  className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-500"
                                  title="删除此条">
                                  <FiTrash2 size={12} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
