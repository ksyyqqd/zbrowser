import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FiCpu } from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { FlowNode, NodeStatus } from '../types';
import { HANDLE_STYLE_BASE } from './handleStyle';
import { getStatusRingClass, StatusBadge, areNodePropsEqual } from './statusOverlay';

function AINodeImpl({ data, selected }: NodeProps<FlowNode>) {
  const status = data._executionStatus as NodeStatus | undefined;
  const statusRing = getStatusRingClass(status);
  const selectedRing = selected ? 'ring-2 ring-blue-400 ring-offset-1 shadow-blue-400/30' : '';
  return (
    <div
      className={`relative flex min-w-[160px] items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-white shadow-lg transition-all duration-150 ${
        selected
          ? `bg-gradient-to-r from-purple-400 to-purple-500 ${selectedRing}`
          : `bg-gradient-to-r from-purple-500 to-purple-600 hover:scale-[1.03] ${statusRing}`
      }`}>
      <Handle type="target" position={Position.Left} id="in" style={{ ...HANDLE_STYLE_BASE, background: '#9333ea' }} />
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
        <FiCpu className="size-4" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="max-w-[140px] truncate text-sm font-semibold leading-tight">
          {(data.name as string) || t('workflow_nodeType_ai')}
        </span>
        <span className="max-w-[140px] truncate text-xs opacity-75">
          {(data.prompt as string)?.slice(0, 30) || t('workflow_nodeType_ai_default')}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ ...HANDLE_STYLE_BASE, background: '#9333ea' }}
      />
      <StatusBadge status={status} />
    </div>
  );
}

export const AINode = memo(AINodeImpl, areNodePropsEqual);
