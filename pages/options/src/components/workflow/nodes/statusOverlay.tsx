/**
 * Shared execution-status visual primitives for workflow nodes.
 * Each node renders a ring effect and badge based on the runtime execution status.
 */
import type { NodeProps } from '@xyflow/react';
import type { FlowNode, NodeStatus } from '../types';

/**
 * Returns Tailwind classes for the outer-ring effect based on execution status.
 */
export function getStatusRingClass(status: NodeStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'ring-2 ring-blue-400 ring-offset-1 animate-pulse';
    case 'ok':
      return 'ring-2 ring-green-500 ring-offset-1';
    case 'fail':
      return 'ring-2 ring-red-500 ring-offset-1';
    default:
      return '';
  }
}

/**
 * Small badge shown at the top-right corner of a node during/after execution.
 */
export function StatusBadge({ status }: { status: NodeStatus | undefined }) {
  if (!status || status === 'idle') return null;

  if (status === 'running') {
    return (
      <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-white shadow-sm dark:bg-slate-800">
        <span className="size-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </span>
    );
  }

  if (status === 'ok') {
    return (
      <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-green-500 text-white shadow-sm">
        <svg className="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M2.5 6.5L5 9L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  // fail
  return (
    <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm">
      <svg className="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M3 3L9 9M9 3L3 9" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * Shallow-compare for React.memo on custom nodes.
 * Compares `selected` + `data` reference (cheap when React Flow internally re-uses objects).
 */
export function areNodePropsEqual(prev: NodeProps<FlowNode>, next: NodeProps<FlowNode>): boolean {
  if (prev.selected !== next.selected) return false;
  if (prev.data === next.data) return true;
  // Shallow compare data keys
  const pd = prev.data;
  const nd = next.data;
  const keys = Object.keys(nd);
  if (keys.length !== Object.keys(pd).length) return false;
  for (const k of keys) {
    if ((pd as Record<string, unknown>)[k] !== (nd as Record<string, unknown>)[k]) return false;
  }
  return true;
}
