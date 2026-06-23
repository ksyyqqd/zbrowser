import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FiBox } from 'react-icons/fi';
import { AINode } from './AINode';
import { AutomationNode } from './AutomationNode';
import { ConditionNode } from './ConditionNode';
import { LoopNode } from './LoopNode';
import { NoteNode } from './NoteNode';
import { StartNode } from './StartNode';
import { EndNode } from './EndNode';
import { OutputNode } from './OutputNode';
import { HANDLE_STYLE_BASE } from './handleStyle';
import type { FlowNode } from '../types';

/**
 * A lightweight stand-in for the full `SubflowNode` used ONLY inside nested
 * subflow previews. We deliberately don't reuse the real `SubflowNode` here
 * because:
 *  - it would create an import cycle (SubflowNode → nodeTypes → SubflowNode)
 *  - infinitely-nested live previews (subflow inside subflow inside …) would
 *    spawn dozens of ReactFlow instances per render — performance disaster
 *
 * This collapsed-card variant shows the subflow's display name and that's it.
 */
function SubflowPreviewNodeImpl({ data }: NodeProps<FlowNode>) {
  const name = (data.name as string) || '子流程';
  return (
    <div
      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-sky-600 px-3 py-2 text-white shadow-md"
      style={{
        minWidth: 140,
        boxShadow: '0 0 0 2px #7dd3fc inset, 0 2px 6px rgba(0,0,0,0.12)',
      }}>
      <Handle type="target" position={Position.Left} id="in" style={{ ...HANDLE_STYLE_BASE, background: '#0ea5e9' }} />
      <FiBox className="size-3.5 opacity-80" />
      <span className="truncate text-xs font-semibold">{name}</span>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ ...HANDLE_STYLE_BASE, background: '#0ea5e9' }}
      />
    </div>
  );
}
const SubflowPreviewNode = memo(SubflowPreviewNodeImpl);

/**
 * NodeTypes registry used by INLINE / NESTED subflow previews.
 * Identical to the main-canvas registry, except `subflow` points to the
 * lightweight preview stand-in instead of the full expandable SubflowNode.
 *
 * The main canvas keeps its own registry (in `./index`) with the real
 * `SubflowNode` so the user can interact with their top-level subflow nodes
 * normally — only nested children get the collapsed stand-in.
 */
export const nestedNodeTypes = {
  ai: AINode,
  automation: AutomationNode,
  condition: ConditionNode,
  loop: LoopNode,
  note: NoteNode,
  subflow: SubflowPreviewNode,
  start: StartNode,
  end: EndNode,
  output: OutputNode,
};
