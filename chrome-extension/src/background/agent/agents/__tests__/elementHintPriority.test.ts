import { describe, expect, it } from 'vitest';
import {
  scoreHint,
  isHintExpired,
  sortHintsByPriority,
  HINT_TTL_DAYS,
  MAX_STALE_HITS,
  type ElementHint,
  type ElementHintSource,
} from '@extension/storage';

/**
 * 元素记忆的优先级评分与过期判定。
 *
 * 这两件事决定了「注入给 LLM 的那几条是哪几条」——prompt 里写的是「优先用它的
 * selector 不要另猜」，所以排错人会直接把 AI 带偏。测试重点不是公式的具体数值，
 * 而是那几条会真实出问题的相对关系。
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 15);

function hint(over: Partial<ElementHint> & { source?: ElementHintSource } = {}): ElementHint {
  return {
    id: Math.random().toString(36).slice(2),
    purpose: '提交按钮',
    selector: '#submit',
    source: 'ai_success',
    createdAt: NOW,
    lastUsedAt: NOW,
    useCount: 1,
    ...over,
  };
}

describe('scoreHint', () => {
  it('同等新鲜度下用户拾取压过 AI 推测', () => {
    const picked = hint({ source: 'user_pick' });
    const inferred = hint({ source: 'ai_inferred' });

    expect(scoreHint(picked, NOW)).toBeGreaterThan(scoreHint(inferred, NOW));
  });

  it('刚用过的新条目能压过很久没用的高频老条目', () => {
    // 这是改成加权排序的直接动因：老条目单靠 useCount 会永久占着注入名额，
    // 而站点早就改版了；用户昨天刚教的那条 useCount=1 反而挤不进去。
    const staleVeteran = hint({ source: 'ai_success', useCount: 20, lastUsedAt: NOW - 120 * DAY });
    const freshRookie = hint({ source: 'user_pick', useCount: 1, lastUsedAt: NOW });

    expect(scoreHint(freshRookie, NOW)).toBeGreaterThan(scoreHint(staleVeteran, NOW));
  });

  it('useCount 加成封顶，用过 30 次不比用过 10 次更优先', () => {
    const ten = hint({ useCount: 10 });
    const thirty = hint({ useCount: 30 });

    expect(scoreHint(thirty, NOW)).toBe(scoreHint(ten, NOW));
  });

  it('闲置一个半衰期后分数减半', () => {
    const fresh = hint({ useCount: 0 });
    const idle = hint({ useCount: 0, lastUsedAt: NOW - 14 * DAY });

    expect(scoreHint(idle, NOW)).toBeCloseTo(scoreHint(fresh, NOW) / 2, 5);
  });

  it('置顶直接返回 Infinity，压过一切', () => {
    const pinned = hint({ source: 'ai_inferred', useCount: 0, lastUsedAt: NOW - 300 * DAY, pinned: true });

    expect(scoreHint(pinned, NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(scoreHint(pinned, NOW)).toBeGreaterThan(scoreHint(hint({ source: 'user_pick', useCount: 99 }), NOW));
  });

  it('缺 lastUsedAt 的老数据回退到 createdAt，不会变成 NaN', () => {
    const legacy = { ...hint({ createdAt: NOW - 7 * DAY }), lastUsedAt: undefined } as unknown as ElementHint;

    expect(Number.isFinite(scoreHint(legacy, NOW))).toBe(true);
  });
});

describe('isHintExpired', () => {
  it('一直在用的条目不过期，哪怕存进来很久了', () => {
    // TTL 从 lastUsedAt 起算而非 createdAt：常用元素不该因为「记了半年」被淘汰
    const old = hint({ source: 'ai_inferred', createdAt: NOW - 300 * DAY, lastUsedAt: NOW - 1 * DAY });

    expect(isHintExpired(old, NOW)).toBe(false);
  });

  it('按来源用不同 TTL：AI 推测比用户拾取先过期', () => {
    const idle = 20 * DAY; // 落在 ai_inferred(14) 之后、user_pick(90) 之前
    expect(isHintExpired(hint({ source: 'ai_inferred', lastUsedAt: NOW - idle }), NOW)).toBe(true);
    expect(isHintExpired(hint({ source: 'user_pick', lastUsedAt: NOW - idle }), NOW)).toBe(false);
  });

  it('TTL 边界内不算过期', () => {
    const justInside = hint({ source: 'ai_success', lastUsedAt: NOW - (HINT_TTL_DAYS.ai_success * DAY - 1000) });

    expect(isHintExpired(justInside, NOW)).toBe(false);
  });

  it('连续定位失败到上限即判过期（站点改版）', () => {
    // 改版后 selector 稳定失败，但 lastUsedAt 不动、TTL 还差几十天，
    // 中间这段时间它照样占着注入名额误导 LLM，所以要有这条独立判据。
    expect(isHintExpired(hint({ staleHits: MAX_STALE_HITS - 1 }), NOW)).toBe(false);
    expect(isHintExpired(hint({ staleHits: MAX_STALE_HITS }), NOW)).toBe(true);
  });

  it('置顶的既不受 TTL 也不受失效计数影响', () => {
    const pinned = hint({
      source: 'ai_inferred',
      lastUsedAt: NOW - 500 * DAY,
      staleHits: MAX_STALE_HITS + 5,
      pinned: true,
    });

    expect(isHintExpired(pinned, NOW)).toBe(false);
  });
});

describe('sortHintsByPriority', () => {
  it('剔除过期项并按分数降序', () => {
    const expired = hint({ purpose: '过期', source: 'ai_inferred', lastUsedAt: NOW - 60 * DAY });
    const low = hint({ purpose: '低', source: 'ai_inferred', useCount: 1 });
    const high = hint({ purpose: '高', source: 'user_pick', useCount: 5 });

    const out = sortHintsByPriority([expired, low, high], NOW);

    expect(out.map(h => h.purpose)).toEqual(['高', '低']);
  });

  it('置顶排最前，即使它本来该过期', () => {
    const pinned = hint({ purpose: '置顶', source: 'ai_inferred', lastUsedAt: NOW - 90 * DAY, pinned: true });
    const normal = hint({ purpose: '常规', source: 'user_pick', useCount: 10 });

    expect(sortHintsByPriority([normal, pinned], NOW).map(h => h.purpose)).toEqual(['置顶', '常规']);
  });

  it('空数组和全过期都返回空，不抛', () => {
    expect(sortHintsByPriority([], NOW)).toEqual([]);
    expect(sortHintsByPriority([hint({ source: 'ai_inferred', lastUsedAt: NOW - 99 * DAY })], NOW)).toEqual([]);
  });
});
