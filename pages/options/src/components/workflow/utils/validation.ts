import type { Connection } from '@xyflow/react';
import type { FlowNode, FlowEdge } from '../types';

/**
 * Validate a proposed connection between two handles.
 * Rules:
 *  - No self-loop
 *  - `end` node cannot be source
 *  - `output` node cannot be source (terminal collector, no outgoing edges)
 *  - `start` node cannot be target
 *  - Each source handle allows one "main-flow" outgoing edge
 *    (edges going TO an output node don't count — output is a side collector)
 *  - Condition node: one outgoing edge per branch handle
 */
export function isValidConnectionFor(conn: Connection | FlowEdge, nodes: FlowNode[], edges: FlowEdge[]): boolean {
  if (!conn.source || !conn.target) return false;
  if (conn.source === conn.target) return false;
  const src = nodes.find(n => n.id === conn.source);
  const tgt = nodes.find(n => n.id === conn.target);
  if (!src || !tgt) return false;
  if (src.type === 'end') return false;
  if (src.type === 'output') return false;
  if (tgt.type === 'start') return false;

  // Connections TO an output node are "side branches" — always allowed
  // (no single-edge limit, since they don't affect main execution flow).
  if (tgt.type === 'output') return true;

  // For main-flow connections: each source handle allows only one outgoing main edge.
  // Existing edges to output nodes don't count.
  const outputNodeIds = new Set(nodes.filter(n => n.type === 'output').map(n => n.id));
  if (src.type !== 'condition') {
    const mainEdgeExists = edges.some(
      e => e.source === conn.source && e.sourceHandle === conn.sourceHandle && !outputNodeIds.has(e.target),
    );
    if (mainEdgeExists) return false;
  } else if (conn.sourceHandle) {
    const mainEdgeExists = edges.some(
      e => e.source === conn.source && e.sourceHandle === conn.sourceHandle && !outputNodeIds.has(e.target),
    );
    if (mainEdgeExists) return false;
  }
  return true;
}
