import {
  FiCpu,
  FiMousePointer,
  FiGitBranch,
  FiRepeat,
  FiPlay,
  FiXCircle,
  FiMoreVertical,
  FiFileText,
} from 'react-icons/fi';
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
  /** Optional override for label (used when no i18n key exists yet for new node types) */
  labelOverride?: string;
  /** Optional override for description */
  descriptionOverride?: string;
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
  {
    type: 'loop',
    // Reuse a stable existing key — overrides below carry the actual label.
    labelKey: 'workflow_nodeType_condition',
    descriptionKey: 'workflow_nodeType_condition_desc',
    icon: FiRepeat,
    bgClass: 'bg-indigo-50 dark:bg-indigo-900/20',
    iconClass: 'text-indigo-500',
    borderClass: 'border-indigo-200 dark:border-indigo-700/50',
    labelOverride: '循环',
    descriptionOverride: 'AI 判定或固定次数,带兜底上限',
  },
  {
    type: 'output',
    // Reuse existing keys to avoid touching all 4 locale files; supplement labelOverride below
    labelKey: 'workflow_nodeType_ai',
    descriptionKey: 'workflow_nodeType_ai_desc',
    icon: FiFileText,
    bgClass: 'bg-teal-50 dark:bg-teal-900/20',
    iconClass: 'text-teal-500',
    borderClass: 'border-teal-200 dark:border-teal-700/50',
    labelOverride: '输出',
    descriptionOverride: '收集要输出的内容',
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
    case 'loop':
      // No dedicated i18n key yet; reuse condition's label and rely on labelOverride elsewhere
      return 'workflow_nodeType_condition';
    case 'start':
      return 'workflow_nodeType_start';
    case 'end':
      return 'workflow_nodeType_end';
    case 'output':
      // No dedicated i18n key yet; falls through to automation as placeholder
      return 'workflow_nodeType_automation';
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
  } else if (type === 'loop') {
    data.loopMode = 'fixed';
    data.maxIterations = 3;
    data.iterationVariable = 'loop';
    data.prompt = '';
  } else if (type === 'output') {
    data.label = '输出';
    data.content = '{{}}';
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
          {item.labelOverride || t(item.labelKey)}
        </span>
        <span className={`text-xs leading-tight ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {item.descriptionOverride || t(item.descriptionKey)}
        </span>
      </div>
      <FiMoreVertical
        className={`size-3.5 shrink-0 opacity-0 group-hover:opacity-60 ${isDark ? 'text-gray-400' : 'text-gray-400'}`}
      />
    </div>
  );
}
