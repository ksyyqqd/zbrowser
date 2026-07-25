/**
 * Executing styles for the spirit doll.
 * Keep the visible modes explicit and minimal.
 */

export type SpiritMode = 'auto' | 'explore';

export interface SpiritModeConfig {
  id: SpiritMode;
  label: string;
  icon: string;
  description: string;
  promptWrapper?: (userTask: string) => Promise<string>;
  displayPrefix?: string;
}

const SPIRIT_MODE_CONFIGS: Record<SpiritMode, SpiritModeConfig> = {
  auto: {
    id: 'auto',
    label: '自动',
    icon: '●',
    description: '皮蛋按标准方式执行任务',
  },
  explore: {
    id: 'explore',
    label: '探索',
    icon: '🔍',
    description: '皮蛋多源调研后给出对比报告',
    displayPrefix: '🔍 [探索模式]',
    promptWrapper: async (userTask: string) =>
      `[探索模式] 请按以下策略处理用户的任务：

## 执行策略
- 这是一个调研、对比类任务，不要急于给出单一答案
- 主动打开 2-4 个相关来源（搜索引擎结果、对比网站、官方信息等），收集多方信息
- 关注差异点：价格、规格、口碑、时间、版本等
- 用结构化方式（表格、要点对比、优劣分析）整理最终答案
- 如有不确定信息，标注「需进一步确认」而不是猜测

## 用户任务
${userTask}`,
  },
};

export const visibleSpiritModes: SpiritMode[] = ['auto', 'explore'];

export function getSpiritModeConfig(mode: SpiritMode): SpiritModeConfig {
  return SPIRIT_MODE_CONFIGS[mode];
}

export function listVisibleSpiritModes(): SpiritModeConfig[] {
  return visibleSpiritModes.map(mode => SPIRIT_MODE_CONFIGS[mode]);
}

export async function wrapTaskByMode(
  mode: SpiritMode,
  rawTask: string,
): Promise<{ task: string; displayText: string }> {
  const cfg = SPIRIT_MODE_CONFIGS[mode];
  if (!cfg.promptWrapper) {
    return { task: rawTask, displayText: rawTask };
  }
  const wrapped = await cfg.promptWrapper(rawTask);
  return {
    task: wrapped,
    displayText: cfg.displayPrefix ? `${cfg.displayPrefix} ${rawTask}` : rawTask,
  };
}
