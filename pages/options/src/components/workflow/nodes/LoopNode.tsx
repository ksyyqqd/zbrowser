import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FiRepeat } from 'react-icons/fi';
import type { FlowNode, NodeStatus } from '../types';
import { HANDLE_STYLE_BASE } from './handleStyle';
import { getStatusRingClass, StatusBadge, areNodePropsEqual } from './statusOverlay';

/**
 * Loop node (option A — loop-back edge).
 *
 * Two source ports:
 *  - id="continue": wire this back to the start of the loop body
 *  - id="exit":     wire this to whatever runs after the loop completes
 */
function LoopNodeImpl({ data, selected }: NodeProps<FlowNode>) {
  const status = data._executionStatus as NodeStatus | undefined;
  const statusRing = getStatusRingClass(status);
  const name = (data.name as string) || '循环';
  const mode = (data.loopMode as 'fixed' | 'ai_judge' | undefined) ?? 'fixed';
  const max = (data.maxIterations as number | undefined) ?? 0;
  const subtitle = mode === 'fixed' ? `固定 ${max} 次` : `AI 判定 · 兜底 ${max}`;
  return (
    <div
      className={`relative flex min-w-[160px] items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-white shadow-lg transition-all duration-150 ${
        selected
          ? 'bg-gradient-to-r from-indigo-400 to-indigo-500 shadow-blue-400/30 ring-2 ring-blue-400 ring-offset-1'
          : `bg-gradient-to-r from-indigo-500 to-indigo-600 hover:scale-[1.03] ${statusRing}`
      }`}
      style={{ minHeight: 80 }}>
      <Handle type="target" position={Position.Left} id="in" style={{ ...HANDLE_STYLE_BASE, background: '#6366f1' }} />
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
        <FiRepeat className="size-4" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="max-w-[140px] truncate text-sm font-semibold leading-tight">{name}</span>
        <span className="max-w-[140px] truncate text-xs opacity-75">{subtitle}</span>
        <div className="mt-0.5 flex flex-col gap-0.5">
          <span className="max-w-[140px] truncate text-[10px] leading-tight opacity-80">↻ 继续</span>
          <span className="max-w-[140px] truncate text-[10px] leading-tight opacity-80">→ 退出</span>
        </div>
      </div>
      {/* `continue` port on the top-right — visually distinct from `exit` so users
          know which one loops back. Exact y position is 1/3 from the top. */}
      <Handle
        id="continue"
        type="source"
        position={Position.Right}
        style={{ ...HANDLE_STYLE_BASE, background: '#22c55e', top: '33%' }}
      />
      <Handle
        id="exit"
        type="source"
        position={Position.Right}
        style={{ ...HANDLE_STYLE_BASE, background: '#ef4444', top: '67%' }}
      />
      <StatusBadge status={status} />
    </div>
  );
}

export const LoopNode = memo(LoopNodeImpl, areNodePropsEqual);
