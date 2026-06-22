import dagre from 'dagre';
import type { FlowNode, FlowEdge } from '../types';

const NODE_WIDTH_DEFAULT = 180;
const NODE_HEIGHT_DEFAULT = 60;
const NODE_WIDTH_SMALL = 50;
const NODE_HEIGHT_SMALL = 50;

export type LayoutDirection = 'LR' | 'TB' | 'auto';

/**
 * Pick a direction automatically:
 *  - Linear / chain workflows (every node has at most 1 out-edge, no branches)
 *    with more than 6 nodes → vertical (TB), so they don't stretch the canvas.
 *  - Workflows with branches (condition nodes, multiple out-edges) → horizontal
 *    (LR) so branches read naturally side-by-side.
 *  - Small linear workflows → horizontal (LR), classic look.
 */
function pickDirection(nodes: FlowNode[], edges: FlowEdge[]): 'LR' | 'TB' {
  if (nodes.length <= 6) return 'LR';
  const outCount = new Map<string, number>();
  for (const e of edges) outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1);
  const hasBranches = Array.from(outCount.values()).some(c => c > 1);
  if (hasBranches) return 'LR';
  // Long linear chain — go vertical
  return 'TB';
}

export function getLayoutedElements(
  nodes: FlowNode[],
  edges: FlowEdge[],
  direction: LayoutDirection = 'auto',
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const rankdir = direction === 'auto' ? pickDirection(nodes, edges) : direction;
  const g = new dagre.graphlib.Graph();
  // Tighter ranksep for vertical layouts so long chains stay compact in the
  // viewport; horizontal layouts keep more room so labels don't overlap.
  const isVertical = rankdir === 'TB';
  g.setGraph({
    rankdir,
    nodesep: isVertical ? 40 : 60,
    ranksep: isVertical ? 60 : 120,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(node => {
    const isSmall = node.type === 'start' || node.type === 'end';
    g.setNode(node.id, {
      width: isSmall ? NODE_WIDTH_SMALL : NODE_WIDTH_DEFAULT,
      height: isSmall ? NODE_HEIGHT_SMALL : NODE_HEIGHT_DEFAULT,
    });
  });

  edges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);

  const layoutedNodes = nodes.map(node => {
    const pos = g.node(node.id);
    const isSmall = node.type === 'start' || node.type === 'end';
    const w = isSmall ? NODE_WIDTH_SMALL : NODE_WIDTH_DEFAULT;
    const h = isSmall ? NODE_HEIGHT_SMALL : NODE_HEIGHT_DEFAULT;
    return { ...node, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
  });

  return { nodes: layoutedNodes, edges };
}
