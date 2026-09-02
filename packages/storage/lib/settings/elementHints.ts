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
 *  - `getByHostname(host)` 返回该 host 未过期的 hint，已按优先级排序
 *  - 通过 `getHostnameFromUrl(url)` 抽取 hostname（已暴露在 utils 里）
 *
 * ## 优先级与过期
 *
 * 注入给 LLM 的名额只有 MAX_KNOWN_ELEMENTS 条，而 prompt 里写的是「these are hard
 * memories，优先用它的 selector 不要另猜」—— 排进去的条目权重很重，所以选谁进去、
 * 什么时候把谁踢出去都得有依据：
 *
 *  - **优先级**：`scoreHint` = (来源权重 + 使用次数加成) × 新鲜度衰减。
 *    只按 useCount 排的问题是，一条半年前点过 20 次的旧 selector 会永久占着名额，
 *    而站点早就改版了；而用户昨天刚手动教的那条只有 useCount=1，排不进去。
 *  - **过期**：按来源给不同 TTL，从 `lastUsedAt` 起算 —— 一直在用的条目不会过期，
 *    只有「存进来之后再没派上用场」的才会自然淘汰。用户亲手教的留最久，AI 自己
 *    猜的（从没验证过）最短。
 *  - **容量**：每个 hostname 上限 `MAX_HINTS_PER_HOSTNAME`，超了按分数从低到高淘汰。
 *    不设上限的话高频站点会攒出上千条，每次读取都要全量反序列化。
 *
 * 过期条目在读取时被过滤（不改数据），在写入时被真正删掉（顺带压缩存储）。
 * 这样即使 TTL 常量以后调大，被"暂时判过期"的数据也还在，不会一次误判就永久损失。
 */

import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface ElementHint {
  id: string;
  /** 元素的功能描述：「提交按钮」/「搜索框」/「用户名输入框」/「展开评论」等 */
  purpose: string;
  selector?: string;
  /**
   * 基于 data-testid / aria-label 等稳定属性的备用选择器。
   * selector 依赖 class，而现代前端的 class 多是构建期哈希（div._020ab5b），下次发版即失效；
   * 这条跨版本稳定得多，作为同级候选供 selector 失效时回退。
   */
  stableSelector?: string;
  xpath?: string;
  /** 用户拾取时的可见文本片段，用于 selector 失效时基于文本回退 */
  textContent?: string;
  source: ElementHintSource;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  /**
   * 用户置顶：跳过优先级排序直接进注入名额，且永不过期。
   *
   * 存在的理由是自动评分总有判错的时候 —— 某个站点的关键入口一个月才用一次，
   * 分数天然低、TTL 也快到，但用户就是需要它一直在。给个手动兜底比反复调参可靠。
   */
  pinned?: boolean;
  /**
   * 连续失效次数。用这条 hint 的 selector/xpath 定位失败时 +1，成功时归零。
   *
   * 站点改版后旧 selector 会稳定失败，但 lastUsedAt 不会更新、TTL 要等很久才到，
   * 中间这段时间它照样占着注入名额、还在误导 LLM。累计到 MAX_STALE_HITS 就直接判过期。
   */
  staleHits?: number;
}

export type ElementHintSource = 'user_pick' | 'ai_success' | 'ai_inferred' | 'manual';

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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 各来源的存活期（天），从 `lastUsedAt` 起算。
 *
 * 差异化的依据是「这条信息被验证过几次」：
 *  - manual / user_pick：用户亲手指的，最可信，留一季度
 *  - ai_success：AI 用它真的成功执行过一次动作，可信但没人复核，留一个月
 *  - ai_inferred：AI 猜的、从没验证过，两周内没派上用场就该走
 */
export const HINT_TTL_DAYS: Record<ElementHintSource, number> = {
  manual: 90,
  user_pick: 90,
  ai_success: 30,
  ai_inferred: 14,
};

/** 排序基准分：来源越可信底分越高 */
const SOURCE_WEIGHT: Record<ElementHintSource, number> = {
  manual: 100,
  user_pick: 100,
  ai_success: 60,
  ai_inferred: 30,
};

/** 单 hostname 保留条数上限，超出按分数从低到高淘汰 */
export const MAX_HINTS_PER_HOSTNAME = 60;

/** 连续定位失败多少次就判这条失效（站点改版的典型表现） */
export const MAX_STALE_HITS = 3;

