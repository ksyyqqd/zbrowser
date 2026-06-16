import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FiXCircle } from 'react-icons/fi';
import type { FlowNode, NodeStatus } from '../types';
import { HANDLE_STYLE_BASE } from './handleStyle';
import { getStatusRingClass, StatusBadge, areNodePropsEqual } from './statusOverlay';

function EndNodeImpl({ data, selected }: NodeProps<FlowNode>) {
  const status = data._executionStatus as NodeStatus | undefined;
  const statusRing = getStatusRingClass(status);
  return (
    <div
      className={`relative flex size-11 items-center justify-center rounded-full text-white shadow-lg transition-all duration-150 ${
        selected
          ? 'bg-red-400 shadow-red-400/30 ring-2 ring-blue-400 ring-offset-1'
          : `bg-gradient-to-br from-red-400 to-red-500 hover:scale-[1.06] ${statusRing}`
      }`}>
      <Handle type="target" position={Position.Left} id="in" style={{ ...HANDLE_STYLE_BASE, background: '#ef4444' }} />
      <FiXCircle className="size-5" />
      <StatusBadge status={status} />
    </div>
  );
}

export const EndNode = memo(EndNodeImpl, areNodePropsEqual);
