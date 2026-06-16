import { FiCpu, FiMousePointer, FiGitBranch, FiPlay, FiXCircle, FiMoreVertical } from 'react-icons/fi';
import { t } from '@extension/i18n';
import type { MessageKey } from '@extension/i18n';
import type { WorkflowNodeType, NodeData } from '@extension/workflow';

// ============ Types ============

export interface PaletteItem {
  type: WorkflowNodeType;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
  bgClass: string;
  iconClass: string;
  borderClass: string;
}

// ============ Palette Data ============

export const nodePalette: PaletteItem[] = [
  {
    type: 'ai',
    labelKey: 'workflow_nodeType_ai',
    descriptionKey: 'workflow_nodeType_ai_desc',
    icon: FiCpu,
    bgClass: 'bg-purple-50 dark:bg-purple-900/20',
    iconClass: 'text-purple-500',
    borderClass: 'border-purple-200 dark:border-purple-700/50',
  },
  {
    type: 'automation',
    labelKey: 'workflow_nodeType_automation',
    descriptionKey: 'workflow_nodeType_automation_desc',
    icon: FiMousePointer,
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    iconClass: 'text-blue-500',
    borderClass: 'border-blue-200 dark:border-blue-700/50',
  },
  {
    type: 'condition',
    labelKey: 'workflow_nodeType_condition',
    descriptionKey: 'workflow_nodeType_condition_desc',
    icon: FiGitBranch,
    bgClass: 'bg-orange-50 dark:bg-orange-900/20',
    iconClass: 'text-orange-500',
    borderClass: 'border-orange-200 dark:border-orange-700/50',
  },
];

export const controlPalette: PaletteItem[] = [
  {
    type: 'start',
    labelKey: 'workflow_nodeType_start',
    descriptionKey: 'workflow_nodeType_start_desc',
    icon: FiPlay,
    bgClass: 'bg-green-50 dark:bg-green-900/20',
    iconClass: 'text-green-500',
    borderClass: 'border-green-200 dark:border-green-700/50',
  },
  {
    type: 'end',
    labelKey: 'workflow_nodeType_end',
    descriptionKey: 'workflow_nodeType_end_desc',
    icon: FiXCircle,
    bgClass: 'bg-red-50 dark:bg-red-900/20',
    iconClass: 'text-red-500',
    borderClass: 'border-red-200 dark:border-red-700/50',
  },
];

// ============ Helpers ============

export const getNodeTypeLabelKey = (type: WorkflowNodeType): MessageKey => {
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

export function getDefaultNodeData(type: WorkflowNodeType): NodeData {
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

// ============ Palette Card Component ============

export function PaletteCard({ item, isDark }: { item: PaletteItem; isDark: boolean }) {
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/reactflow', item.type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`group flex cursor-grab select-none items-center gap-2 rounded-lg border px-2.5 py-2 transition-all duration-150 hover:shadow-sm active:scale-[0.97] active:cursor-grabbing ${item.bgClass} ${item.borderClass}`}>
      <div className={`flex size-7 items-center justify-center rounded-md ${item.bgClass} shrink-0`}>
        <item.icon className={`size-3.5 ${item.iconClass}`} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`text-sm font-medium leading-tight ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
          {t(item.labelKey)}
        </span>
        <span className={`text-xs leading-tight ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {t(item.descriptionKey)}
        </span>
      </div>
      <FiMoreVertical
        className={`size-3.5 shrink-0 opacity-0 group-hover:opacity-60 ${isDark ? 'text-gray-400' : 'text-gray-400'}`}
      />
    </div>
  );
}
