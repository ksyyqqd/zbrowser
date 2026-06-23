import { MarkerType } from '@xyflow/react';
import type { WorkflowNode, WorkflowEdge, WorkflowNodeType, NodeData } from '@extension/workflow';
import type { FlowNode, FlowEdge } from '../types';

/**
 * Loop "continue" edge — bezier curve, dashed, animated, green.
 * This is the loop-back from the loop node into the start of the body.
 */
export const LOOP_CONTINUE_EDGE_STYLE = {
  stroke: '#22c55e',
  strokeWidth: 2.5,
  strokeDasharray: '6 4',
};

/** Loop "exit" edge — bezier curve, solid, red. Where the loop hands off downstream. */
export const LOOP_EXIT_EDGE_STYLE = {
  stroke: '#ef4444',
  strokeWidth: 2,
};

/**
 * Pick a React Flow edge type + style based on the source node's type / port.
 * Only edges going OUT of a loop node get the special bezier styling — edges
 * going INTO a loop node (its left target handle) stay on the default
 * smoothstep style, because that's just normal main-flow wiring entering the
 * loop from upstream:
 *  - loop --continue--> body start   : dashed green bezier (animated)
 *  - loop --exit-->     downstream   : solid  red   bezier
 * Implicit body-return is handled by the executor's loop stack — no manual
 * return edge is required, so we no longer style "target = loop" specially.
 */
export function applyEdgeStyle(edge: FlowEdge, sourceType?: WorkflowNodeType): FlowEdge {
  if (sourceType === 'loop') {
    if (edge.sourceHandle === 'continue') {
      return {
        ...edge,
        type: 'bezier',
        animated: true,
        style: { ...(edge.style || {}), ...LOOP_CONTINUE_EDGE_STYLE },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: LOOP_CONTINUE_EDGE_STYLE.stroke },
      };
    }
    if (edge.sourceHandle === 'exit') {
      return {
        ...edge,
        type: 'bezier',
        style: { ...(edge.style || {}), ...LOOP_EXIT_EDGE_STYLE },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: LOOP_EXIT_EDGE_STYLE.stroke },
      };
    }
  }
  return edge;
}

export function toFlowNode(n: WorkflowNode): FlowNode {
  // Strip any runtime-only fields that may have leaked into storage (e.g. _executionStatus)
  // so old executions don't "haunt" the canvas on next load
  const { _executionStatus: _ignored, ...cleanData } = (n.data || {}) as Record<string, unknown>;
  return {
    id: n.id,
    type: n.type,
    position: n.position ?? { x: 100, y: 100 },
    data: { ...cleanData, name: n.name || n.id, type: n.type },
  };
}

export function toFlowEdge(e: WorkflowEdge): FlowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourcePort,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  };
}

export function toWorkflowNode(n: FlowNode): WorkflowNode {
  // Strip runtime-only UI state (_executionStatus, selected) before persisting
  const { name, type: dataType, _executionStatus: _statusIgnored, selected: _selIgnored, ...restData } = n.data || {};
  const nodeType = (n.type || dataType || 'automation') as WorkflowNodeType;
  return {
    id: n.id,
    type: nodeType,
    name: (name as string) || n.id,
    position: n.position,
    data: { ...restData, type: nodeType, name } as NodeData,
  };
}

export function toWorkflowEdge(e: FlowEdge): WorkflowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourcePort: e.sourceHandle ?? undefined,
  };
}
