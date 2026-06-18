import { MarkerType } from '@xyflow/react';
import type { WorkflowNode, WorkflowEdge, WorkflowNodeType, NodeData } from '@extension/workflow';
import type { FlowNode, FlowEdge } from '../types';

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
