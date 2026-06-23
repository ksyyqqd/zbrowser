import { memo, useEffect, useMemo, useState } from 'react';
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  Background,
  useReactFlow,
  type NodeProps,
} from '@xyflow/react';
import { FiBox, FiChevronDown, FiChevronRight, FiAlertCircle } from 'react-icons/fi';
import { userWorkflowsStore, type UserWorkflowConfig } from '@extension/storage';
import type { FlowNode, FlowEdge, NodeStatus } from '../types';
import { HANDLE_STYLE_BASE } from './handleStyle';
import { getStatusRingClass, StatusBadge, areNodePropsEqual } from './statusOverlay';
import { applyEdgeStyle, toFlowEdge, toFlowNode } from '../utils/conversions';
import { nestedNodeTypes } from './nodeTypes';
import type { WorkflowNodeType } from '@extension/workflow';

/**
 * Subflow node — invokes another saved workflow as a sub-routine.
 *
 * Two display modes (controlled via `data.subflowExpanded`):
 *  - collapsed: a normal sized node card showing only the target workflow name
 *  - expanded:  a larger card containing a NESTED React Flow rendering of the
 *               sub-workflow — same node components, same edge styles, same
 *               look-and-feel as the main canvas, just read-only. Like
 *               opening a node group inline.
 *
 * The nested ReactFlow lives in its own ReactFlowProvider so its store is
 * isolated from the parent canvas — parent selection / drag / zoom doesn't
 * leak into the preview and vice versa.
 */

// Dimensions of the inline canvas inside an expanded subflow card.
// Made fairly large so the embedded ReactFlow has enough room to render
// real node cards legibly. Users can still pan + zoom inside it.
const EXPAND_W = 640;
const EXPAND_H = 380;

