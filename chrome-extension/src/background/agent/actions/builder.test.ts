import { describe, expect, it } from 'vitest';
import { resolveElementNodeForAction } from './builder';
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

  it('returns undefined when xpath is provided but no exact match exists', () => {
    const staleNode = node('/html/body/button[1]');
    const selectorMap = new Map<number, DOMElementNode>([[1, staleNode]]);

    const result = resolveElementNodeForAction(selectorMap, 1, undefined, '/html/body/button[2]');

    expect(result).toBeUndefined();
  });
});
