/**
 * 元素事实库 (Element Hints) —— 按 hostname 索引的可复用元素 selector / xpath 库
 *
 * 与 farmerSites.hints 的区别：
 *  - farmerSites.hints 是「prompt 备忘」(freeform string)，仅在农场主模式注入
 *  - 这里是「全局事实库」(结构化 entries)，**任何** Navigator 决策时按当前 hostname 拼到页面状态消息里
 *
 * 写入规则（避免污染）：
 *  - 用户拾取 + Agent 用 selector 真的成功执行了点击/输入 → 入库
 *  - 用户拾取 但 Agent 用了发现报错 → 不入库
 *  - 用户拾取 但 任务被终止 / 提前中断 → 不入库
 *  - 入库时同 selector/xpath 已存在 → 不重复，只更新 lastUsedAt + useCount
 *
 * 读取：
 *  - `getByHostname(host)` 返回该 host 的所有 hint
 *  - 通过 `getHostnameFromUrl(url)` 抽取 hostname（已暴露在 utils 里）
 */

import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface ElementHint {
  id: string;
  /** 元素的功能描述：「提交按钮」/「搜索框」/「用户名输入框」/「展开评论」等 */
  purpose: string;
  selector?: string;
  xpath?: string;
  /** 用户拾取时的可见文本片段，用于 selector 失效时基于文本回退 */
  textContent?: string;
  source: 'user_pick' | 'ai_success' | 'ai_inferred' | 'manual';
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}

export interface ElementHintsBucket {
  hostname: string;
  hints: ElementHint[];
  updatedAt: number;
}

/** 全部 buckets 按 hostname 字典存（单 chrome.storage.local key） */
export interface ElementHintsConfig {
  buckets: Record<string, ElementHintsBucket>;
}

export const DEFAULT_ELEMENT_HINTS_CONFIG: ElementHintsConfig = { buckets: {} };

const generateId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/**
 * 从 URL 取 hostname；不抛错，失败返回 ''。
 * 之所以放这里：storage 和 background 都要用。
 */
