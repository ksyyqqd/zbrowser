import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FiPlay } from 'react-icons/fi';
import type { FlowNode, NodeStatus } from '../types';
import { HANDLE_STYLE_BASE } from './handleStyle';
import { getStatusRingClass, StatusBadge, areNodePropsEqual } from './statusOverlay';

function StartNodeImpl({ data, selected }: NodeProps<FlowNode>) {
  const status = data._executionStatus as NodeStatus | undefined;
  const statusRing = getStatusRingClass(status);
  return (
    <div
      className={`relative flex size-11 items-center justify-center rounded-full text-white shadow-lg transition-all duration-150 ${
        selected
          ? 'bg-green-400 shadow-green-400/30 ring-2 ring-blue-400 ring-offset-1'
          : `bg-gradient-to-br from-green-400 to-green-500 hover:scale-[1.06] ${statusRing}`
      }`}>
      <FiPlay className="size-5" />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ ...HANDLE_STYLE_BASE, background: '#22c55e' }}
      />
      <StatusBadge status={status} />
    </div>
  );
}

export const StartNode = memo(StartNodeImpl, areNodePropsEqual);
