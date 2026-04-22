/**
 * Workflow Editor Component
 * Visual workflow editor using AntV X6 for creating/editing workflows
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Edge as X6Edge, Node as X6Node } from '@antv/x6';
import { Graph as X6Graph, Shape } from '@antv/x6';
import { register } from '@antv/x6-react-shape';
import { AntVDagreLayout } from '@antv/layout';
import type { NodeData as LayoutNodeData, EdgeData as LayoutEdgeData } from '@antv/layout';
import { Graph as LayoutGraph } from '@antv/graphlib';
import {
  FiCpu,
  FiMousePointer,
  FiGitBranch,
  FiPlay,
  FiXCircle,
  FiTrash2,
  FiX,
  FiMaximize2,
  FiMinimize2,
  FiLayout,
} from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowNodeType, NodeData } from '@extension/workflow';

// ============ Node Components with Ports ============

interface NodeComponentProps {
  node: { getData: () => NodeData };
}

/**
 * AI Module Node Component
 */
const AINodeComponent = ({ node }: NodeComponentProps) => {
  const data = node.getData();
  return (
    <div className="ai-node flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md min-w-[150px]">
      <FiCpu className="size-5" />
      <div className="flex flex-col">
        <span className="font-medium text-sm">AI Module</span>
        <span className="text-xs opacity-80 truncate max-w-[120px]">{data.prompt?.slice(0, 20) || 'AI Task'}...</span>
      </div>
    </div>
  );
};

/**
 * Automation Module Node Component
 */
const AutomationNodeComponent = ({ node }: NodeComponentProps) => {
  const data = node.getData();
  return (
    <div className="automation-node flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md min-w-[150px]">
      <FiMousePointer className="size-5" />
      <div className="flex flex-col">
        <span className="font-medium text-sm">Automation</span>
        <span className="text-xs opacity-80 truncate max-w-[120px]">{data.action || 'Action'}</span>
      </div>
    </div>
  );
};

/**
 * Condition Module Node Component - has two output ports for true/false branches
 */
const ConditionNodeComponent = ({ node }: NodeComponentProps) => {
  const data = node.getData();
  return (
    <div className="condition-node flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md min-w-[150px]">
      <FiGitBranch className="size-5" />
      <div className="flex flex-col">
        <span className="font-medium text-sm">Condition</span>
        <span className="text-xs opacity-80 truncate max-w-[120px]">
          {data.conditionExpression?.slice(0, 20) || 'Branch'}...
        </span>
      </div>
    </div>
  );
};

/**
 * Start Node Component - only has output port
 */
const StartNodeComponent = () => (
  <div className="start-node flex items-center justify-center size-10 rounded-full bg-green-500 text-white shadow-md">
    <FiPlay className="size-5" />
  </div>
);

/**
 * End Node Component - only has input port
 */
const EndNodeComponent = () => (
  <div className="end-node flex items-center justify-center size-10 rounded-full bg-red-500 text-white shadow-md">
    <FiXCircle className="size-5" />
  </div>
);

