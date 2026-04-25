/**
 * Workflow Editor Component
 * Visual workflow editor using AntV X6 for creating/editing workflows
 * Supports drag-and-drop from left palette to canvas via @antv/x6-plugin-dnd
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Edge as X6Edge, Node as X6Node } from '@antv/x6';
import { Graph as X6Graph, Shape } from '@antv/x6';
import { register } from '@antv/x6-react-shape';
import { Dnd } from '@antv/x6-plugin-dnd';
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
  FiMoreVertical,
} from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { MessageKey } from '@extension/i18n';
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowNodeType, NodeData } from '@extension/workflow';

// ============ Node Components with Ports ============

/** Extended NodeData with runtime-only UI state (selected) */
interface NodeDataWithUI extends NodeData {
  selected?: boolean;
}

interface NodeComponentProps {
  node: { getData: () => NodeDataWithUI };
}

/**
 * AI Module Node Component
 */
const AINodeComponent = ({ node }: NodeComponentProps) => {
  const data = node.getData();
  const isSelected = data.selected;
  return (
    <div
      className={`ai-node flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-white shadow-lg min-w-[160px] transition-all duration-150 ${
        isSelected
          ? 'bg-gradient-to-r from-purple-400 to-purple-500 ring-2 ring-blue-400 ring-offset-1 shadow-blue-400/30'
          : 'bg-gradient-to-r from-purple-500 to-purple-600 hover:scale-[1.03]'
      }`}>
      <div className="flex items-center justify-center size-8 rounded-lg bg-white/20 shrink-0">
        <FiCpu className="size-4" />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="font-semibold text-sm leading-tight">{t('workflow_nodeType_ai')}</span>
        <span className="text-xs opacity-75 truncate max-w-[110px]">
          {data.prompt?.slice(0, 20) || t('workflow_nodeType_ai_default')}...
        </span>
      </div>
    </div>
  );
};

/**
 * Automation Module Node Component
 */
const AutomationNodeComponent = ({ node }: NodeComponentProps) => {
  const data = node.getData();
  const isSelected = data.selected;
  return (
    <div
      className={`automation-node flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-white shadow-lg min-w-[160px] transition-all duration-150 ${
        isSelected
          ? 'bg-gradient-to-r from-blue-400 to-blue-500 ring-2 ring-blue-400 ring-offset-1 shadow-blue-400/30'
          : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:scale-[1.03]'
      }`}>
      <div className="flex items-center justify-center size-8 rounded-lg bg-white/20 shrink-0">
        <FiMousePointer className="size-4" />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="font-semibold text-sm leading-tight">{t('workflow_nodeType_automation')}</span>
        <span className="text-xs opacity-75 truncate max-w-[110px]">
          {data.action || t('workflow_nodeType_automation_default')}
        </span>
      </div>
    </div>
  );
};

/**
 * Condition Module Node Component - dynamically renders branch names
 */