export function getHostnameFromUrl(url: string | undefined | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const storage = createStorage<ElementHintsConfig>('element-hints', DEFAULT_ELEMENT_HINTS_CONFIG, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export type ElementHintsStorage = BaseStorage<ElementHintsConfig> & {
  /** 取某 hostname 的全部 hints；为空返回空数组 */
  getByHostname: (hostname: string) => Promise<ElementHint[]>;
  /** 列出所有 hostname bucket，按 updatedAt 倒序 */
  listBuckets: () => Promise<ElementHintsBucket[]>;
  /**
   * 加一条 hint；若同 hostname 下同 selector+xpath 已存在则只 touch，不重复。
   * 返回最终落库的 hint（新或旧）。
   */
  addHint: (
    hostname: string,
    hint: Omit<ElementHint, 'id' | 'createdAt' | 'lastUsedAt' | 'useCount'>,
  ) => Promise<ElementHint>;
  /**
   * 批量加 hints；一次 storage.get + 内存合并去重 + 一次 storage.set。
   * 同 selector+xpath 已存在 → touch（useCount + 1，purpose 用新的覆盖）。
   * 返回最终每条入库的 hint（顺序对齐入参）。
   */
  addHints: (
    hostname: string,
    hints: Array<Omit<ElementHint, 'id' | 'createdAt' | 'lastUsedAt' | 'useCount'>>,
  ) => Promise<ElementHint[]>;
  /** Hint 被 LLM 复用一次（useCount +1, lastUsedAt 刷新） */
  touchHint: (hostname: string, id: string) => Promise<void>;
  /** 删除单条 */
  removeHint: (hostname: string, id: string) => Promise<void>;
  /** 清空某 hostname */
  clearHostname: (hostname: string) => Promise<void>;
  /** 清空全部 */
  resetAll: () => Promise<void>;
};

function sameElement(a: ElementHint, sel?: string, xp?: string): boolean {
  // 二者都为空时不算"同一元素"，避免误合并
  if (!sel && !xp) return false;
  return (sel ? a.selector === sel : true) && (xp ? a.xpath === xp : true);
}

export const elementHintsStore: ElementHintsStorage = {
  ...storage,

  async getByHostname(hostname) {
    if (!hostname) return [];
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    return cfg.buckets[hostname]?.hints ?? [];
  },

  async listBuckets() {
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    return Object.values(cfg.buckets).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async addHint(hostname, hint) {
    if (!hostname) throw new Error('elementHintsStore.addHint: hostname required');
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    const now = Date.now();
    const bucket = cfg.buckets[hostname] || { hostname, hints: [], updatedAt: now };

    // 去重：找同 selector+xpath 已有项 → 更新 lastUsedAt、useCount、purpose（最新的描述更可信）
    const existing = bucket.hints.find(h => sameElement(h, hint.selector, hint.xpath));
    let finalHint: ElementHint;
    let nextHints: ElementHint[];
    if (existing) {
      finalHint = {
        ...existing,
        purpose: hint.purpose || existing.purpose,
        textContent: hint.textContent || existing.textContent,
        lastUsedAt: now,
        useCount: existing.useCount + 1,
      };
      nextHints = bucket.hints.map(h => (h.id === existing.id ? finalHint : h));
    } else {
      finalHint = {
        ...hint,
        id: generateId(),
        createdAt: now,
        lastUsedAt: now,
        useCount: 1,
      };
      nextHints = [...bucket.hints, finalHint];
    }
    const nextBucket: ElementHintsBucket = { hostname, hints: nextHints, updatedAt: now };
    await storage.set({ ...cfg, buckets: { ...cfg.buckets, [hostname]: nextBucket } });
    return finalHint;
  },

  async addHints(hostname, incoming) {
    if (!hostname) throw new Error('elementHintsStore.addHints: hostname required');
    if (!incoming || incoming.length === 0) return [];
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    const now = Date.now();
    const bucket = cfg.buckets[hostname] || { hostname, hints: [], updatedAt: now };

    // 工作集：先用现有 bucket.hints 作为基底，循环合并 incoming
    const workingHints: ElementHint[] = [...bucket.hints];
    const results: ElementHint[] = [];

    for (const hint of incoming) {
      // 在 workingHints 里找同元素：和单条 addHint 同一规则（selector+xpath 都不空时同元素，二者都为空不合并）
      const idx = workingHints.findIndex(h => sameElement(h, hint.selector, hint.xpath));
      if (idx >= 0) {
        const existing = workingHints[idx];
        const merged: ElementHint = {
          ...existing,
          purpose: hint.purpose || existing.purpose,
          textContent: hint.textContent || existing.textContent,
          // source 不覆盖：保留原始来源（已经是 user_pick 的不会被 ai_inferred 降级）
          lastUsedAt: now,
          useCount: existing.useCount + 1,
        };
        workingHints[idx] = merged;
        results.push(merged);
      } else {
        const created: ElementHint = {
          ...hint,
          id: generateId(),
          createdAt: now,
          lastUsedAt: now,
          useCount: 1,
        };
        workingHints.push(created);
        results.push(created);
      }
    }

    const nextBucket: ElementHintsBucket = { hostname, hints: workingHints, updatedAt: now };
    await storage.set({ ...cfg, buckets: { ...cfg.buckets, [hostname]: nextBucket } });
    return results;
  },

  async touchHint(hostname, id) {
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    const bucket = cfg.buckets[hostname];
    if (!bucket) return;
    const now = Date.now();
    const hints = bucket.hints.map(h => (h.id === id ? { ...h, lastUsedAt: now, useCount: h.useCount + 1 } : h));
    await storage.set({
      ...cfg,
      buckets: { ...cfg.buckets, [hostname]: { ...bucket, hints, updatedAt: now } },
    });
  },

  async removeHint(hostname, id) {
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    const bucket = cfg.buckets[hostname];
    if (!bucket) return;
    const nextHints = bucket.hints.filter(h => h.id !== id);
    const buckets = { ...cfg.buckets };
    if (nextHints.length === 0) {
      delete buckets[hostname];
    } else {
      buckets[hostname] = { ...bucket, hints: nextHints, updatedAt: Date.now() };
    }
    await storage.set({ ...cfg, buckets });
  },

  async clearHostname(hostname) {
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    if (!cfg.buckets[hostname]) return;
    const buckets = { ...cfg.buckets };
    delete buckets[hostname];
    await storage.set({ ...cfg, buckets });
  },

  async resetAll() {
    await storage.set(DEFAULT_ELEMENT_HINTS_CONFIG);
  },
};
