import { useState, useEffect, useCallback } from 'react';
import { farmerSitesStore, type FarmerSite } from '@extension/storage';
import { FiPlus, FiTrash2, FiRefreshCw } from 'react-icons/fi';
import { RxDragHandleDots2 } from 'react-icons/rx';

interface FarmerSitesSettingsProps {
  isDarkMode?: boolean;
}

/**
 * 农场主模式的 AI 网站清单设置：
 * - 增删改查
 * - 启用/禁用
 * - HTML5 原生拖拽排序（不引入额外依赖）
 * - hints freeform 文本，供 Agent 优先参考
 */
export const FarmerSitesSettings = ({ isDarkMode = false }: FarmerSitesSettingsProps) => {
  const [sites, setSites] = useState<FarmerSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await farmerSitesStore.getSites();
    setSites(next);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const handlePatch = async <K extends keyof Omit<FarmerSite, 'id'>>(id: string, key: K, value: FarmerSite[K]) => {
    // 乐观更新本地，再持久化
    setSites(prev => prev.map(s => (s.id === id ? { ...s, [key]: value } : s)));
    await farmerSitesStore.updateSite(id, { [key]: value });
  };

  const handleAdd = async () => {
    await farmerSitesStore.addSite({
      name: '新网站',
      url: 'https://',
      desc: '',
      hints: '',
      enabled: true,
    });
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await farmerSitesStore.deleteSite(id);
    await refresh();
  };

  const handleReset = async () => {
    if (!window.confirm('确认要恢复默认网站清单？所有自定义修改会丢失。')) return;
    await farmerSitesStore.resetToDefaults();
    await refresh();
  };

  const moveTo = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const fromIdx = sites.findIndex(s => s.id === fromId);
    const toIdx = sites.findIndex(s => s.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...sites];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setSites(next);
    await farmerSitesStore.reorderSites(next.map(s => s.id));
  };

  // ===== 样式工具 =====
  const cardClass = `rounded-lg border ${
    isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'
  } p-6 text-left shadow-sm`;
  const inputClass = `w-full rounded-md border px-3 py-2 text-sm ${
    isDarkMode
      ? 'border-slate-600 bg-slate-700 text-gray-200 placeholder:text-gray-500'
      : 'border-gray-300 bg-white text-gray-700 placeholder:text-gray-400'
  }`;
  const labelClass = `mb-1 block text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`;

  return (
    <section className="space-y-6">
      <div className={cardClass}>
        {/* 标题区 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              🌾 农场主网站清单
            </h2>
            <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              开启农场主模式时，皮蛋会按这里的顺序依次访问 AI 网站并采集回答。 可填写每个网站的「操作提示」（XPath /
              selector / 备注）以提高准确度。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className={`flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm ${
                isDarkMode
                  ? 'border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
              title="恢复默认网站清单">
              <FiRefreshCw size={14} />
              恢复默认
            </button>
            <button
              type="button"
              onClick={handleAdd}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500">
              <FiPlus size={14} />
              新增网站
            </button>
          </div>
        </div>

        {/* 列表 */}
        {loading ? (
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>加载中...</p>
        ) : sites.length === 0 ? (
          <div
            className={`rounded-md border border-dashed p-8 text-center text-sm ${
              isDarkMode ? 'border-slate-600 text-gray-400' : 'border-gray-300 text-gray-500'
            }`}>
            还没有任何网站。点击「新增网站」开始添加，或点「恢复默认」拉回内置清单。
          </div>
        ) : (
          <ul className="space-y-3">
            {sites.map(site => (
              <li
                key={site.id}
                draggable
                onDragStart={() => setDraggingId(site.id)}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => {
                  if (draggingId) moveTo(draggingId, site.id);
                }}
                className={`rounded-md border p-3 transition-all ${draggingId === site.id ? 'opacity-50' : ''} ${
                  isDarkMode ? 'border-slate-600 bg-slate-700/50' : 'border-gray-200 bg-gray-50'
                }`}>
                {/* 卡片头：拖拽手柄 + 名称 + 启用开关 + 删除 */}
                <div className="mb-3 flex items-start gap-3">
                  <div
                    className={`mt-2 cursor-grab ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}
                    title="拖拽排序">
                    <RxDragHandleDots2 size={18} />
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass} htmlFor={`name-${site.id}`}>
                        名称
                      </label>
                      <input
                        id={`name-${site.id}`}
                        type="text"
                        value={site.name}
                        onChange={e => handlePatch(site.id, 'name', e.target.value)}
                        className={inputClass}
                        placeholder="例如：DeepSeek"
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor={`url-${site.id}`}>
                        URL
                      </label>
                      <input
                        id={`url-${site.id}`}
                        type="text"
                        value={site.url}
                        onChange={e => handlePatch(site.id, 'url', e.target.value)}
                        className={inputClass}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 pt-5">
                    <label className="flex items-center gap-1 text-sm" htmlFor={`enabled-${site.id}`}>
                      <input
                        id={`enabled-${site.id}`}
                        type="checkbox"
                        checked={site.enabled}
                        onChange={e => handlePatch(site.id, 'enabled', e.target.checked)}
                        className="size-4"
                      />
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>启用</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleDelete(site.id)}
                      className="text-red-400 hover:text-red-500"
                      title="删除">
                      <FiTrash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* 描述 + hints */}
                <div className="ml-7 space-y-3">
                  <div>
                    <label className={labelClass} htmlFor={`desc-${site.id}`}>
                      简短描述（出现在给 AI 的清单里）
                    </label>
                    <input
                      id={`desc-${site.id}`}
                      type="text"
                      value={site.desc}
                      onChange={e => handlePatch(site.id, 'desc', e.target.value)}
                      className={inputClass}
                      placeholder="例如：深度推理能力强，适合复杂分析"
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor={`hints-${site.id}`}>
                      操作提示（XPath / selector / 步骤备注；自由填写，Agent 会优先参考）
                    </label>
                    <textarea
                      id={`hints-${site.id}`}
                      value={site.hints}
                      onChange={e => handlePatch(site.id, 'hints', e.target.value)}
                      className={`${inputClass} min-h-[80px] resize-y`}
                      placeholder={
                        '示例：\n输入框 XPath: //textarea[@id="chat-input"]\n发送按钮: //button[@aria-label="Send"]\n注意：首次访问可能弹「同意 Cookie」按钮，先点掉再操作'
                      }
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
