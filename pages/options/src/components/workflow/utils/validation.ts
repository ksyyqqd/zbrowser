import type { Connection } from '@xyflow/react';
import type { FlowNode, FlowEdge } from '../types';

/**
 * Validate a proposed connection between two handles.
 * Rules:
 *  - No self-loop
 *  - `end` node cannot be source
 *  - `start` node cannot be target
 *  - Each source handle allows only one outgoing edge (condition node's per-branch handles included)
 */
export function isValidConnectionFor(conn: Connection | FlowEdge, nodes: FlowNode[], edges: FlowEdge[]): boolean {
  if (!conn.source || !conn.target) return false;
  if (conn.source === conn.target) return false;
  const src = nodes.find(n => n.id === conn.source);
  const tgt = nodes.find(n => n.id === conn.target);
  if (!src || !tgt) return false;
  if (src.type === 'end') return false;
  if (tgt.type === 'start') return false;
  if (src.type !== 'condition') {
    const exists = edges.some(e => e.source === conn.source && e.sourceHandle === conn.sourceHandle);
    if (exists) return false;
  } else if (conn.sourceHandle) {
    const exists = edges.some(e => e.source === conn.source && e.sourceHandle === conn.sourceHandle);
    if (exists) return false;
  }
  return true;
}
