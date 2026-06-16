import dagre from 'dagre';
import type { FlowNode, FlowEdge } from '../types';

const NODE_WIDTH_DEFAULT = 180;
const NODE_HEIGHT_DEFAULT = 60;
const NODE_WIDTH_SMALL = 50;
const NODE_HEIGHT_SMALL = 50;

export function getLayoutedElements(nodes: FlowNode[], edges: FlowEdge[]): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 40, marginy: 40 });
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