/** 新鲜度减半所需天数：14 天前用过的条目权重打对折，28 天前打到四分之一 */
const FRESHNESS_HALF_LIFE_DAYS = 14;

/**
 * 优先级评分（越大越优先注入）。置顶条目返回 Infinity。
 *
 * 公式：(来源权重 + min(useCount, 10) × 5) × 0.5^(闲置天数 / 14)
 *
 * useCount 加成刻意封顶在 10 次：再往上加只会让老条目单靠累积次数把新条目永久挤出去，
 * 而"用过 30 次"和"用过 10 次"对当下这一步该点哪里并没有区别。
 * 新鲜度用指数衰减而非硬阈值，是为了让排序连续 —— 昨天和前天用过的条目不该有断崖差距。
 */
export function scoreHint(hint: ElementHint, now: number = Date.now()): number {
  if (hint.pinned) return Number.POSITIVE_INFINITY;

  const base = SOURCE_WEIGHT[hint.source] ?? 30;
  const usage = Math.min(hint.useCount ?? 0, 10) * 5;
  const idleDays = Math.max(0, (now - (hint.lastUsedAt ?? hint.createdAt ?? now)) / DAY_MS);
  const freshness = Math.pow(0.5, idleDays / FRESHNESS_HALF_LIFE_DAYS);

  return (base + usage) * freshness;
}

/**
 * 这条 hint 是否该淘汰。置顶的永不过期。
 *
 * 两条独立判据：TTL 到期（存进来之后长期没用）、连续定位失败（站点大概改版了）。
 */
export function isHintExpired(hint: ElementHint, now: number = Date.now()): boolean {
  if (hint.pinned) return false;
  if ((hint.staleHits ?? 0) >= MAX_STALE_HITS) return true;

  const ttlDays = HINT_TTL_DAYS[hint.source] ?? HINT_TTL_DAYS.ai_inferred;
  const anchor = hint.lastUsedAt ?? hint.createdAt ?? now;
  return now - anchor > ttlDays * DAY_MS;
}

/**
 * 过滤过期 + 按优先级降序。读取路径统一走这里，保证 prompt 注入、侧边栏 @ 引用、
 * 闸门记忆查询看到的是同一套顺序 —— 三处各自排序的话，用户在 @ 面板里看到的
 * 第一条未必是真正注入给 LLM 的那条，排查问题会很困惑。
 */
export function sortHintsByPriority(hints: ElementHint[], now: number = Date.now()): ElementHint[] {
  return hints.filter(h => !isHintExpired(h, now)).sort((a, b) => scoreHint(b, now) - scoreHint(a, now));
}

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
  /**
   * 取某 hostname 可用的 hints：已剔除过期项、按优先级降序。为空返回空数组。
   * 想看包含过期项的原始数据（管理 UI 审计用）走 `listBuckets`。
   */
  getByHostname: (hostname: string) => Promise<ElementHint[]>;
  /** 列出所有 hostname bucket（含过期项，供管理 UI 审计），按 updatedAt 倒序 */
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
  /** Hint 被 LLM 复用一次（useCount +1, lastUsedAt 刷新, staleHits 归零） */
  touchHint: (hostname: string, id: string) => Promise<void>;
  /**
   * 这条 hint 的定位失败了一次（staleHits +1）。累计到 MAX_STALE_HITS 后读取时会被判过期。
   * 站点改版时 TTL 还远没到，靠这个才能及时把失效条目从注入名额里挤出去。
   */
  markHintStale: (hostname: string, id: string) => Promise<void>;
  /** 置顶/取消置顶：置顶条目永不过期且优先注入 */
  setHintPinned: (hostname: string, id: string, pinned: boolean) => Promise<void>;
  /** 删除单条 */
  removeHint: (hostname: string, id: string) => Promise<void>;
  /** 清空某 hostname */
  clearHostname: (hostname: string) => Promise<void>;
  /** 清空全部 */
  resetAll: () => Promise<void>;
  /**
   * 立刻清掉所有过期条目，返回删除条数。
   *
   * 平时写入时会顺带清理，这个方法是给管理 UI 的手动按钮用的 —— 用户看到列表里
   * 标着「已过期」的条目会想立刻清掉，而不是等下一次 AI 写入时自然发生。
   */
  pruneExpired: () => Promise<number>;
};

