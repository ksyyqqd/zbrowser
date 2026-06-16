import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FiGitBranch } from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { ConditionBranch } from '@extension/workflow';
import type { FlowNode, NodeStatus } from '../types';
import { HANDLE_STYLE_BASE } from './handleStyle';
import { getStatusRingClass, StatusBadge, areNodePropsEqual } from './statusOverlay';

function ConditionNodeImpl({ data, selected }: NodeProps<FlowNode>) {
  const branches: ConditionBranch[] = data.branches || [];
  const branchCount = Math.max(branches.length, 1);
  const minHeight = Math.max(80, 40 + branchCount * 22);
  const status = data._executionStatus as NodeStatus | undefined;
  const statusRing = getStatusRingClass(status);
  return (
    <div
      className={`relative flex min-w-[160px] items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-white shadow-lg transition-all duration-150 ${
        selected
          ? 'bg-gradient-to-r from-orange-400 to-orange-500 shadow-blue-400/30 ring-2 ring-blue-400 ring-offset-1'
          : `bg-gradient-to-r from-orange-500 to-orange-600 hover:scale-[1.03] ${statusRing}`
      }`}
      style={{ minHeight }}>
      <Handle type="target" position={Position.Left} id="in" style={{ ...HANDLE_STYLE_BASE, background: '#f97316' }} />
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
        <FiGitBranch className="size-4" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold leading-tight">{t('workflow_nodeType_condition')}</span>
        {branches.length > 0 ? (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {branches.map(b => (
              <span key={b.id} className="max-w-[110px] truncate text-xs leading-tight opacity-80">
                → {b.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="max-w-[110px] truncate text-xs opacity-75">
            {data.prompt?.slice(0, 20) || t('workflow_nodeType_condition_default')}...
          </span>
        )}
      </div>
      {branches.map((branch, idx) => {
        const top = branches.length > 1 ? `${((idx + 1) / (branches.length + 1)) * 100}%` : '50%';
        return (
          <Handle
            key={branch.id}
            id={branch.id}
            type="source"
            position={Position.Right}
            style={{ ...HANDLE_STYLE_BASE, background: '#f97316', top }}
          />
        );
      })}
      <StatusBadge status={status} />
    </div>
  );
}

export const ConditionNode = memo(ConditionNodeImpl, areNodePropsEqual);
