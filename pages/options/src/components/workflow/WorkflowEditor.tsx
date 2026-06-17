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
  const { screenToFlowPosition } = useReactFlow();

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
  }, []);

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

  // ============ Keyboard Shortcuts ============
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
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
      if (e.key === 'Escape') {
        setSelectedNode(null);
        setSelectedEdge(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleDuplicateNode, handleUndo, handleRedo]);

  // ============ Execution Status Injection ============
  const nodesWithStatus = useMemo(() => {
    if (!executionState || executionState.status === 'idle') return nodes;
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
    <div className={`workflow-editor flex h-full flex-col ${isFullscreen ? 'fixed inset-0 z-[100]' : ''}`}>
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
      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <div
          className={`flex w-56 flex-col border-r ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-gray-200 bg-gray-50/80'}`}
          style={{ overflow: 'auto' }}>
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
            nodeTypes={nodeTypes}
            deleteKeyCode={['Backspace', 'Delete']}
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
            className={`w-72 overflow-y-auto border-l shadow-lg ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'}`}>
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
    </div>
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
