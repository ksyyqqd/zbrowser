import { describe, expect, it } from 'vitest';
import { resolveElementNodeForAction } from './builder';
import { clickElementActionSchema } from './schemas';
import { DOMElementNode } from '@src/background/browser/dom/views';

function node(xpath: string, highlightIndex?: number): DOMElementNode {
  return new DOMElementNode({
    tagName: 'button',
    xpath,
    attributes: {},
    children: [],
    isVisible: true,
    isInteractive: true,
    isTopElement: true,
    isInViewport: true,
    highlightIndex: highlightIndex ?? null,
  });
}

describe('resolveElementNodeForAction', () => {
  it('prefers an exact xpath match over a stale index', () => {
    const staleNode = node('/html/body/button[1]');
    const rememberedNode = node('/html/body/button[2]');
    const selectorMap = new Map<number, DOMElementNode>([
      [1, staleNode],
      [2, rememberedNode],
    ]);

    const result = resolveElementNodeForAction(selectorMap, 1, undefined, '/html/body/button[2]');

    expect(result).toBe(rememberedNode);
  });

  it('returns element by index when no xpath is provided', () => {
    const targetNode = node('/html/body/button[1]');
    const selectorMap = new Map<number, DOMElementNode>([[1, targetNode]]);

    const result = resolveElementNodeForAction(selectorMap, 1);

    expect(result).toBe(targetNode);
  });

  it('returns undefined when index and xpath are both missing', () => {
    const selectorMap = new Map<number, DOMElementNode>();

    const result = resolveElementNodeForAction(selectorMap, undefined as unknown as number);

    expect(result).toBeUndefined();
  });

  it('falls back to index when the xpath matches nothing', () => {
    // 回归用例：模型命中事实库时常同时给出 xpath 和 index，而它写的 xpath 格式未必跟
    // DOMElementNode.xpath 对得上。旧实现「xpath 非空就 return」，可用的 index 被彻底忽略，
    // 最后拿一条对不上的 xpath 去 document.evaluate —— 常常解析出别的节点并点下去，
    // 动作报成功但点错了元素（表现为「点击了错误的发送按钮」）。
    const indexedNode = node('/html/body/button[1]');
    const selectorMap = new Map<number, DOMElementNode>([[1, indexedNode]]);

    const result = resolveElementNodeForAction(selectorMap, 1, undefined, '/html/body[1]/div[9]/button[7]');

    expect(result).toBe(indexedNode);
  });

  it('returns undefined when neither the xpath nor the index resolves', () => {
    const selectorMap = new Map<number, DOMElementNode>([[1, node('/html/body/button[1]')]]);

    const result = resolveElementNodeForAction(selectorMap, 42, undefined, '/html/body/button[2]');

    expect(result).toBeUndefined();
  });

  it('matches a stored xpath that has no leading slash', () => {
    // 事实库存的是 buildDomTree.js/getXPathTree 的产出，不带前导斜杠
    const target = node('/html/body/div/button[2]');
    const selectorMap = new Map<number, DOMElementNode>([[3, target]]);

    expect(resolveElementNodeForAction(selectorMap, undefined, undefined, 'html/body/div/button[2]')).toBe(target);
  });

  it('matches across the two [1]-index conventions', () => {
    // getXPathTree 在「同名兄弟仅一个」时省略 [n]；模型则倾向每层都补 [1]。两者指向同一节点。
    const target = node('html/body/div[1]/div/div[2]/button');
    const selectorMap = new Map<number, DOMElementNode>([[5, target]]);

    const result = resolveElementNodeForAction(
      selectorMap,
      undefined,
      undefined,
      '/html[1]/body[1]/div[1]/div[1]/div[2]/button[1]',
    );

    expect(result).toBe(target);
  });

  it('does not conflate siblings at index 2 or above', () => {
    const first = node('/html/body/div/button');
    const second = node('/html/body/div/button[2]');
    const selectorMap = new Map<number, DOMElementNode>([
      [1, first],
      [2, second],
    ]);

    expect(resolveElementNodeForAction(selectorMap, undefined, undefined, '/html/body/div/button[2]')).toBe(second);
    expect(resolveElementNodeForAction(selectorMap, undefined, undefined, '/html/body/div/button[1]')).toBe(first);
  });
});

describe('clickElementActionSchema', () => {
  it('accepts a locator-only action with no index', () => {
    // 命中事实库的元素往往没有 highlightIndex，模型只能给出 xpath。schema 曾强制要求
    // index，导致照提示词执行的模型被打回（action.0.click_element.index: Required）。
    const parsed = clickElementActionSchema.schema.parse({
      intent: '点击发送按钮',
      xpath: 'html/body/div[1]/div/div[2]/div[3]',
    });

    expect(parsed.xpath).toBe('html/body/div[1]/div/div[2]/div[3]');
    expect(parsed.index).toBeUndefined();
  });

  it('still accepts an index-only action', () => {
    const parsed = clickElementActionSchema.schema.parse({ intent: '点击', index: 27 });

    expect(parsed.index).toBe(27);
  });
});