function SubflowNodeImpl({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData } = useReactFlow();
  const status = data._executionStatus as NodeStatus | undefined;
  const statusRing = getStatusRingClass(status);
  const subflowId = (data.subflowId as string | undefined) || '';
  const expanded = Boolean(data.subflowExpanded);
  const name = (data.name as string) || '子流程';

  const [target, setTarget] = useState<UserWorkflowConfig | null>(null);
  const [missing, setMissing] = useState(false);

  // Resolve the target workflow once subflowId is set. We deliberately don't
  // subscribe to live updates here — editor reloads will refresh anyway, and
  // re-fetching on every storage tick would be wasteful for an inline preview.
  useEffect(() => {
    let cancelled = false;
    if (!subflowId) {
      setTarget(null);
      setMissing(false);
      return;
    }
    userWorkflowsStore
      .getWorkflow(subflowId)
      .then(wf => {
        if (cancelled) return;
        if (!wf) {
          setTarget(null);
          setMissing(true);
        } else {
          setTarget(wf);
          setMissing(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [subflowId]);

  const baseRing = selected ? 'ring-2 ring-blue-400 ring-offset-1 shadow-blue-400/30' : statusRing;
  const isMissing = subflowId && missing;

  return (
    <div
      className={`relative flex flex-col gap-1.5 rounded-xl text-white shadow-lg transition-all duration-150 ${baseRing} ${
        selected
          ? 'bg-gradient-to-r from-sky-400 to-sky-500'
          : 'bg-gradient-to-r from-sky-500 to-sky-600 hover:scale-[1.01]'
      }`}
      style={{
        minWidth: expanded ? EXPAND_W + 24 : 180,
        padding: '8px 12px',
        // The outer-ring "double bordered" feel (a subroutine convention)
        boxShadow: `0 0 0 2px ${selected ? '#60a5fa' : '#7dd3fc'} inset, 0 4px 12px rgba(0,0,0,0.15)`,
      }}>
      <Handle type="target" position={Position.Left} id="in" style={{ ...HANDLE_STYLE_BASE, background: '#0ea5e9' }} />

      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/20">
          <FiBox className="size-3.5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold leading-tight">{name}</span>
          <span className="truncate text-[11px] opacity-80">
            {isMissing ? (
              <span className="inline-flex items-center gap-1 text-yellow-200">
                <FiAlertCircle className="size-3" /> 目标工作流不存在
              </span>
            ) : target ? (
              `→ ${target.name}`
            ) : subflowId ? (
              '加载中…'
            ) : (
              '未选择目标工作流'
            )}
          </span>
        </div>
        {/* Click target to toggle expand/collapse. `nodrag` prevents React
            Flow from starting a node drag when the user clicks the chevron;
            stopPropagation so the click doesn't also fire onNodeClick (which
            would re-open / steal the side editor panel selection). */}
        <button
          type="button"
          className="nodrag flex size-5 shrink-0 items-center justify-center rounded-md text-white/90 transition hover:bg-white/15 hover:text-white"
          onClick={e => {
            e.stopPropagation();
            updateNodeData(id, { subflowExpanded: !expanded });
          }}
          onMouseDown={e => e.stopPropagation()}
          title={expanded ? '收起子流程预览' : '展开子流程预览'}>
          {expanded ? <FiChevronDown className="size-3.5" /> : <FiChevronRight className="size-3.5" />}
        </button>
      </div>

      {expanded && (
        <div
          className="nodrag nopan mt-1 overflow-hidden rounded-md bg-white/95"
          style={{ width: EXPAND_W, height: EXPAND_H }}
          // Block wheel from zooming/panning the parent canvas while hovering
          // inside the preview. The nested flow disables wheel zoom too, so
          // the wheel ends up doing nothing (also intended — predictable).
          onWheelCapture={e => e.stopPropagation()}>
          {target && target.nodes.length > 0 ? (
            <ReactFlowProvider>
              <NestedSubflowCanvas target={target} />
            </ReactFlowProvider>
          ) : target ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">子流程为空</div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              {isMissing ? '无法展示' : '加载中…'}
            </div>
          )}
        </div>
      )}

      {expanded && target && (
        <div className="flex items-center justify-between px-1 pt-0.5 text-[10px] text-white/70">
          <span>
            {target.nodes.length} 节点 · {target.edges.length} 连线
          </span>
          <span className="opacity-80">只读预览 · 编辑请打开子工作流</span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ ...HANDLE_STYLE_BASE, background: '#0ea5e9' }}
      />
      <StatusBadge status={status} />
    </div>
  );
}

/**
 * The nested ReactFlow rendering of the sub-workflow's real nodes & edges.
 *
 * Key behavior:
 *  - Same `nodeTypes` registry as the parent canvas → identical look & feel
 *  - Edge styling reuses `applyEdgeStyle` so loop continue/exit edges still
 *    show their bezier coloring, just like outside.
 *  - Strictly read-only: no drag, no connect, no selection, no pan, no zoom.
 *    The nested flow is a static visualization.
 *  - Auto-fitView whenever the underlying graph changes so the entire
 *    sub-workflow is visible within the expanded card with no manual zoom.
 *  - Recursive subflow rendering is short-circuited: any subflow nodes
 *    appearing inside the body are forced to `subflowExpanded = false`,
 *    avoiding infinite expansion.
 */
function NestedSubflowCanvas({ target }: { target: UserWorkflowConfig }) {
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    // Build a lookup so edge styling can see source/target node types.
    const nodeTypeById = new Map((target.nodes || []).map(n => [n.id, n.type as WorkflowNodeType]));
    const flowNodes: FlowNode[] = (target.nodes || []).map(n => {
      const base = toFlowNode(n);
      // For nested previews, NEVER recursively expand a child subflow —
      // would cause infinite nesting + giant DOM tree.
      if (base.type === 'subflow' && base.data) {
        return { ...base, data: { ...base.data, subflowExpanded: false } };
      }
      return base;
    });
    const flowEdges: FlowEdge[] = (target.edges || []).map(e =>
      applyEdgeStyle(toFlowEdge(e), nodeTypeById.get(e.source)),
    );
    return { nodes: flowNodes, edges: flowEdges };
  }, [target]);

  // Whenever the sub-workflow shape changes, re-fit the viewport so the whole
  // graph is visible in the available area.
  useEffect(() => {
    // requestAnimationFrame defers until nodes have measured dimensions, else
    // fitView underestimates and the graph appears too small.
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.15, duration: 0 });
    });
    return () => cancelAnimationFrame(raf);
  }, [fitView, nodes, edges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nestedNodeTypes}
      // Read-only: structure can't be changed from inside the preview.
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      // BUT pan + zoom are enabled so the user can navigate large
      // sub-workflows that wouldn't fit fitView'd at their natural size.
      // Pan = drag with the left mouse button anywhere on the background.
      // Zoom = mouse wheel inside the preview (we capture wheel at the
      // outer div so it doesn't bubble out and zoom the PARENT canvas).
      panOnDrag
      panOnScroll={false}
      zoomOnScroll
      zoomOnPinch
      zoomOnDoubleClick={false}
      preventScrolling={true}
      proOptions={{ hideAttribution: true }}
      minZoom={0.1}
      maxZoom={2}
      fitView>
      <Background gap={16} size={1} />
    </ReactFlow>
  );
}

export const SubflowNode = memo(SubflowNodeImpl, areNodePropsEqual);
