/**
 * Workflow Editor Component (modular version)
 * Visual workflow editor using React Flow with all sub-modules extracted.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  SelectionMode,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  FiTrash2,
  FiX,
  FiMaximize2,
  FiMinimize2,
  FiLayout,
  FiAlertTriangle,
  FiCornerUpLeft,
  FiCornerUpRight,
  FiCopy,
  FiDatabase,
  FiActivity,
  FiPlay,
} from 'react-icons/fi';
import { t } from '@extension/i18n';
import {
  validateWorkflowStructure,
  type Workflow,
  type WorkflowNode,
  type WorkflowNodeType,
  type NodeData,
  type WorkflowVariable,
} from '@extension/workflow';

import type { FlowNode, FlowEdge, WorkflowEditorProps } from './types';
import { nodeTypes } from './nodes';
import { nodePalette, controlPalette, PaletteCard, getDefaultNodeData, getNodeTypeLabelKey } from './palette';
import { NodeEditorPanel } from './panels/NodeEditorPanel';
import { VariablesPanel } from './panels/VariablesPanel';
import { ExecutionLogPanel } from './panels/ExecutionLogPanel';
import {
  toFlowNode,
  toFlowEdge,
  toWorkflowNode,
  toWorkflowEdge,
  getLayoutedElements,
  isValidConnectionFor,
  newWorkflowId,
  newNodeId,
  newEdgeId,
} from './utils';

// ============ Default workflow scaffold ============

function buildDefaultNodes(): FlowNode[] {
  return [
    { id: 'start', type: 'start', position: { x: 100, y: 200 }, data: { type: 'start', name: 'start' } },
    { id: 'end', type: 'end', position: { x: 600, y: 200 }, data: { type: 'end', name: 'end' } },
  ];
}

// ============ Inner Editor (requires ReactFlowProvider) ============

function WorkflowEditorInner({
  workflow: initialWorkflow,
  onSave,
  onCancel,
  isDarkMode = false,
  executionState,
  onExecute,
}: WorkflowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow();
  // Internal clipboard for Ctrl+C / Ctrl+V node copy-paste (ref-based, not OS clipboard)
  const clipboardRef = useRef<FlowNode[] | null>(null);
  // Help overlay (Ctrl+/) toggle
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  // Right-click context menu state
  type CtxTarget = { kind: 'node'; nodeId: string } | { kind: 'edge'; edgeId: string } | { kind: 'pane' };
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: CtxTarget } | null>(null);

  const [workflowId] = useState(initialWorkflow?.id || newWorkflowId());
  const [workflowName, setWorkflowName] = useState(initialWorkflow?.name || t('workflow_newWorkflow_defaultName'));
  const [workflowDescription, setWorkflowDescription] = useState(initialWorkflow?.description || '');
  const [isFullscreen, setIsFullscreen] = useState(true);

  const initialNodes = useMemo(
    () => (initialWorkflow?.nodes?.length ? initialWorkflow.nodes.map(toFlowNode) : buildDefaultNodes()),
    [initialWorkflow],
  );
  const initialEdges = useMemo(
    () => (initialWorkflow?.edges?.length ? initialWorkflow.edges.map(toFlowEdge) : []),
    [initialWorkflow],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<FlowEdge | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // ============ Variables ============
  const [variables, setVariables] = useState<WorkflowVariable[]>(initialWorkflow?.variables || []);
  // Right panel mode: 'node' for node/edge editing, 'variables' for variable mgmt, 'logs' for execution log
  const [rightPanelMode, setRightPanelMode] = useState<'node' | 'variables' | 'logs'>('node');

  // Auto-switch to logs panel when execution starts
  const prevExecStatusRef = useRef<string>('idle');
  useEffect(() => {
    const cur = executionState?.status ?? 'idle';
    if (cur === 'running' && prevExecStatusRef.current !== 'running') {
      setRightPanelMode('logs');
      setSelectedNode(null);
      setSelectedEdge(null);
    }
    prevExecStatusRef.current = cur;
  }, [executionState?.status]);

  // ============ Undo/Redo ============
  type Snapshot = { nodes: FlowNode[]; edges: FlowEdge[] };
  const historyRef = useRef<Snapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const isApplyingHistoryRef = useRef<boolean>(false);
  const HISTORY_LIMIT = 50;

  useEffect(() => {
    if (historyRef.current.length === 0) {
      historyRef.current = [{ nodes: initialNodes, edges: initialEdges }];
      historyIndexRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isApplyingHistoryRef.current) {
      isApplyingHistoryRef.current = false;
      return;
    }
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push({ nodes, edges });
    if (historyRef.current.length > HISTORY_LIMIT) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current = historyRef.current.length - 1;
    }
  }, [nodes, edges]);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snap = historyRef.current[historyIndexRef.current];
    isApplyingHistoryRef.current = true;
    setNodes(snap.nodes);
    isApplyingHistoryRef.current = true;
    setEdges(snap.edges);
  }, [setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snap = historyRef.current[historyIndexRef.current];
    isApplyingHistoryRef.current = true;
    setNodes(snap.nodes);
    isApplyingHistoryRef.current = true;
    setEdges(snap.edges);
  }, [setNodes, setEdges]);

  // ============ Connection ============
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(eds =>
        addEdge(
          {
            ...params,
            id: newEdgeId(),
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const isValidConnection = useCallback(
    (conn: Connection | FlowEdge) => isValidConnectionFor(conn, nodes, edges),
    [nodes, edges],
  );

  // ============ Drag & Drop ============
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/reactflow') as WorkflowNodeType;
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const nodeId = newNodeId();
      const defaultData = getDefaultNodeData(type);
      const name = type === 'output' ? '输出' : t(getNodeTypeLabelKey(type));
      setNodes(nds => nds.concat({ id: nodeId, type, position, data: { ...defaultData, type, name } }));
      if (['ai', 'automation', 'condition', 'output'].includes(type)) {
        setSelectedNode({ id: nodeId, type, name, position, data: { ...defaultData, type, name } });
        setSelectedEdge(null);
      }
    },
    [screenToFlowPosition, setNodes],
  );

  // ============ Selection ============
  const onNodeClick = useCallback((_: React.MouseEvent, node: FlowNode) => {
    const nodeType = node.type as WorkflowNodeType;
    if (['ai', 'automation', 'condition', 'output'].includes(nodeType)) {
      setSelectedNode({
        id: node.id,
        type: nodeType,
        name: (node.data?.name as string) || node.id,
        position: node.position,
        data: (node.data as NodeData) || {},
      });
    } else {
      setSelectedNode(null);
    }
    setSelectedEdge(null);
    setRightPanelMode('node');
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: FlowEdge) => {
    setSelectedEdge(edge);
    setSelectedNode(null);
    setRightPanelMode('node');
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setContextMenu(null);
  }, []);

  // ============ Context Menu (right-click) ============
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: FlowNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'node', nodeId: node.id } });
  }, []);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: FlowEdge) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'edge', edgeId: edge.id } });
  }, []);

  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: (e as React.MouseEvent).clientX,
      y: (e as React.MouseEvent).clientY,
      target: { kind: 'pane' },
    });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ============ Actions ============
  const handleDeleteNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  }, [selectedNode, setNodes, setEdges]);

  const handleDeleteEdge = useCallback(() => {
    if (!selectedEdge) return;
    setEdges(eds => eds.filter(e => e.id !== selectedEdge.id));
    setSelectedEdge(null);
  }, [selectedEdge, setEdges]);

  const handleAutoLayout = useCallback(() => {
    const layouted = getLayoutedElements(nodes, edges);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [nodes, edges, setNodes, setEdges]);

  const handleUpdateNode = useCallback(
    (updatedNode: WorkflowNode) => {
      setNodes(nds =>
        nds.map(n =>
          n.id === updatedNode.id
            ? { ...n, data: { ...updatedNode.data, name: updatedNode.name, type: updatedNode.type } }
            : n,
        ),
      );
      setSelectedNode(updatedNode);
    },
    [setNodes],
  );

  const handleDuplicateNode = useCallback(() => {
    if (!selectedNode) return;
    if (selectedNode.type === 'start' || selectedNode.type === 'end') return;
    const sourceFlowNode = nodes.find(n => n.id === selectedNode.id);
    if (!sourceFlowNode) return;
    const newId = newNodeId();
    const newNode: FlowNode = {
      ...sourceFlowNode,
      id: newId,
      position: { x: sourceFlowNode.position.x + 40, y: sourceFlowNode.position.y + 40 },
      data: { ...sourceFlowNode.data },
      selected: false,
    };
    setNodes(nds => nds.concat(newNode));
    setSelectedNode({
      id: newId,
      type: selectedNode.type,
      name: selectedNode.name,
      position: newNode.position,
      data: { ...selectedNode.data },
    });
    setSelectedEdge(null);
  }, [selectedNode, nodes, setNodes]);

  // ============ Save ============
  const buildWorkflow = useCallback(
    (): Workflow => ({
      id: workflowId,
      name: workflowName || t('workflow_untitledWorkflow'),
      description:
        workflowDescription || t('workflow_automatedWorkflowDesc', [workflowName || t('workflow_untitledWorkflow')]),
      version: '1.0.0',
      nodes: nodes.map(toWorkflowNode),
      edges: edges.map(toWorkflowEdge),
      variables: variables,
      executionConfig: initialWorkflow?.executionConfig || { onError: 'stop' },
      createdAt: initialWorkflow?.createdAt || Date.now(),
      updatedAt: Date.now(),
    }),
    [workflowId, workflowName, workflowDescription, nodes, edges, variables, initialWorkflow],
  );

  const handleSave = useCallback(() => {
    const workflow = buildWorkflow();
    const validation = validateWorkflowStructure(workflow);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }
    setValidationErrors([]);
    onSave(workflow);
  }, [buildWorkflow, onSave]);

  // Copy selected nodes to internal clipboard
  const handleCopy = useCallback(() => {
    const selected = nodes.filter(
      n => (n.selected || n.id === selectedNode?.id) && n.type !== 'start' && n.type !== 'end',
    );
    if (selected.length === 0) return;
    // Deep-copy node data to avoid stale references
    clipboardRef.current = selected.map(n => ({
      ...n,
      data: JSON.parse(JSON.stringify(n.data || {})),
    }));
  }, [nodes, selectedNode]);

  // Paste nodes from internal clipboard
  const handlePaste = useCallback(() => {
    const source = clipboardRef.current;
    if (!source || source.length === 0) return;
    const newNodes: FlowNode[] = source
      .filter(n => n.type !== 'start' && n.type !== 'end')
      .map(n => ({
        ...n,
        id: `node-${Math.random().toString(36).slice(2, 10)}`,
        position: { x: n.position.x + 60, y: n.position.y + 60 },
        data: { ...JSON.parse(JSON.stringify(n.data || {})), _executionStatus: undefined },
        selected: false,
      }));
    if (newNodes.length === 0) return;
    setNodes(nds => nds.concat(newNodes));
    if (newNodes.length === 1) {
      const created = newNodes[0];
      setSelectedNode({
        id: created.id,
        type: created.type as WorkflowNodeType,
        name: (created.data?.name as string) || created.id,
        position: created.position,
        data: (created.data as NodeData) || {},
      });
    }
  }, [setNodes]);

  // Cycle selection through nodes with Tab / Shift+Tab
  const handleCycleSelection = useCallback(
    (reverse: boolean) => {
      const selectableNodes = nodes.filter(n => n.type !== 'start' && n.type !== 'end');
      if (selectableNodes.length === 0) return;
      const currentIdx = selectableNodes.findIndex(n => n.id === selectedNode?.id);
      let nextIdx: number;
      if (currentIdx < 0) {
        nextIdx = reverse ? selectableNodes.length - 1 : 0;
      } else {
        nextIdx = reverse
          ? (currentIdx - 1 + selectableNodes.length) % selectableNodes.length
          : (currentIdx + 1) % selectableNodes.length;
      }
      const next = selectableNodes[nextIdx];
      // Update canvas highlight (ReactFlow reads `selected` from node state)
      setNodes(nds => nds.map(n => ({ ...n, selected: n.id === next.id })));
      setSelectedNode({
        id: next.id,
        type: next.type as WorkflowNodeType,
        name: (next.data?.name as string) || next.id,
        position: next.position,
        data: (next.data as NodeData) || {},
      });
      setSelectedEdge(null);
      setRightPanelMode('node');
    },
    [nodes, selectedNode],
  );

  // ============ Keyboard Shortcuts ============
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip shortcuts when user is typing in an input / textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      // --- Shortcuts that work even when input is focused (via Ctrl/⌘) ---
      if (mod && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      // --- Shortcuts blocked while typing in input fields ---
      if (isInputFocused && !mod) return;

      if (mod && e.key === 'd') {
        e.preventDefault();
        handleDuplicateNode();
        return;
      }
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        e.shiftKey ? handleRedo() : handleUndo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        handleRedo();
        return;
      }
      // Ctrl+C / Ctrl+V — Copy / Paste nodes
      if (mod && e.key === 'c') {
        if (!isInputFocused) {
          e.preventDefault();
          handleCopy();
        }
        return;
      }
      if (mod && e.key === 'v') {
        if (!isInputFocused) {
          e.preventDefault();
          handlePaste();
        }
        return;
      }
      // Ctrl+A — Select all nodes
      if (mod && e.key === 'a') {
        if (!isInputFocused) {
          e.preventDefault();
          setNodes(nds => nds.map(n => ({ ...n, selected: true })));
        }
        return;
      }
      // Ctrl+E — Execute workflow
      if (mod && e.key === 'e') {
        e.preventDefault();
        if (onExecute) {
          const wf = buildWorkflow();
          onExecute(wf);
        }
        return;
      }
      // Ctrl+L — Auto layout
      if (mod && e.key === 'l') {
        e.preventDefault();
        handleAutoLayout();
        return;
      }
      // Ctrl+0 — Fit view
      if (mod && e.key === '0') {
        e.preventDefault();
        fitView({ padding: 0.2 });
        return;
      }
      // Ctrl+= / Ctrl+- — Zoom in / out
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        zoomOut();
        return;
      }
      // F11 — Toggle fullscreen
      if (e.key === 'F11') {
        e.preventDefault();
        setIsFullscreen(f => !f);
        return;
      }
      // Ctrl+1/2/3 — Switch right panel
      if (mod && e.key === '1') {
        e.preventDefault();
        setRightPanelMode('node');
        return;
      }
      if (mod && e.key === '2') {
        e.preventDefault();
        setRightPanelMode('variables');
        return;
      }
      if (mod && e.key === '3') {
        e.preventDefault();
        setRightPanelMode('logs');
        return;
      }
      // Ctrl+/ — Toggle shortcut help
      if (mod && e.key === '/') {
        e.preventDefault();
        setShowShortcutHelp(v => !v);
        return;
      }
      // Tab / Shift+Tab — Cycle node selection
      if (e.key === 'Tab' && !mod) {
        e.preventDefault();
        handleCycleSelection(e.shiftKey);
        return;
      }
      // Escape — Deselect or close help
      if (e.key === 'Escape') {
        if (showShortcutHelp) {
          setShowShortcutHelp(false);
        } else {
          setSelectedNode(null);
          setSelectedEdge(null);
        }
        return;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    handleSave,
    handleDuplicateNode,
    handleUndo,
    handleRedo,
    handleCopy,
    handlePaste,
    handleCycleSelection,
    handleAutoLayout,
    onExecute,
    buildWorkflow,
    fitView,
    zoomIn,
    zoomOut,
    showShortcutHelp,
    setNodes,
    setIsFullscreen,
    setRightPanelMode,
  ]);

  // ============ Execution Status Injection ============
  const nodesWithStatus = useMemo(() => {
    // When no execution is in progress (idle), strip any stale _executionStatus so
    // canvas badges don't linger from previous runs.
    if (!executionState || executionState.status === 'idle') {
      return nodes.map(n => {
        if (!n.data || !('_executionStatus' in n.data)) return n;
        const { _executionStatus: _ignored, ...cleanData } = n.data as Record<string, unknown>;
        return { ...n, data: cleanData as typeof n.data };
      });
    }
    return nodes.map(n => ({
      ...n,
      data: { ...n.data, _executionStatus: executionState.nodeStatus[n.id] ?? 'idle' },
    }));
  }, [nodes, executionState]);

  // ============ Outputs Summary ============
  // Extract output-node results from the current execution event stream.
  // The ExecutionLogPanel surfaces these as "Final outputs" cards on completion.
  const outputResults = useMemo(() => {
    if (!executionState) return [];
    const outputNodes = new Map<string, { label: string; nodeName: string }>();
    for (const n of nodes) {
      if (n.type === 'output') {
        outputNodes.set(n.id, {
          label: (n.data?.label as string) || (n.data?.name as string) || n.id,
          nodeName: (n.data?.name as string) || n.id,
        });
      }
    }
    const result: { nodeId: string; name: string; output: string }[] = [];
    for (const ev of executionState.events) {
      if (ev.type === 'NODE_OK' && ev.nodeId && outputNodes.has(ev.nodeId)) {
        const meta = outputNodes.get(ev.nodeId)!;
        const existing = result.findIndex(r => r.nodeId === ev.nodeId);
        const entry = { nodeId: ev.nodeId, name: meta.label, output: ev.details ?? '' };
        if (existing >= 0) result[existing] = entry;
        else result.push(entry);
      }
    }
    return result;
  }, [executionState, nodes]);

  // ============ Render ============
  return (
    <>
      {/* Custom thin scrollbar for editor side panels (variables / logs / node editor) */}
      <style>{`
        .rp-log-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .rp-log-scroll::-webkit-scrollbar-track { background: transparent; }
        .rp-log-scroll::-webkit-scrollbar-thumb {
          background: ${isDarkMode ? 'rgba(148,163,184,0.25)' : 'rgba(100,116,139,0.3)'};
          border-radius: 3px;
        }
        .rp-log-scroll::-webkit-scrollbar-thumb:hover {
          background: ${isDarkMode ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.55)'};
        }
        .rp-log-scroll {
          scrollbar-width: thin;
          scrollbar-color: ${isDarkMode ? 'rgba(148,163,184,0.25) transparent' : 'rgba(100,116,139,0.3) transparent'};
        }
      `}</style>
      <div
        className={`workflow-editor flex flex-col ${
          isFullscreen
            ? `fixed inset-0 z-[100] h-screen w-screen overflow-hidden ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`
            : 'h-full'
        }`}>
        {/* Header */}
        <div
          className={`flex items-center justify-between border-b px-4 py-2.5 shadow-sm ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'}`}>
          <div className="flex flex-1 items-center gap-3">
            <input
              type="text"
              value={workflowName}
              onChange={e => setWorkflowName(e.target.value)}
              placeholder={t('workflow_name_placeholder')}
              className={`w-40 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus:ring-2 focus:ring-blue-400/50 ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
            />
            <input
              type="text"
              value={workflowDescription}
              onChange={e => setWorkflowDescription(e.target.value)}
              placeholder={t('workflow_description_placeholder')}
              className={`max-w-md flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors focus:ring-2 focus:ring-blue-400/50 ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              className={`rounded-lg p-2 transition-colors ${isDarkMode ? 'text-gray-300 hover:bg-slate-600' : 'text-gray-600 hover:bg-gray-100'}`}
              title="Undo (Ctrl+Z)">
              <FiCornerUpLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              className={`rounded-lg p-2 transition-colors ${isDarkMode ? 'text-gray-300 hover:bg-slate-600' : 'text-gray-600 hover:bg-gray-100'}`}
              title="Redo (Ctrl+Shift+Z)">
              <FiCornerUpRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleDuplicateNode}
              disabled={!selectedNode || selectedNode.type === 'start' || selectedNode.type === 'end'}
              className={`rounded-lg p-2 transition-colors disabled:opacity-30 ${isDarkMode ? 'text-gray-300 hover:bg-slate-600' : 'text-gray-600 hover:bg-gray-100'}`}
              title="Duplicate (Ctrl+D)">
              <FiCopy className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setRightPanelMode('variables');
                setSelectedNode(null);
                setSelectedEdge(null);
              }}
              className={`relative rounded-lg p-2 transition-colors ${
                rightPanelMode === 'variables'
                  ? isDarkMode
                    ? 'bg-slate-600 text-blue-300'
                    : 'bg-blue-50 text-blue-600'
                  : isDarkMode
                    ? 'text-gray-300 hover:bg-slate-600'
                    : 'text-gray-600 hover:bg-gray-100'
              }`}
              title={`变量 (${variables.length})`}>
              <FiDatabase className="size-4" />
              {variables.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white">
                  {variables.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setRightPanelMode('logs');
                setSelectedNode(null);
                setSelectedEdge(null);
              }}
              className={`relative rounded-lg p-2 transition-colors ${
                rightPanelMode === 'logs'
                  ? isDarkMode
                    ? 'bg-slate-600 text-blue-300'
                    : 'bg-blue-50 text-blue-600'
                  : isDarkMode
                    ? 'text-gray-300 hover:bg-slate-600'
                    : 'text-gray-600 hover:bg-gray-100'
              }`}
              title={`执行日志${executionState ? ` (${executionState.events.length})` : ''}`}>
              <FiActivity className="size-4" />
              {executionState && executionState.status === 'running' && (
                <span className="absolute -right-0.5 -top-0.5 flex size-2 animate-pulse rounded-full bg-blue-500" />
              )}
              {executionState && executionState.status === 'failed' && (
                <span className="absolute -right-0.5 -top-0.5 flex size-2 rounded-full bg-red-500" />
              )}
            </button>
            <div className={`mx-1 h-5 w-px ${isDarkMode ? 'bg-slate-600' : 'bg-gray-300'}`} />
            <button
              type="button"
              onClick={handleAutoLayout}
              className={`rounded-lg p-2 transition-colors ${isDarkMode ? 'text-gray-300 hover:bg-slate-600' : 'text-gray-600 hover:bg-gray-100'}`}
              title={t('workflow_autoLayout')}>
              <FiLayout className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className={`rounded-lg p-2 transition-colors ${isDarkMode ? 'text-gray-300 hover:bg-slate-600' : 'text-gray-600 hover:bg-gray-100'}`}
              title={isFullscreen ? t('workflow_exitFullscreen') : t('workflow_enterFullscreen')}>
              {isFullscreen ? <FiMinimize2 className="size-4" /> : <FiMaximize2 className="size-4" />}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${isDarkMode ? 'bg-slate-700 text-gray-200 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t('workflow_cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-500">
              {t('workflow_save')}
            </button>
            {onExecute && (
              <button
                type="button"
                onClick={() => {
                  const wf = buildWorkflow();
                  onExecute(wf);
                }}
                disabled={executionState?.status === 'running'}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors ${
                  executionState?.status === 'running'
                    ? 'cursor-not-allowed bg-green-400 opacity-60'
                    : 'bg-green-600 hover:bg-green-500'
                }`}>
                <FiPlay className="size-3.5" />
                {executionState?.status === 'running' ? '执行中...' : '运行'}
              </button>
            )}
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {/* Palette */}
          <div
            className={`flex shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-gray-200 bg-gray-50/80'}`}
            style={{ width: 224, minWidth: 224, maxWidth: 224, boxSizing: 'border-box' }}>
            <div className="px-3 pb-1 pt-3">
              <h3
                className={`mb-2 text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {t('workflow_nodePalette')}
              </h3>
              <div className="space-y-1.5">
                {nodePalette.map(item => (
                  <PaletteCard key={item.type} item={item} isDark={isDarkMode} />
                ))}
              </div>
            </div>
            <div
              className={`mt-2 border-t border-dashed px-3 pb-3 pt-3 ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}`}>
              <h3
                className={`mb-2 text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {t('workflow_controlPalette')}
              </h3>
              <div className="space-y-1.5">
                {controlPalette.map(item => (
                  <PaletteCard key={item.type} item={item} isDark={isDarkMode} />
                ))}
              </div>
            </div>
            {/* Shortcut help entry */}
            <button
              type="button"
              onClick={() => setShowShortcutHelp(true)}
              className={`mt-auto flex items-center gap-1.5 border-t px-3 py-2.5 text-xs transition-colors ${
                isDarkMode
                  ? 'border-slate-700 text-gray-500 hover:bg-slate-700/50 hover:text-gray-300'
                  : 'border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}>
              <kbd
                className={`rounded border px-1 py-0.5 font-mono text-[10px] ${isDarkMode ? 'border-slate-600 bg-slate-900' : 'border-gray-300 bg-gray-50'}`}>
                ⌘/
              </kbd>
              快捷键
            </button>
          </div>

          {/* React Flow Canvas */}
          <div ref={reactFlowWrapper} className={`relative flex-1 ${isDarkMode ? 'bg-slate-900' : 'bg-gray-100'}`}>
            {validationErrors.length > 0 && (
              <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 dark:border-red-900/50 dark:bg-red-900/30">
                <FiAlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                <div className="flex-1 space-y-0.5">
                  {validationErrors.map((err, i) => (
                    <p key={i} className="text-xs text-red-700 dark:text-red-300">
                      {err}
                    </p>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setValidationErrors([])}
                  className="shrink-0 rounded p-0.5 text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50">
                  <FiX className="size-3.5" />
                </button>
              </div>
            )}
            <ReactFlow
              nodes={nodesWithStatus}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              onNodeContextMenu={onNodeContextMenu}
              onEdgeContextMenu={onEdgeContextMenu}
              onPaneContextMenu={onPaneContextMenu}
              nodeTypes={nodeTypes}
              deleteKeyCode={['Backspace', 'Delete']}
              // Box-select on left-drag over empty pane; pan with middle/right mouse button
              selectionOnDrag
              panOnDrag={[1, 2]}
              selectionMode={SelectionMode.Partial}
              multiSelectionKeyCode={['Shift']}
              fitView
              snapToGrid
              snapGrid={[20, 20]}
              colorMode={isDarkMode ? 'dark' : 'light'}
              defaultEdgeOptions={{
                type: 'smoothstep',
                markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
              }}>
              <Background gap={20} size={1} />
              <Controls />
              <MiniMap
                nodeStrokeWidth={3}
                pannable
                zoomable
                nodeColor={node => {
                  switch (node.type) {
                    case 'ai':
                      return '#9333ea';
                    case 'automation':
                      return '#3b82f6';
                    case 'condition':
                      return '#f97316';
                    case 'start':
                      return '#22c55e';
                    case 'end':
                      return '#ef4444';
                    default:
                      return '#6b7280';
                  }
                }}
              />
            </ReactFlow>
          </div>

          {/* Right Editor Panel */}
          {(selectedNode || selectedEdge || rightPanelMode === 'variables' || rightPanelMode === 'logs') && (
            <div
              className={`rp-log-scroll w-72 overflow-y-auto border-l shadow-lg ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'}`}>
              {rightPanelMode === 'logs' ? (
                <>
                  <div
                    className={`flex items-center justify-between border-b px-4 py-2.5 ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
                    <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      执行日志
                    </h3>
                    <button
                      type="button"
                      onClick={() => setRightPanelMode('node')}
                      className={`rounded-md p-1.5 transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-100'}`}
                      title="关闭">
                      <FiX className="size-4" />
                    </button>
                  </div>
                  <ExecutionLogPanel
                    events={executionState?.events || []}
                    status={executionState?.status || 'idle'}
                    isDarkMode={isDarkMode}
                    outputs={outputResults}
                  />
                </>
              ) : rightPanelMode === 'variables' ? (
                <>
                  <div
                    className={`flex items-center justify-between border-b px-4 py-2.5 ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
                    <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      变量管理
                    </h3>
                    <button
                      type="button"
                      onClick={() => setRightPanelMode('node')}
                      className={`rounded-md p-1.5 transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-100'}`}
                      title="关闭">
                      <FiX className="size-4" />
                    </button>
                  </div>
                  <VariablesPanel variables={variables} onChange={setVariables} isDarkMode={isDarkMode} />
                </>
              ) : (
                <>
                  <div
                    className={`flex items-center justify-between border-b px-4 py-2.5 ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
                    <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      {selectedNode ? t('workflow_editNode') : t('workflow_editEdge')}
                    </h3>
                    <div className="flex items-center gap-1">
                      {selectedNode && (
                        <button
                          type="button"
                          onClick={handleDeleteNode}
                          className="rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
                          title={t('workflow_delete')}>
                          <FiTrash2 className="size-4" />
                        </button>
                      )}
                      {selectedEdge && (
                        <button
                          type="button"
                          onClick={handleDeleteEdge}
                          className="rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
                          title={t('workflow_delete')}>
                          <FiTrash2 className="size-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedNode(null);
                          setSelectedEdge(null);
                        }}
                        className={`rounded-md p-1.5 transition-colors ${isDarkMode ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-100'}`}
                        title={t('workflow_close')}>
                        <FiX className="size-4" />
                      </button>
                    </div>
                  </div>
                  {selectedNode && (
                    <NodeEditorPanel
                      node={selectedNode}
                      onSave={handleUpdateNode}
                      isDarkMode={isDarkMode}
                      variables={variables}
                    />
                  )}
                  {selectedEdge && (
                    <div className="p-4">
                      <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {t('workflow_edgeInfo')}: {selectedEdge.source} → {selectedEdge.target}
                      </p>
                      <p className={`mt-2 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {t('workflow_edgeDeleteHint')}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Right-click context menu */}
        {contextMenu && (
          <>
            {/* invisible overlay to close on outside click */}
            <div
              className="fixed inset-0 z-[150]"
              onClick={closeContextMenu}
              onContextMenu={e => {
                e.preventDefault();
                closeContextMenu();
              }}
            />
            <div
              style={{ left: contextMenu.x, top: contextMenu.y }}
              className={`fixed z-[151] min-w-[160px] rounded-md border py-1 shadow-xl ${
                isDarkMode ? 'border-slate-700 bg-slate-800 text-gray-200' : 'border-gray-200 bg-white text-gray-700'
              }`}>
              {contextMenu.target.kind === 'node' &&
                (() => {
                  const targetNode = nodes.find(n => n.id === (contextMenu.target as { nodeId: string }).nodeId);
                  const isStartOrEnd = targetNode?.type === 'start' || targetNode?.type === 'end';
                  return (
                    <>
                      <button
                        type="button"
                        disabled={isStartOrEnd}
                        onClick={() => {
                          if (!targetNode || isStartOrEnd) return;
                          // mark as selectedNode then duplicate
                          setSelectedNode({
                            id: targetNode.id,
                            type: targetNode.type as WorkflowNodeType,
                            name: (targetNode.data?.name as string) || targetNode.id,
                            position: targetNode.position,
                            data: (targetNode.data as NodeData) || {},
                          });
                          // run after state updates settle
                          setTimeout(() => {
                            handleDuplicateNode();
                            closeContextMenu();
                          }, 0);
                        }}
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs disabled:opacity-40 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
                        复制节点 <span className="text-[10px] opacity-60">Ctrl+D</span>
                      </button>
                      <button
                        type="button"
                        disabled={!clipboardRef.current?.length}
                        onClick={() => {
                          handlePaste();
                          closeContextMenu();
                        }}
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs disabled:opacity-40 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
                        粘贴 <span className="text-[10px] opacity-60">Ctrl+V</span>
                      </button>
                      <div className="my-1 border-t" style={{ borderColor: isDarkMode ? '#334155' : '#e5e7eb' }} />
                      <button
                        type="button"
                        disabled={isStartOrEnd}
                        onClick={() => {
                          if (!targetNode || isStartOrEnd) return;
                          setNodes(nds => nds.filter(n => n.id !== targetNode.id));
                          setEdges(eds => eds.filter(e => e.source !== targetNode.id && e.target !== targetNode.id));
                          if (selectedNode?.id === targetNode.id) setSelectedNode(null);
                          closeContextMenu();
                        }}
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-red-500 disabled:opacity-40 ${isDarkMode ? 'hover:bg-red-900/30' : 'hover:bg-red-50'}`}>
                        删除节点 <span className="text-[10px] opacity-60">Delete</span>
                      </button>
                    </>
                  );
                })()}
              {contextMenu.target.kind === 'edge' && (
                <button
                  type="button"
                  onClick={() => {
                    const eid = (contextMenu.target as { edgeId: string }).edgeId;
                    setEdges(eds => eds.filter(e => e.id !== eid));
                    if (selectedEdge?.id === eid) setSelectedEdge(null);
                    closeContextMenu();
                  }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-red-500 ${isDarkMode ? 'hover:bg-red-900/30' : 'hover:bg-red-50'}`}>
                  删除连线 <span className="text-[10px] opacity-60">Delete</span>
                </button>
              )}
              {contextMenu.target.kind === 'pane' && (
                <>
                  <button
                    type="button"
                    disabled={!clipboardRef.current?.length}
                    onClick={() => {
                      handlePaste();
                      closeContextMenu();
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs disabled:opacity-40 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
                    粘贴节点 <span className="text-[10px] opacity-60">Ctrl+V</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNodes(nds => nds.map(n => ({ ...n, selected: true })));
                      closeContextMenu();
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
                    全选 <span className="text-[10px] opacity-60">Ctrl+A</span>
                  </button>
                  <div className="my-1 border-t" style={{ borderColor: isDarkMode ? '#334155' : '#e5e7eb' }} />
                  <button
                    type="button"
                    onClick={() => {
                      handleAutoLayout();
                      closeContextMenu();
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
                    自动布局 <span className="text-[10px] opacity-60">Ctrl+L</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fitView({ padding: 0.2 });
                      closeContextMenu();
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
                    画布适配 <span className="text-[10px] opacity-60">Ctrl+0</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* Keyboard shortcut help overlay (Ctrl+/) */}
        {showShortcutHelp && (
          <div
            onClick={() => setShowShortcutHelp(false)}
            className="absolute inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
              onClick={e => e.stopPropagation()}
              className={`max-h-[80vh] w-[440px] max-w-[95vw] overflow-y-auto rounded-2xl border p-5 shadow-2xl ${
                isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'
              }`}>
              <div
                className={`mb-4 flex items-center justify-between ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                <h3 className="text-base font-semibold">键盘快捷键</h3>
                <button
                  type="button"
                  onClick={() => setShowShortcutHelp(false)}
                  className={`rounded p-1 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}>
                  <FiX className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-1 text-sm">
                {[
                  ['Ctrl/⌘ + S', '保存（含校验）'],
                  ['Ctrl/⌘ + E', '运行工作流'],
                  ['Ctrl/⌘ + L', '自动布局'],
                  ['Ctrl/⌘ + 0', '画布适配视图'],
                  ['Ctrl/⌘ + + / -', '放大 / 缩小'],
                  ['F11', '切换全屏'],
                  ['Ctrl/⌘ + Z', '撤销'],
                  ['Ctrl/⌘ + Shift + Z', '重做'],
                  ['Ctrl/⌘ + C / V', '复制 / 粘贴节点'],
                  ['Ctrl/⌘ + D', '原位复制选中节点'],
                  ['Ctrl/⌘ + A', '全选节点'],
                  ['Delete / Backspace', '删除选中'],
                  ['Tab / Shift + Tab', '在节点间切换选中'],
                  ['Ctrl/⌘ + 1 / 2 / 3', '切换右侧面板（节点 / 变量 / 日志）'],
                  ['Ctrl/⌘ + /', '显示/隐藏此帮助'],
                  ['Esc', '取消选择 / 关闭弹窗'],
                ].map(([key, desc]) => (
                  <div
                    key={key}
                    className={`flex items-center justify-between rounded px-2 py-1.5 ${
                      isDarkMode ? 'hover:bg-slate-700/50' : 'hover:bg-gray-50'
                    }`}>
                    <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>{desc}</span>
                    <kbd
                      className={`shrink-0 rounded border px-2 py-0.5 font-mono text-xs ${
                        isDarkMode
                          ? 'border-slate-600 bg-slate-900 text-gray-300'
                          : 'border-gray-300 bg-gray-50 text-gray-600'
                      }`}>
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ============ Public Export ============

export default function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