/**
 * 清过期 + 限容。写入路径统一走这里。
 *
 * 顺序很重要：先清过期再限容。反过来的话，一批过期条目会先把容量占满、把新鲜条目
 * 挤掉，然后自己再被清掉，白白丢数据。
 */
function pruneHints(hints: ElementHint[], now: number): ElementHint[] {
  const alive = hints.filter(h => !isHintExpired(h, now));
  if (alive.length <= MAX_HINTS_PER_HOSTNAME) return alive;
  return [...alive].sort((a, b) => scoreHint(b, now) - scoreHint(a, now)).slice(0, MAX_HINTS_PER_HOSTNAME);
}

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
    // 只过滤不落盘：TTL 常量以后调大时，被"暂时判过期"的数据还能回来
    return sortHintsByPriority(cfg.buckets[hostname]?.hints ?? []);
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
        // 老条目可能是加 stableSelector 之前入库的 —— 后来拾取到了就补上
        stableSelector: hint.stableSelector || existing.stableSelector,
        lastUsedAt: now,
        useCount: existing.useCount + 1,
        // 又成功用上了 → 之前的失效计数不再成立（可能是临时的加载时序问题）
        staleHits: 0,
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
    // 限容时刚写入的这条必然分数够高（lastUsedAt = now，衰减为 1），不会被自己挤掉
    const nextBucket: ElementHintsBucket = { hostname, hints: pruneHints(nextHints, now), updatedAt: now };
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
          // 老条目可能是加 stableSelector 之前入库的 —— 后来拾取到了就补上
          stableSelector: hint.stableSelector || existing.stableSelector,
          // source 不覆盖：保留原始来源（已经是 user_pick 的不会被 ai_inferred 降级）
          lastUsedAt: now,
          useCount: existing.useCount + 1,
          staleHits: 0,
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

    const nextBucket: ElementHintsBucket = { hostname, hints: pruneHints(workingHints, now), updatedAt: now };
    await storage.set({ ...cfg, buckets: { ...cfg.buckets, [hostname]: nextBucket } });
    return results;
  },

  async touchHint(hostname, id) {
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    const bucket = cfg.buckets[hostname];
    if (!bucket) return;
    const now = Date.now();
    const hints = bucket.hints.map(h =>
      h.id === id ? { ...h, lastUsedAt: now, useCount: h.useCount + 1, staleHits: 0 } : h,
    );
    await storage.set({
      ...cfg,
      buckets: { ...cfg.buckets, [hostname]: { ...bucket, hints: pruneHints(hints, now), updatedAt: now } },
    });
  },

  async markHintStale(hostname, id) {
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    const bucket = cfg.buckets[hostname];
    if (!bucket) return;
    const now = Date.now();
    // 只累加计数，不动 lastUsedAt —— 失败不算"用过"，否则会反过来延长它的 TTL
    const hints = bucket.hints.map(h => (h.id === id ? { ...h, staleHits: (h.staleHits ?? 0) + 1 } : h));
    await storage.set({
      ...cfg,
      buckets: { ...cfg.buckets, [hostname]: { ...bucket, hints: pruneHints(hints, now), updatedAt: now } },
    });
  },

  async setHintPinned(hostname, id, pinned) {
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    const bucket = cfg.buckets[hostname];
    if (!bucket) return;
    const now = Date.now();
    // 置顶顺带清掉失效计数：用户明确说这条要留着，之前的失败判定作废
    const hints = bucket.hints.map(h => (h.id === id ? { ...h, pinned, staleHits: pinned ? 0 : h.staleHits } : h));
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

  async pruneExpired() {
    const cfg = (await storage.get()) || DEFAULT_ELEMENT_HINTS_CONFIG;
    const now = Date.now();
    const buckets: Record<string, ElementHintsBucket> = {};
    let removed = 0;

    for (const [hostname, bucket] of Object.entries(cfg.buckets)) {
      const kept = pruneHints(bucket.hints, now);
      removed += bucket.hints.length - kept.length;
      // 整个 bucket 清空了就连 key 一起删，别在存储里留一堆空壳 hostname
      if (kept.length > 0) {
        buckets[hostname] = {
          ...bucket,
          hints: kept,
          updatedAt: kept.length === bucket.hints.length ? bucket.updatedAt : now,
        };
      }
    }

    if (removed > 0) await storage.set({ ...cfg, buckets });
    return removed;
  },
};