const ConditionNodeComponent = ({ node }: NodeComponentProps) => {
  const data = node.getData();
  const isSelected = data.selected;
  const branches = data.branches || [];
  return (
    <div
      className={`condition-node flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-white shadow-lg min-w-[160px] transition-all duration-150 ${
        isSelected
          ? 'bg-gradient-to-r from-orange-400 to-orange-500 ring-2 ring-blue-400 ring-offset-1 shadow-blue-400/30'
          : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:scale-[1.03]'
      }`}>
      <div className="flex items-center justify-center size-8 rounded-lg bg-white/20 shrink-0">
        <FiGitBranch className="size-4" />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="font-semibold text-sm leading-tight">{t('workflow_nodeType_condition')}</span>
        {branches.length > 0 ? (
          <div className="flex flex-col gap-0.5 mt-0.5">
            {branches.map(b => (
              <span key={b.id} className="text-xs opacity-80 truncate max-w-[110px] leading-tight">
                → {b.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs opacity-75 truncate max-w-[110px]">
            {data.conditionExpression?.slice(0, 20) || t('workflow_nodeType_condition_default')}...
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Start Node Component - only has output port
 */
const StartNodeComponent = ({ node }: NodeComponentProps) => {
  const data = node.getData();
  const isSelected = data.selected;
  return (
    <div
      className={`start-node flex items-center justify-center size-11 rounded-full text-white shadow-lg transition-all duration-150 ${
        isSelected
          ? 'bg-green-400 ring-2 ring-blue-400 ring-offset-1 shadow-green-400/30'
          : 'bg-gradient-to-br from-green-400 to-green-500 hover:scale-[1.06]'
      }`}>
      <FiPlay className="size-5" />
    </div>
  );
};

/**
 * End Node Component - only has input port
 */
const EndNodeComponent = ({ node }: NodeComponentProps) => {
  const data = node.getData();
  const isSelected = data.selected;
  return (
    <div
      className={`end-node flex items-center justify-center size-11 rounded-full text-white shadow-lg transition-all duration-150 ${
        isSelected
          ? 'bg-red-400 ring-2 ring-blue-400 ring-offset-1 shadow-red-400/30'
          : 'bg-gradient-to-br from-red-400 to-red-500 hover:scale-[1.06]'
      }`}>
      <FiXCircle className="size-5" />
    </div>
  );
};

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
  height: 80,
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
      out: {
        position: 'right',
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
    },
    items: [{ id: 'in', group: 'in' }],
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

interface PaletteItem {
  type: string;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
  shape: string;
  color: string;
  bgClass: string;
  iconClass: string;
  borderClass: string;
}

const nodePalette: PaletteItem[] = [
  {
    type: 'ai',
    labelKey: 'workflow_nodeType_ai',
    descriptionKey: 'workflow_nodeType_ai_desc',
    icon: FiCpu,
    shape: 'workflow-ai-node',
    color: 'purple',
    bgClass: 'bg-purple-50 dark:bg-purple-900/20',
    iconClass: 'text-purple-500',
    borderClass: 'border-purple-200 dark:border-purple-700/50',
  },
  {
    type: 'automation',
    labelKey: 'workflow_nodeType_automation',
    descriptionKey: 'workflow_nodeType_automation_desc',
    icon: FiMousePointer,
    shape: 'workflow-automation-node',
    color: 'blue',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    iconClass: 'text-blue-500',
    borderClass: 'border-blue-200 dark:border-blue-700/50',
  },
  {
    type: 'condition',
    labelKey: 'workflow_nodeType_condition',
    descriptionKey: 'workflow_nodeType_condition_desc',
    icon: FiGitBranch,
    shape: 'workflow-condition-node',
    color: 'orange',
    bgClass: 'bg-orange-50 dark:bg-orange-900/20',
    iconClass: 'text-orange-500',
    borderClass: 'border-orange-200 dark:border-orange-700/50',
  },
];

const controlPalette: PaletteItem[] = [
  {
    type: 'start',
    labelKey: 'workflow_nodeType_start',
    descriptionKey: 'workflow_nodeType_start_desc',
    icon: FiPlay,
    shape: 'workflow-start-node',
    color: 'green',
    bgClass: 'bg-green-50 dark:bg-green-900/20',
    iconClass: 'text-green-500',
    borderClass: 'border-green-200 dark:border-green-700/50',
  },
  {
    type: 'end',
    labelKey: 'workflow_nodeType_end',
    descriptionKey: 'workflow_nodeType_end_desc',
    icon: FiXCircle,
    shape: 'workflow-end-node',
    color: 'red',
    bgClass: 'bg-red-50 dark:bg-red-900/20',
    iconClass: 'text-red-500',
    borderClass: 'border-red-200 dark:border-red-700/50',
  },
];

// ============ Default Node Data ============

function getDefaultNodeData(type: WorkflowNodeType): NodeData {
  const data: NodeData = {};
  if (type === 'ai') {
    data.prompt = '请分析当前页面内容并提取关键信息';
  } else if (type === 'automation') {
    data.action = 'wait';
    data.parameters = {};
  } else if (type === 'condition') {
    data.prompt = '';
    data.branches = [
      { id: 'branch-yes', name: '是' },
      { id: 'branch-no', name: '否' },
    ];
    data.evaluateWithAI = true;
  }
  return data;
}

/**
 * Update condition node's output ports based on its branches
 */
function syncConditionPorts(graph: X6Graph, nodeId: string, branches: Array<{ id: string; name: string }>) {
  const cell = graph.getCellById(nodeId);
  if (!cell || !cell.isNode()) return;

  // Remove all existing out ports
  const existingPorts = cell.getPorts().filter(p => p.group !== 'in' && p.id);
  for (const port of existingPorts) {
    cell.removePort(port.id!);
  }

  // Add ports for each branch
  for (const branch of branches) {
    cell.addPort({
      id: branch.id,
      group: 'out',
      attrs: {
        text: { text: branch.name },
      },
    });
  }
}

// Helper function to get i18n label key for node type
const getNodeTypeLabelKey = (type: WorkflowNodeType): MessageKey => {
  switch (type) {
    case 'ai':
      return 'workflow_nodeType_ai';
    case 'automation':
      return 'workflow_nodeType_automation';
    case 'condition':
      return 'workflow_nodeType_condition';
    case 'start':
      return 'workflow_nodeType_start';
    case 'end':
      return 'workflow_nodeType_end';
    default:
      return 'workflow_nodeType_automation';
  }
};

// ============ Main Workflow Editor Component ============

export default function WorkflowEditor({
  workflow: initialWorkflow,
  onSave,
  onCancel,
  isDarkMode = false,
}: WorkflowEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<X6Graph | null>(null);
  const dndRef = useRef<Dnd | null>(null);

  const [workflowId] = useState(initialWorkflow?.id || `workflow-${Date.now()}`);
  const [workflowName, setWorkflowName] = useState(initialWorkflow?.name || t('workflow_newWorkflow_defaultName'));
  const [workflowDescription, setWorkflowDescription] = useState(initialWorkflow?.description || '');
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<X6Edge | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Helper function to get shape name for node type
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

  // Initialize graph
  useEffect(() => {
    if (!containerRef.current) return;

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
          // Sync condition node ports for dynamic branches
          if (node.type === 'condition' && nodeData.branches) {
            syncConditionPorts(graph, node.id, nodeData.branches);
          }
        }

        // Add edges
        for (const edge of workflow.edges) {
          graph.addEdge(
            new Shape.Edge({
              id: edge.id || `edge-${Date.now()}`,
              source: { cell: edge.source, port: edge.sourcePort },
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
        type: 'doubleMesh',
        size: 20,
        args: [
          {
            color: isDarkMode ? '#334155' : '#d1d5db',
            thickness: 1,
          },
          {
            color: isDarkMode ? '#1e293b' : '#e5e7eb',
            thickness: 1,
            factor: 4,
          },
        ],
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

    // Create DnD instance
    const dnd = new Dnd({ target: graph });
    dndRef.current = dnd;

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

      // Clear all nodes' selected state
      graph.getNodes().forEach(n => {
        const d = n.getData() as Record<string, unknown>;
        if (d['selected']) {
          n.setData({ ...d, selected: false }, { overwrite: true });
        }
      });

      // Clear edge selection
      setSelectedEdge(null);

      // Set selected state on clicked node
      node.setData({ ...nodeData, selected: true }, { overwrite: true });

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
      // Clear all nodes' selected state
      graph.getNodes().forEach(n => {
        const d = n.getData() as Record<string, unknown>;
        if (d['selected']) {
          n.setData({ ...d, selected: false }, { overwrite: true });
        }
      });
      setSelectedNode(null);
      setSelectedEdge(edge);
    });

    // Handle blank click to deselect
    graph.on('blank:click', () => {
      // Clear all nodes' selected state
      graph.getNodes().forEach(n => {
        const d = n.getData() as Record<string, unknown>;
        if (d['selected']) {
          n.setData({ ...d, selected: false }, { overwrite: true });
        }
      });
      setSelectedNode(null);
      setSelectedEdge(null);
    });

    // Show ports on node mouseenter
    graph.on('node:mouseenter', ({ node }) => {
      const ports = node.getPorts();
      ports.forEach(port => {
        if (port.id) {
          node.setPortProp(port.id, 'attrs/circle/style/visibility', 'visible');
          node.setPortProp(port.id, 'attrs/circle/r', 8);
        }
      });
    });

    // Hide ports on node mouseleave (except when connecting)
    graph.on('node:mouseleave', ({ node }) => {
      const ports = node.getPorts();
      ports.forEach(port => {
        if (port.id) {
          node.setPortProp(port.id, 'attrs/circle/style/visibility', 'hidden');
          node.setPortProp(port.id, 'attrs/circle/r', 6);
        }
      });
    });

    // Also show ports when starting to connect from a port
    graph.on('node:port:mouseenter', ({ node, port: portId }) => {
      if (portId) {
        node.setPortProp(portId, 'attrs/circle/style/visibility', 'visible');
        node.setPortProp(portId, 'attrs/circle/r', 8);
      }
    });

    // Cleanup
    return () => {
      dndRef.current = null;
      graph.dispose();
    };
  }, [initialWorkflow, isDarkMode, getShapeForNodeType]);

  // Add node from palette (fallback click method, also used after drag)
  const handleAddNode = (type: WorkflowNodeType) => {
    if (!graphRef.current) return;

    const graph = graphRef.current;
    const shape = getShapeForNodeType(type);
    const nodeId = `node-${Date.now()}`;

    // Calculate position based on graph center or viewport
    const area = graph.getGraphArea();
    const position = { x: (area.x + area.width) / 2, y: (area.y + area.height) / 2 };

    const name = t(getNodeTypeLabelKey(type));
    const defaultData = getDefaultNodeData(type);

    graph.addNode({
      shape,
      x: position.x,
      y: position.y,
      id: nodeId,
      data: { ...defaultData, type, name },
    });

    // Sync condition node ports after adding
    if (type === 'condition' && defaultData.branches) {
      syncConditionPorts(graph, nodeId, defaultData.branches);
    }

    // Select the newly added node
    setSelectedNode({
      id: nodeId,
      type,
      name,
      position,
      data: { ...defaultData, type, name },
    });
  };

  // Handle drag start from palette card
  const handleDragStart = useCallback(
    (e: React.MouseEvent, type: WorkflowNodeType) => {
      if (!graphRef.current || !dndRef.current) return;

      const shape = getShapeForNodeType(type);
      const isSmallNode = type === 'start' || type === 'end';
      const width = isSmallNode ? 50 : 180;
      const height = isSmallNode ? 50 : 60;
      const defaultData = getDefaultNodeData(type);
      const label = t(getNodeTypeLabelKey(type));

      const node = graphRef.current.createNode({
        shape,
        width,
        height,
        data: { ...defaultData, type, name: label },
      });

      dndRef.current.start(node, e.nativeEvent);
    },
    [getShapeForNodeType],
  );

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
      rankdir: 'LR',
      align: 'UL',
      nodesep: 60,
      ranksep: 120,
      nodeSize: 180,
    });

    // Execute layout
    const result = await dagreLayout.execute(layoutGraph);

    // Apply new positions to nodes
    result.nodes.forEach(layoutNode => {
      const cell = graph.getCellById(String(layoutNode.id));
      if (cell && cell.isNode()) {
        const size = layoutNode.data?.size || [180, 60];
        const width = typeof size === 'number' ? size : size[0] || 180;
        const height = typeof size === 'number' ? size : size[1] || 60;
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
      const sourcePort = edge.getSourcePortId() || undefined;
      edges.push({
        id: edge.id,
        source: edge.getSourceCellId() || '',
        target: edge.getTargetCellId() || '',
        sourcePort,
      });
    });

    return {
      id: workflowId,
      name: workflowName || t('workflow_untitledWorkflow'),
      description:
        workflowDescription || t('workflow_automatedWorkflowDesc', [workflowName || t('workflow_untitledWorkflow')]),
      version: '1.0.0',
      nodes,
      edges,
      variables: [],
      executionConfig: { onError: 'stop' },
      createdAt: initialWorkflow?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
  }, [workflowId, workflowName, workflowDescription, initialWorkflow]);

  // Create empty workflow
  const createEmptyWorkflow = (): Workflow => ({
    id: workflowId,
    name: workflowName,
    description: workflowDescription,
    version: '1.0.0',
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
      node.setData({ ...updatedNode.data, name: updatedNode.name, type: updatedNode.type }, { overwrite: true });
      // Sync condition node ports when branches change
      if (updatedNode.type === 'condition' && updatedNode.data.branches) {
        syncConditionPorts(graphRef.current, updatedNode.id, updatedNode.data.branches);
      }
    }
    setSelectedNode(updatedNode);
  };

  // Palette card component
  const PaletteCard = ({
    item,
    isDark,
    onDragStart,
    onClick,
  }: {
    item: (typeof nodePalette)[number] | (typeof controlPalette)[number];
    isDark: boolean;
    onDragStart: (e: React.MouseEvent, type: WorkflowNodeType) => void;
    onClick: () => void;
  }) => (
    <div
      onMouseDown={e => onDragStart(e, item.type as WorkflowNodeType)}
      onClick={onClick}
      className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-grab border transition-all duration-150 select-none active:cursor-grabbing active:scale-[0.97] hover:shadow-sm ${item.bgClass} ${item.borderClass}`}
      style={isDark ? { borderColor: item.borderClass.includes('dark:') ? undefined : undefined } : undefined}>
      <div className={`flex items-center justify-center size-7 rounded-md ${item.bgClass} shrink-0`}>
        <item.icon className={`size-3.5 ${item.iconClass}`} />
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className={`text-sm font-medium leading-tight ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
          {t(item.labelKey)}
        </span>
        <span className={`text-xs leading-tight ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {t(item.descriptionKey)}
        </span>
      </div>
      <FiMoreVertical
        className={`size-3.5 opacity-0 group-hover:opacity-60 shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-400'}`}
      />
    </div>
  );

  return (
    <div className={`workflow-editor flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-[100]' : ''}`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-2.5 border-b shadow-sm ${
          isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'
        }`}>
        <div className="flex items-center gap-3 flex-1">
          <input
            type="text"
            value={workflowName}
            onChange={e => setWorkflowName(e.target.value)}
            placeholder={t('workflow_name_placeholder')}
            className={`px-3 py-1.5 rounded-lg border text-sm font-medium w-40 focus:ring-2 focus:ring-blue-400/50 transition-colors ${
              isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
            }`}
          />
          <input
            type="text"
            value={workflowDescription}
            onChange={e => setWorkflowDescription(e.target.value)}
            placeholder={t('workflow_description_placeholder')}
            className={`px-3 py-1.5 rounded-lg border text-sm flex-1 max-w-md focus:ring-2 focus:ring-blue-400/50 transition-colors ${
              isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
            }`}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAutoLayout}
            className={`p-2 rounded-lg transition-colors ${
              isDarkMode ? 'text-gray-300 hover:bg-slate-600' : 'text-gray-600 hover:bg-gray-100'
            }`}
            title={t('workflow_autoLayout')}>
            <FiLayout className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={`p-2 rounded-lg transition-colors ${
              isDarkMode ? 'text-gray-300 hover:bg-slate-600' : 'text-gray-600 hover:bg-gray-100'
            }`}
            title={isFullscreen ? t('workflow_exitFullscreen') : t('workflow_enterFullscreen')}>
            {isFullscreen ? <FiMinimize2 className="size-4" /> : <FiMaximize2 className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isDarkMode
                ? 'bg-slate-700 text-gray-200 hover:bg-slate-600'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}>
            {t('workflow_cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 shadow-sm transition-colors">
            {t('workflow_save')}
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex flex-1 min-h-0">
        {/* Node Palette - Draggable Cards */}
        <div
          className={`w-56 border-r flex flex-col ${
            isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-gray-200 bg-gray-50/80'
          }`}
          style={{ overflow: 'auto' }}>
          {/* Process Nodes Section */}
          <div className="px-3 pt-3 pb-1">
            <h3
              className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {t('workflow_nodePalette')}
            </h3>
            <div className="space-y-1.5">
              {nodePalette.map(item => (
                <PaletteCard
                  key={item.type}
                  item={item}
                  isDark={isDarkMode}
                  onDragStart={handleDragStart}
                  onClick={() => handleAddNode(item.type as WorkflowNodeType)}
                />
              ))}
            </div>
          </div>

          {/* Control Nodes Section */}
          <div className="px-3 pt-3 pb-3 mt-2 border-t border-dashed ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}">
            <h3
              className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              {t('workflow_controlPalette')}
            </h3>
            <div className="space-y-1.5">
              {controlPalette.map(item => (
                <PaletteCard
                  key={item.type}
                  item={item}
                  isDark={isDarkMode}
                  onDragStart={handleDragStart}
                  onClick={() => handleAddNode(item.type as WorkflowNodeType)}
                />
              ))}
            </div>
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
            className={`w-72 border-l overflow-y-auto shadow-lg ${
              isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'
            }`}>
            {/* Panel Header with Close and Delete buttons */}
            <div
              className={`flex items-center justify-between px-4 py-2.5 border-b ${
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
                    className="p-1.5 rounded-md text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                    title={t('workflow_delete')}>
                    <FiTrash2 className="size-4" />
                  </button>
                )}
                {selectedEdge && (
                  <button
                    type="button"
                    onClick={handleDeleteEdge}
                    className="p-1.5 rounded-md text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
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
                  className={`p-1.5 rounded-md transition-colors ${
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
  const handleFieldChange = (field: string, value: string | boolean | Array<{ id: string; name: string }>) => {
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
          className={`mt-1 w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-blue-400/50 transition-colors ${
            isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
          }`}
        />
      </div>

      {/* Node Type Badge */}
      <div>
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
            editedNode.type === 'ai'
              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
              : editedNode.type === 'automation'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
          }`}>
          {editedNode.type === 'ai'
            ? t('workflow_nodeType_ai')
            : editedNode.type === 'automation'
              ? t('workflow_nodeType_automation')
              : t('workflow_nodeType_condition')}
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
              className={`mt-1 w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-blue-400/50 transition-colors ${
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
              className={`mt-1 w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-blue-400/50 transition-colors ${
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
              className={`mt-1 w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-blue-400/50 transition-colors ${
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
              className={`mt-1 w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-blue-400/50 transition-colors ${
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
            <div
              className={`space-y-2 pt-2 border-t border-dashed ${
                isDarkMode ? 'border-slate-600' : 'border-gray-300'
              }`}>
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
                      className={`mt-0.5 w-full px-3 py-1.5 rounded-lg border text-sm focus:ring-2 focus:ring-blue-400/50 transition-colors ${
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
                      className={`mt-0.5 w-full px-3 py-1.5 rounded-lg border text-sm focus:ring-2 focus:ring-blue-400/50 transition-colors ${
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
          {/* AI Prompt for condition evaluation */}
          <div>
            <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {t('workflow_aiPrompt')}
            </label>
            <textarea
              value={editedNode.data.prompt || ''}
              onChange={e => handleFieldChange('prompt', e.target.value)}
              className={`mt-1 w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-blue-400/50 transition-colors ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}
              rows={3}
              placeholder={t('workflow_conditionExpression')}
            />
          </div>

          {/* Branch management */}
          <div>
            <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {t('workflow_branches')}
            </label>
            <div className="mt-1 space-y-1.5">
              {(editedNode.data.branches || []).map((branch, index) => (
                <div key={branch.id} className="flex items-center gap-1.5">
                  <span
                    className={`flex items-center justify-center size-5 rounded text-xs font-semibold ${
                      isDarkMode ? 'bg-orange-900/30 text-orange-400' : 'bg-orange-100 text-orange-700'
                    }`}>
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    value={branch.name}
                    onChange={e => {
                      const newBranches = [...(editedNode.data.branches || [])];
                      newBranches[index] = { ...newBranches[index], name: e.target.value };
                      handleFieldChange('branches', newBranches);
                    }}
                    className={`flex-1 px-2 py-1 rounded-md border text-sm focus:ring-2 focus:ring-blue-400/50 transition-colors ${
                      isDarkMode
                        ? 'border-slate-600 bg-slate-700 text-gray-200'
                        : 'border-gray-300 bg-white text-gray-700'
                    }`}
                    placeholder={t('workflow_branchNamePlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const newBranches = [...(editedNode.data.branches || [])];
                      newBranches.splice(index, 1);
                      handleFieldChange('branches', newBranches);
                    }}
                    className="p-1 rounded-md text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                    title={t('workflow_removeBranch')}>
                    <FiTrash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const newBranches = [...(editedNode.data.branches || [])];
                  newBranches.push({ id: `branch-${Date.now()}`, name: '' });
                  handleFieldChange('branches', newBranches);
                }}
                className={`mt-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isDarkMode
                    ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                + {t('workflow_addBranch')}
              </button>
            </div>
          </div>

          {/* Evaluate with AI toggle */}
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
