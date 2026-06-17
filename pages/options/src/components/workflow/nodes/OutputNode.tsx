import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FiFileText } from 'react-icons/fi';
import type { FlowNode, NodeStatus } from '../types';
import { HANDLE_STYLE_BASE } from './handleStyle';
import { getStatusRingClass, StatusBadge, areNodePropsEqual } from './statusOverlay';

function OutputNodeImpl({ data, selected }: NodeProps<FlowNode>) {
  const status = data._executionStatus as NodeStatus | undefined;
  const statusRing = getStatusRingClass(status);
  const label = (data.label as string) || (data.name as string) || 'Output';
  return (
    <div
      className={`relative flex min-w-[160px] items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-white shadow-lg transition-all duration-150 ${
        selected
          ? 'bg-gradient-to-r from-teal-400 to-teal-500 shadow-blue-400/30 ring-2 ring-blue-400 ring-offset-1'
          : `bg-gradient-to-r from-teal-500 to-teal-600 hover:scale-[1.03] ${statusRing}`
      }`}>
      <Handle type="target" position={Position.Left} id="in" style={{ ...HANDLE_STYLE_BASE, background: '#14b8a6' }} />
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
        <FiFileText className="size-4" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold leading-tight">输出</span>
        <span className="max-w-[110px] truncate text-xs opacity-75">{label}</span>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

export const OutputNode = memo(OutputNodeImpl, areNodePropsEqual);