// Register React node shapes with ports (ports are hidden by default, show on hover)
register({
  shape: 'workflow-ai-node',
  component: AINodeComponent,
  width: 180,
  height: 60,
  ports: {
    groups: {
      in: {
        position: 'left',
        attrs: {
          circle: {
            r: 6,
            magnet: true,
            stroke: '#9333ea',
            strokeWidth: 2,
            fill: '#fff',
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
      out: {
        position: 'right',
        attrs: {
          circle: {
            r: 6,
            magnet: true,
            stroke: '#9333ea',
            strokeWidth: 2,
            fill: '#fff',
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
    },
    items: [
      { id: 'in', group: 'in' },
      { id: 'out', group: 'out' },
    ],
  },
});

register({
  shape: 'workflow-automation-node',
  component: AutomationNodeComponent,
  width: 180,
  height: 60,
  ports: {
    groups: {
      in: {
        position: 'left',
        attrs: {
          circle: {
            r: 6,
            magnet: true,
            stroke: '#3b82f6',
            strokeWidth: 2,
            fill: '#fff',
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
      out: {
        position: 'right',
        attrs: {
          circle: {
            r: 6,
            magnet: true,
            stroke: '#3b82f6',
            strokeWidth: 2,
            fill: '#fff',
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
    },
    items: [
      { id: 'in', group: 'in' },
      { id: 'out', group: 'out' },
    ],
  },
});

register({
  shape: 'workflow-condition-node',
  component: ConditionNodeComponent,
  width: 180,
  height: 60,
  ports: {
    groups: {
      in: {
        position: 'left',
        attrs: {
          circle: {
            r: 6,
            magnet: true,
            stroke: '#f97316',
            strokeWidth: 2,
            fill: '#fff',
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
      outTrue: {
        position: { name: 'right', args: { y: 15 } },
        attrs: {
          circle: {
            r: 6,
            magnet: true,
            stroke: '#22c55e',
            strokeWidth: 2,
            fill: '#fff',
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
      outFalse: {
        position: { name: 'right', args: { y: 45 } },
        attrs: {
          circle: {
            r: 6,
            magnet: true,
            stroke: '#ef4444',
            strokeWidth: 2,
            fill: '#fff',
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
    },
    items: [
      { id: 'in', group: 'in' },
      { id: 'out-true', group: 'outTrue' },
      { id: 'out-false', group: 'outFalse' },
    ],
  },
});

register({
  shape: 'workflow-start-node',
  component: StartNodeComponent,
  width: 50,
  height: 50,
  ports: {
    groups: {
      out: {
        position: 'right',
        attrs: {
          circle: {
            r: 6,
            magnet: true,
            stroke: '#22c55e',
            strokeWidth: 2,
            fill: '#fff',
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
    },
    items: [{ id: 'out', group: 'out' }],
  },
});

register({
  shape: 'workflow-end-node',
  component: EndNodeComponent,
  width: 50,
  height: 50,
  ports: {
    groups: {
      in: {
        position: 'left',
        attrs: {
          circle: {
            r: 6,
            magnet: true,
            stroke: '#ef4444',
            strokeWidth: 2,
            fill: '#fff',
            style: {
              visibility: 'hidden',
            },
          },
        },
      },
    },
    items: [{ id: 'in', group: 'in' }],
  },
});

// ============ Workflow Editor Props ============

interface WorkflowEditorProps {
  workflow?: Workflow;
  onSave: (workflow: Workflow) => void;
  onCancel: () => void;
  isDarkMode?: boolean;
}

// ============ Node Palette Data ============

const nodePalette = [
  { type: 'ai', label: 'AI Module', icon: FiCpu, shape: 'workflow-ai-node' },
  { type: 'automation', label: 'Automation', icon: FiMousePointer, shape: 'workflow-automation-node' },
  { type: 'condition', label: 'Condition', icon: FiGitBranch, shape: 'workflow-condition-node' },
];

// ============ Main Workflow Editor Component ============

export default function WorkflowEditor({
  workflow: initialWorkflow,
  onSave,
  onCancel,
  isDarkMode = false,
}: WorkflowEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<X6Graph | null>(null);

  const [workflowId] = useState(initialWorkflow?.id || `workflow-${Date.now()}`);
  const [workflowName, setWorkflowName] = useState(initialWorkflow?.name || 'New Workflow');
  const [workflowDescription, setWorkflowDescription] = useState(initialWorkflow?.description || '');
  const [workflowCategory, setWorkflowCategory] = useState<string>(initialWorkflow?.category || 'automation');
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<X6Edge | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Initialize graph
  useEffect(() => {
    if (!containerRef.current) return;

    // Helper function to get shape name for node type
    const getShapeForNodeType = (type: WorkflowNodeType): string => {
      switch (type) {
        case 'ai':
          return 'workflow-ai-node';
        case 'automation':
          return 'workflow-automation-node';
        case 'condition':
          return 'workflow-condition-node';
        case 'start':
          return 'workflow-start-node';
        case 'end':
          return 'workflow-end-node';
        default:
          return 'workflow-automation-node';
      }
    };

    // Helper function to load workflow into graph
    const loadWorkflowIntoGraph = (graph: X6Graph, workflow: Workflow) => {
      try {
        // Add nodes
        for (const node of workflow.nodes) {
          const shape = getShapeForNodeType(node.type);
          // Handle missing position or data
          const position = node.position || { x: 100, y: 100 };
          const nodeData = node.data || {};
          graph.addNode({
            shape,
            x: position.x,
            y: position.y,
            id: node.id,
            data: { ...nodeData, type: node.type, name: node.name || node.id },
          });
        }

        // Add edges
        for (const edge of workflow.edges) {
          graph.addEdge(
            new Shape.Edge({
              id: edge.id || `edge-${Date.now()}`,
              source: edge.source,
              target: edge.target,
              attrs: {
                line: {
                  stroke: isDarkMode ? '#60A5FA' : '#A2B1C3',
                  strokeWidth: 2,
                  targetMarker: {
                    name: 'block',
                    width: 12,
                    height: 8,
                  },
                },
              },
              router: {
                name: 'manhattan',
                args: {
                  padding: 1,
                },
              },
              connector: {
                name: 'rounded',
                args: {
                  radius: 8,
                },
              },
              zIndex: 0,
            }),
          );
        }
      } catch (error) {
        console.error('[WorkflowEditor] Failed to load workflow:', error);
      }
    };

    // Create graph instance
    const graph: X6Graph = new X6Graph({
      container: containerRef.current,
      grid: {
        visible: true,
        type: 'dot',
        size: 20,
      },
      panning: {
        enabled: true,
      },
      mousewheel: {
        enabled: true,
        zoomAtMousePosition: true,
        modifiers: [],
        minScale: 0.5,
        maxScale: 2,
      },
      connecting: {
        router: {
          name: 'manhattan',
          args: {
            padding: 1,
          },
        },
        connector: {
          name: 'rounded',
          args: {
            radius: 8,
          },
        },
        anchor: 'center',
        connectionPoint: 'anchor',
        allowBlank: false,
        allowLoop: false,
        allowNode: true,
        allowEdge: false,
        snap: {
          radius: 20,
        },
        createEdge() {
          return new Shape.Edge({
            attrs: {
              line: {
                stroke: isDarkMode ? '#60A5FA' : '#A2B1C3',
                strokeWidth: 2,
                targetMarker: {
                  name: 'block',
                  width: 12,
                  height: 8,
                },
              },
            },
            zIndex: 0,
          });
        },
        validateConnection({ targetMagnet }) {
          return !!targetMagnet;
        },
      },
      highlighting: {
        magnetAdsorbed: {
          name: 'stroke',
          args: {
            attrs: {
              fill: '#5F95FF',
              stroke: '#5F95FF',
            },
          },
        },
      },
    });

    graphRef.current = graph;

    // Load initial workflow nodes if provided
    if (initialWorkflow) {
      loadWorkflowIntoGraph(graph, initialWorkflow);
    } else {
      // Add default start and end nodes for new workflow
      graph.addNode({
        shape: 'workflow-start-node',
        x: 100,
        y: 200,
        id: 'start',
        data: { type: 'start' },
      });
      graph.addNode({
        shape: 'workflow-end-node',
        x: 600,
        y: 200,
        id: 'end',
        data: { type: 'end' },
      });
    }

    // Handle node click for editing
    graph.on('node:click', ({ node }: { node: X6Node }) => {
      const nodeData = node.getData() as Record<string, unknown>;
      const nodeType = nodeData['type'] as string | undefined;
      // Clear edge selection
      setSelectedEdge(null);
      // Only select editable nodes (not start/end)
      if (nodeType && ['ai', 'automation', 'condition'].includes(nodeType)) {
        setSelectedNode({
          id: node.id,
          type: nodeType as WorkflowNodeType,
          name: (nodeData['name'] as string) || '',
          position: { x: node.position().x, y: node.position().y },
          data: nodeData as NodeData,
        });
      } else {
        setSelectedNode(null);
      }
    });

    // Handle edge click for selection
    graph.on('edge:click', ({ edge }: { edge: X6Edge }) => {
      setSelectedNode(null);
      setSelectedEdge(edge);
    });

    // Handle blank click to deselect
    graph.on('blank:click', () => {
      setSelectedNode(null);
      setSelectedEdge(null);
    });

    // Show ports on node mouseenter
    graph.on('node:mouseenter', ({ node }) => {
      const ports = node.getPorts();
      ports.forEach(port => {
        if (port.id) {
          node.setPortProp(port.id, 'attrs/circle/style/visibility', 'visible');
        }
      });
    });

    // Hide ports on node mouseleave (except when connecting)
    graph.on('node:mouseleave', ({ node }) => {
      const ports = node.getPorts();
      ports.forEach(port => {
        if (port.id) {
          node.setPortProp(port.id, 'attrs/circle/style/visibility', 'hidden');
        }
      });
    });

    // Also show ports when starting to connect from a port
    graph.on('node:port:mouseenter', ({ node, port: portId }) => {
      if (portId) {
        node.setPortProp(portId, 'attrs/circle/style/visibility', 'visible');
      }
    });

    // Cleanup
    return () => {
      graph.dispose();
    };
  }, [initialWorkflow, isDarkMode]);

  // Get shape name for node type (for use outside useEffect)
  const getShapeForNodeType = useCallback((type: WorkflowNodeType): string => {
    switch (type) {
      case 'ai':
        return 'workflow-ai-node';
      case 'automation':
        return 'workflow-automation-node';
      case 'condition':
        return 'workflow-condition-node';
      case 'start':
        return 'workflow-start-node';
      case 'end':
        return 'workflow-end-node';
      default:
        return 'workflow-automation-node';
    }
  }, []);

  // Add node from palette
  const handleAddNode = (type: WorkflowNodeType) => {
    if (!graphRef.current) return;

    const graph = graphRef.current;
    const shape = getShapeForNodeType(type);
    const nodeId = `node-${Date.now()}`;

    // Calculate position based on graph center or viewport
    const area = graph.getGraphArea();
    const position = { x: (area.x + area.width) / 2, y: (area.y + area.height) / 2 };

    const data: NodeData = {};
    if (type === 'ai') {
      data.prompt = '';
    } else if (type === 'automation') {
      data.action = 'wait';
      data.parameters = {};
    } else if (type === 'condition') {
      data.conditionExpression = '';
      data.trueNodeId = '';
      data.falseNodeId = '';
      data.evaluateWithAI = true;
    }

    graph.addNode({
      shape,
      x: position.x,
      y: position.y,
      id: nodeId,
      data: { ...data, type, name: nodePalette.find(n => n.type === type)?.label || type },
    });

    // Select the newly added node
    setSelectedNode({
      id: nodeId,
      type,
      name: nodePalette.find(n => n.type === type)?.label || type,
      position,
      data: { ...data, type, name: nodePalette.find(n => n.type === type)?.label || type },
    });
  };

  // Delete selected node
  const handleDeleteNode = () => {
    if (!graphRef.current || !selectedNode) return;

    const node = graphRef.current.getCellById(selectedNode.id);
    if (node) {
      // Remove connected edges first
      const edges = graphRef.current.getConnectedEdges(node);
      edges.forEach(edge => edge.remove());
      // Remove node
      node.remove();
    }
    setSelectedNode(null);
  };

  // Delete selected edge
  const handleDeleteEdge = () => {
    if (!selectedEdge) return;
    selectedEdge.remove();
    setSelectedEdge(null);
  };

  // Auto layout the graph using Dagre layout
  const handleAutoLayout = async () => {
    if (!graphRef.current) return;

    const graph = graphRef.current;
    const nodes = graph.getNodes();
    const edges = graph.getEdges();

    if (nodes.length === 0) return;

    // Create a layout graph with nodes and edges data
    // Cast to expected Graph type from @antv/layout
    const layoutGraph = new LayoutGraph<LayoutNodeData, LayoutEdgeData>({
      nodes: nodes.map(node => ({
        id: node.id,
        data: {
          x: node.position().x,
          y: node.position().y,
          size: [node.getSize().width, node.getSize().height],
        } as LayoutNodeData,
      })),
      edges: edges.map(edge => ({
        id: edge.id,
        source: edge.getSourceCellId() || '',
        target: edge.getTargetCellId() || '',
        data: {} as LayoutEdgeData,
      })),
    });

    // Create AntVDagre layout instance
    const dagreLayout = new AntVDagreLayout({
      rankdir: 'LR', // Left to right layout
      align: 'UL', // Upper-left alignment
      nodesep: 60, // Horizontal spacing between nodes in same rank
      ranksep: 120, // Spacing between ranks (columns)
      nodeSize: 180,
    });

    // Execute layout
    const result = await dagreLayout.execute(layoutGraph);

    // Apply new positions to nodes
    result.nodes.forEach(layoutNode => {
      const cell = graph.getCellById(String(layoutNode.id));
      if (cell && cell.isNode()) {
        // Get the size from node data or default
        const size = layoutNode.data?.size || [180, 60];
        const width = typeof size === 'number' ? size : size[0] || 180;
        const height = typeof size === 'number' ? size : size[1] || 60;
        // Center the node at the layout position
        cell.position(layoutNode.data.x - width / 2, layoutNode.data.y - height / 2);
      }
    });

    // Center the graph in the viewport
    const graphArea = graph.getGraphArea();
    const contentArea = graph.getContentArea();
    const centerX = (graphArea.x + graphArea.width) / 2 - contentArea.width / 2;
    const centerY = (graphArea.y + graphArea.height) / 2 - contentArea.height / 2;
    graph.translate(centerX, centerY);

    // Clear selection after layout
    setSelectedNode(null);
    setSelectedEdge(null);
  };

  // Convert graph to workflow
  const convertGraphToWorkflow = useCallback((): Workflow => {
    if (!graphRef.current) return createEmptyWorkflow();

    const graph = graphRef.current;
    const nodes: WorkflowNode[] = [];
    const edges: WorkflowEdge[] = [];

    // Convert nodes
    graph.getNodes().forEach(node => {
      const data = node.getData();
      nodes.push({
        id: node.id,
        type: data.type as WorkflowNodeType,
        name: data.name || node.id,
        position: { x: node.position().x, y: node.position().y },
        data: data,
      });
    });

    // Convert edges
    graph.getEdges().forEach(edge => {
      edges.push({
        id: edge.id,
        source: edge.getSourceCellId() || '',
        target: edge.getTargetCellId() || '',
      });
    });

    return {
      id: workflowId,
      name: workflowName || 'Untitled Workflow',
      description: workflowDescription || `${workflowName || 'Untitled Workflow'} - automated workflow`,
      version: '1.0.0',
      category: workflowCategory as Workflow['category'],
      nodes,
      edges,
      variables: [],
      executionConfig: { onError: 'stop' },
      createdAt: initialWorkflow?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
  }, [workflowId, workflowName, workflowDescription, workflowCategory, initialWorkflow]);

  // Create empty workflow
  const createEmptyWorkflow = (): Workflow => ({
    id: workflowId,
    name: workflowName,
    description: workflowDescription,
    version: '1.0.0',
    category: workflowCategory as Workflow['category'],
    nodes: [],
    edges: [],
    variables: [],
    executionConfig: { onError: 'stop' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  // Save workflow
  const handleSave = () => {
    const workflow = convertGraphToWorkflow();
    onSave(workflow);
  };

  // Update selected node data
  const handleUpdateNode = (updatedNode: WorkflowNode) => {
    if (!graphRef.current || !selectedNode) return;

    const node = graphRef.current.getCellById(selectedNode.id);
    if (node) {
      node.setData({ ...updatedNode.data, name: updatedNode.name, type: updatedNode.type });
      // Force re-render
      node.setAttrs({});
    }
    setSelectedNode(updatedNode);
  };

  return (
    <div className={`workflow-editor flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-[100]' : ''}`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-center gap-3 flex-1">
          <input
            type="text"
            value={workflowName}
            onChange={e => setWorkflowName(e.target.value)}
            placeholder={t('workflow_name_placeholder')}
            className={`px-3 py-1.5 rounded-md border text-sm font-medium w-40 ${
              isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
            }`}
          />
          <input
            type="text"
            value={workflowDescription}
            onChange={e => setWorkflowDescription(e.target.value)}
            placeholder={t('workflow_description_placeholder')}
            className={`px-3 py-1.5 rounded-md border text-sm flex-1 max-w-md ${
              isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
            }`}
          />
          <select
            value={workflowCategory}
            onChange={e => setWorkflowCategory(e.target.value)}
            className={`px-3 py-1.5 rounded-md border text-sm ${
              isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
            }`}>
            <option value="automation">{t('workflow_category_automation')}</option>
            <option value="navigation">{t('workflow_category_navigation')}</option>
            <option value="data-extraction">{t('workflow_category_dataExtraction')}</option>
            <option value="form-interaction">{t('workflow_category_formInteraction')}</option>
            <option value="analysis">{t('workflow_category_analysis')}</option>
            <option value="custom">{t('workflow_category_custom')}</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAutoLayout}
            className={`p-2 rounded-md ${
              isDarkMode
                ? 'bg-slate-600 text-gray-200 hover:bg-slate-500'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            title={t('workflow_autoLayout')}>
            <FiLayout className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={`p-2 rounded-md ${
              isDarkMode
                ? 'bg-slate-600 text-gray-200 hover:bg-slate-500'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            title={isFullscreen ? t('workflow_exitFullscreen') : t('workflow_enterFullscreen')}>
            {isFullscreen ? <FiMinimize2 className="size-4" /> : <FiMaximize2 className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={`px-4 py-1.5 rounded-md text-sm ${
              isDarkMode
                ? 'bg-slate-600 text-gray-200 hover:bg-slate-500'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}>
            {t('workflow_cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-500">
            {t('workflow_save')}
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex flex-1">
        {/* Node Palette */}
        <div
          className={`w-48 border-r p-3 ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-50'}`}>
          <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {t('workflow_nodePalette')}
          </h3>
          <div className="space-y-2">
            {nodePalette.map(item => (
              <button
                key={item.type}
                type="button"
                onClick={() => handleAddNode(item.type as WorkflowNodeType)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md w-full text-sm ${
                  isDarkMode
                    ? 'bg-slate-700 text-gray-200 hover:bg-slate-600'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}>
                <item.icon className="size-4" />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Graph Canvas */}
        <div
          ref={containerRef}
          className={`flex-1 ${isDarkMode ? 'bg-slate-900' : 'bg-gray-100'}`}
          style={{ minHeight: '400px' }}
        />

        {/* Right-side Node Editor Panel */}
        {(selectedNode || selectedEdge) && (
          <div
            className={`w-72 border-l overflow-y-auto ${
              isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'
            }`}>
            {/* Panel Header with Close and Delete buttons */}
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${
                isDarkMode ? 'border-slate-700' : 'border-gray-200'
              }`}>
              <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                {selectedNode ? t('workflow_editNode') : t('workflow_editEdge')}
              </h3>
              <div className="flex items-center gap-1">
                {selectedNode && (
                  <button
                    type="button"
                    onClick={handleDeleteNode}
                    className="p-1.5 rounded-md text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
                    title={t('workflow_delete')}>
                    <FiTrash2 className="size-4" />
                  </button>
                )}
                {selectedEdge && (
                  <button
                    type="button"
                    onClick={handleDeleteEdge}
                    className="p-1.5 rounded-md text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
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
                  className={`p-1.5 rounded-md ${
                    isDarkMode ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                  title={t('workflow_close')}>
                  <FiX className="size-4" />
                </button>
              </div>
            </div>

            {/* Node Editor Content */}
            {selectedNode && <NodeEditorPanel node={selectedNode} onSave={handleUpdateNode} isDarkMode={isDarkMode} />}

            {/* Edge Editor Content */}
            {selectedEdge && (
              <div className="p-4">
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('workflow_edgeInfo')}: {selectedEdge.getSourceCellId()} → {selectedEdge.getTargetCellId()}
                </p>
                <p className={`text-xs mt-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {t('workflow_edgeDeleteHint')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Node Editor Panel (Right Side) ============

interface NodeEditorPanelProps {
  node: WorkflowNode;
  onSave: (node: WorkflowNode) => void;
  isDarkMode: boolean;
}

function NodeEditorPanel({ node, onSave, isDarkMode }: NodeEditorPanelProps) {
  const [editedNode, setEditedNode] = useState(node);

  // Sync when node changes
  useEffect(() => {
    setEditedNode(node);
  }, [node]);

  // Get action-specific parameter fields based on selected action
  const getActionParameters = (
    action: string,
  ): { key: string; label: string; type: 'text' | 'number' | 'textarea'; placeholder?: string }[] => {
    switch (action) {
      case 'go_to_url':
        return [{ key: 'url', label: t('workflow_param_url'), type: 'text', placeholder: 'https://example.com' }];
      case 'click_element':
        return [
          { key: 'selector', label: t('workflow_param_selector'), type: 'text', placeholder: 'css selector or xpath' },
          { key: 'xpath', label: t('workflow_param_xpath'), type: 'text', placeholder: 'XPath expression' },
        ];
      case 'input_text':
        return [
          { key: 'selector', label: t('workflow_param_selector'), type: 'text', placeholder: 'css selector or xpath' },
          { key: 'xpath', label: t('workflow_param_xpath'), type: 'text', placeholder: 'XPath expression' },
          { key: 'text', label: t('workflow_param_text'), type: 'text', placeholder: 'Text to input' },
        ];
      case 'send_keys':
        return [
          { key: 'keys', label: t('workflow_param_keys'), type: 'text', placeholder: 'Enter, Tab, Escape, etc.' },
        ];
      case 'scroll_to_percent':
        return [{ key: 'yPercent', label: t('workflow_param_yPercent'), type: 'number', placeholder: '0-100' }];
      case 'scroll_to_text':
        return [{ key: 'text', label: t('workflow_param_scrollText'), type: 'text', placeholder: 'Text to scroll to' }];
      case 'select_dropdown_option':
        return [
          {
            key: 'selector',
            label: t('workflow_param_selector'),
            type: 'text',
            placeholder: 'css selector for dropdown',
          },
          { key: 'text', label: t('workflow_param_optionText'), type: 'text', placeholder: 'Option text to select' },
        ];
      case 'wait':
        return [{ key: 'duration', label: t('workflow_param_duration'), type: 'number', placeholder: 'milliseconds' }];
      case 'open_tab':
        return [
          { key: 'url', label: t('workflow_param_url'), type: 'text', placeholder: 'https://example.com (optional)' },
        ];
      case 'switch_tab':
        return [
          { key: 'tabIndex', label: t('workflow_param_tabIndex'), type: 'number', placeholder: 'Tab index (0-based)' },
        ];
      default:
        return [];
    }
  };

  // Handle action change - reset parameters
  const handleActionChange = (newAction: string) => {
    const newParams: Record<string, unknown> = {};
    const paramFields = getActionParameters(newAction);
    // Initialize parameters with empty values
    for (const field of paramFields) {
      newParams[field.key] = field.type === 'number' ? 0 : '';
    }
    const updated = {
      ...editedNode,
      data: {
        ...editedNode.data,
        action: newAction,
        parameters: newParams,
      },
    };
    setEditedNode(updated);
    onSave(updated);
  };

  // Handle parameter change
  const handleParameterChange = (key: string, value: string | number) => {
    const currentParams = editedNode.data.parameters || {};
    const updated = {
      ...editedNode,
      data: {
        ...editedNode.data,
        parameters: { ...currentParams, [key]: value },
      },
    };
    setEditedNode(updated);
    onSave(updated);
  };

  // Handle other field changes
  const handleFieldChange = (field: string, value: string | boolean) => {
    const updated = {
      ...editedNode,
      data: {
        ...editedNode.data,
        [field]: value,
      },
    };
    setEditedNode(updated);
    onSave(updated);
  };

  // Handle name change
  const handleNameChange = (value: string) => {
    const updated = { ...editedNode, name: value };
    setEditedNode(updated);
    onSave(updated);
  };

  // Current action and its parameters
  const currentAction = editedNode.data.action || 'wait';
  const currentParams = editedNode.data.parameters || {};
  const actionParamFields = getActionParameters(currentAction);

  return (
    <div className="p-4 space-y-4">
      {/* Node Name */}
      <div>
        <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {t('workflow_nodeName')}
        </label>
        <input
          type="text"
          value={editedNode.name}
          onChange={e => handleNameChange(e.target.value)}
          className={`mt-1 w-full px-3 py-2 rounded-md border text-sm ${
            isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
          }`}
        />
      </div>

      {/* Node Type Badge */}
      <div>
        <span
          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
            editedNode.type === 'ai'
              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
              : editedNode.type === 'automation'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
          }`}>
          {editedNode.type === 'ai' ? 'AI Module' : editedNode.type === 'automation' ? 'Automation' : 'Condition'}
        </span>
      </div>

      {/* Type-specific fields */}
      {editedNode.type === 'ai' && (
        <div className="space-y-3">
          <div>
            <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {t('workflow_aiPrompt')}
            </label>
            <textarea
              value={editedNode.data.prompt || ''}
              onChange={e => handleFieldChange('prompt', e.target.value)}
              className={`mt-1 w-full px-3 py-2 rounded-md border text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}
              rows={4}
            />
          </div>
          <div>
            <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {t('workflow_outputVariable')}
            </label>
            <input
              type="text"
              value={editedNode.data.outputVariable || ''}
              onChange={e => handleFieldChange('outputVariable', e.target.value)}
              className={`mt-1 w-full px-3 py-2 rounded-md border text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}
            />
          </div>
        </div>
      )}

      {editedNode.type === 'automation' && (
        <div className="space-y-3">
          {/* Intent field */}
          <div>
            <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {t('workflow_intent')}
            </label>
            <input
              type="text"
              value={editedNode.data.intent || ''}
              onChange={e => handleFieldChange('intent', e.target.value)}
              className={`mt-1 w-full px-3 py-2 rounded-md border text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}
              placeholder={t('workflow_intent_placeholder')}
            />
          </div>
          {/* Action selector */}
          <div>
            <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {t('workflow_action')}
            </label>
            <select
              value={currentAction}
              onChange={e => handleActionChange(e.target.value)}
              className={`mt-1 w-full px-3 py-2 rounded-md border text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}>
              <option value="click_element">{t('workflow_action_clickElement')}</option>
              <option value="input_text">{t('workflow_action_inputText')}</option>
              <option value="go_to_url">{t('workflow_action_goToUrl')}</option>
              <option value="go_back">{t('workflow_action_goBack')}</option>
              <option value="go_forward">{t('workflow_action_goForward')}</option>
              <option value="scroll_to_percent">{t('workflow_action_scroll')}</option>
              <option value="scroll_to_top">{t('workflow_action_scrollTop')}</option>
              <option value="scroll_to_bottom">{t('workflow_action_scrollBottom')}</option>
              <option value="scroll_to_text">{t('workflow_action_scrollText')}</option>
              <option value="wait">{t('workflow_action_wait')}</option>
              <option value="open_tab">{t('workflow_action_openTab')}</option>
              <option value="close_tab">{t('workflow_action_closeTab')}</option>
              <option value="switch_tab">{t('workflow_action_switchTab')}</option>
              <option value="send_keys">{t('workflow_action_sendKeys')}</option>
              <option value="select_dropdown_option">{t('workflow_action_selectDropdown')}</option>
              <option value="get_dropdown_options">{t('workflow_action_getDropdownOptions')}</option>
              <option value="cache_content">{t('workflow_action_cacheContent')}</option>
            </select>
          </div>
          {/* Dynamic action-specific parameters */}
          {actionParamFields.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-dashed ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}">
              <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('workflow_parameters')}
              </label>
              {actionParamFields.map(field => (
                <div key={field.key}>
                  <label className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>{field.label}</label>
                  {field.type === 'number' ? (
                    <input
                      type="number"
                      value={(currentParams[field.key] as number) || 0}
                      onChange={e => handleParameterChange(field.key, parseFloat(e.target.value) || 0)}
                      className={`mt-0.5 w-full px-3 py-1.5 rounded-md border text-sm ${
                        isDarkMode
                          ? 'border-slate-600 bg-slate-700 text-gray-200'
                          : 'border-gray-300 bg-white text-gray-700'
                      }`}
                      placeholder={field.placeholder}
                    />
                  ) : (
                    <input
                      type="text"
                      value={(currentParams[field.key] as string) || ''}
                      onChange={e => handleParameterChange(field.key, e.target.value)}
                      className={`mt-0.5 w-full px-3 py-1.5 rounded-md border text-sm ${
                        isDarkMode
                          ? 'border-slate-600 bg-slate-700 text-gray-200'
                          : 'border-gray-300 bg-white text-gray-700'
                      }`}
                      placeholder={field.placeholder}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editedNode.type === 'condition' && (
        <div className="space-y-3">
          <div>
            <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {t('workflow_conditionExpression')}
            </label>
            <textarea
              value={editedNode.data.conditionExpression || ''}
              onChange={e => handleFieldChange('conditionExpression', e.target.value)}
              className={`mt-1 w-full px-3 py-2 rounded-md border text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}
              rows={2}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={editedNode.data.evaluateWithAI ?? true}
              onChange={e => handleFieldChange('evaluateWithAI', e.target.checked)}
              className="rounded"
            />
            <label className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('workflow_evaluateWithAI')}
            </label>
          </div>
          <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {t('workflow_conditionPortsHint')}
          </p>
        </div>
      )}
    </div>
  );
}
