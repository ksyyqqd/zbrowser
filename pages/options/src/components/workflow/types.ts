import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';
import type { NodeData, WorkflowNodeType, Workflow } from '@extension/workflow';

/**
 * React Flow v12 requires node data to satisfy Record<string, unknown>.
 * Extend WorkflowNode.data with the index signature plus runtime UI fields.
 */
export type FlowNodeData = NodeData & {
  name?: string;
  type?: WorkflowNodeType;
  /** Runtime execution status injected from ExecutionState (not persisted) */
  _executionStatus?: NodeStatus;
  [key: string]: unknown;
};

export type FlowNode = RFNode<FlowNodeData>;
export type FlowEdge = RFEdge;

/** Per-node execution status used to render visual feedback on the canvas */
export type NodeStatus = 'idle' | 'running' | 'ok' | 'fail';

/** Snapshot of an in-flight (or recently finished) workflow execution */
export interface ExecutionState {
  workflowId: string | null;
  currentNodeId: string | null;
  nodeStatus: Record<string, NodeStatus>;
  status: 'idle' | 'running' | 'completed' | 'failed';
}

export interface WorkflowEditorProps {
  workflow?: Workflow;
  onSave: (workflow: Workflow) => void;
  onCancel: () => void;
  isDarkMode?: boolean;
  /** Optional execution state used to highlight node progress on the canvas */
  executionState?: ExecutionState;
}
