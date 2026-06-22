import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FiMousePointer } from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { FlowNode, NodeStatus } from '../types';
import { HANDLE_STYLE_BASE } from './handleStyle';
import { getStatusRingClass, StatusBadge, areNodePropsEqual } from './statusOverlay';

function AutomationNodeImpl({ data, selected }: NodeProps<FlowNode>) {
  const status = data._executionStatus as NodeStatus | undefined;
  const statusRing = getStatusRingClass(status);
  return (
    <div
      className={`relative flex min-w-[160px] items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-white shadow-lg transition-all duration-150 ${
        selected
          ? 'bg-gradient-to-r from-blue-400 to-blue-500 shadow-blue-400/30 ring-2 ring-blue-400 ring-offset-1'
          : `bg-gradient-to-r from-blue-500 to-blue-600 hover:scale-[1.03] ${statusRing}`
      }`}>
      <Handle type="target" position={Position.Left} id="in" style={{ ...HANDLE_STYLE_BASE, background: '#3b82f6' }} />
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
        <FiMousePointer className="size-4" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="max-w-[140px] truncate text-sm font-semibold leading-tight">
          {(data.name as string) || t('workflow_nodeType_automation')}
        </span>
        <span className="max-w-[140px] truncate text-xs opacity-75">
          {(data.action as string) || t('workflow_nodeType_automation_default')}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ ...HANDLE_STYLE_BASE, background: '#3b82f6' }}
      />
      <StatusBadge status={status} />
    </div>
  );
}

export const AutomationNode = memo(AutomationNodeImpl, areNodePropsEqual);
