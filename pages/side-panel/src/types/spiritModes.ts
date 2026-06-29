/**
 * 球球（皮蛋）的执行风格模式 —— 不是装饰，而是真改变 Agent 行为的预设。
 *
 * 设计原则：
 * 1. 每个模式必须对应一段可观察的行为变化（promptWrapper 包装任务）；
 * 2. 仅装饰的模式（仅改表情）不要在这里加；
 * 3. 任何新模式都要在 visibleModes 中显式列出才会出现在选项中。
 */

import { farmerSitesStore } from '@extension/storage';

export type SpiritMode = 'auto' | 'farmer' | 'explore';

export interface SpiritModeConfig {
  id: SpiritMode;
  label: string;
  icon: string;
  /** 切换到此模式时显示给用户的一句话说明 */
  description: string;
  /**
   * 用户消息包装器 —— 把用户原始任务包装成带模式策略的 prompt。
   * 返回 undefined 表示不做包装（默认模式）。
   * async：可能需要异步读取 storage（如 farmer 模式读取网站清单）。
   */
  promptWrapper?: (userTask: string) => Promise<string>;
  /** 任务消息列表里给用户看到的前缀（区分模式） */
  displayPrefix?: string;
}

const SPIRIT_MODE_CONFIGS: Record<SpiritMode, SpiritModeConfig> = {
  auto: {
    id: 'auto',
    label: '自动',
    icon: '◈',
    description: '皮蛋按标准方式执行任务',
  },
  farmer: {
    id: 'farmer',
    label: '农场主',
    icon: '🌾',
    description: '皮蛋去各个 AI 网站采集答案再汇总',
    displayPrefix: '🌾 [农场主模式]',
    promptWrapper: async (userTask: string) => {
      const sites = await farmerSitesStore.getSites();
      const enabledSites = sites.filter(s => s.enabled);

      // 没有可用网站时退化为普通任务并给出提示
      if (enabledSites.length === 0) {
        return `[农场主模式] 当前没有可用的 AI 网站清单（请到设置 → 农场主中添加）。请按普通方式处理：\n\n${userTask}`;
      }

      const sitesList = enabledSites
        .map((s, i) => {
          const hint = s.hints?.trim();
          const hintBlock = hint ? `\n   操作提示：${hint}` : '';
          return `${i + 1}. **${s.name}** (${s.url}) - ${s.desc}${hintBlock}`;
        })
        .join('\n');

      return `[农场主模式] 请按以下策略处理用户的任务：

## AI 网站访问顺序与操作提示
${sitesList}

## 执行策略
- 依次打开可访问的 AI 网站，在输入框中输入用户问题
- **优先参考每个网站下的"操作提示"**（如有 XPath / selector 等），按提示定位输入框和发送按钮，能显著提高准确度；若提示为空或失效，再用现有页面状态自主定位
- 发送完成后，检查是否发送成功（确认输入框已清空或有回复出现）
- 如果提交失败，可尝试其他提交方式
- 等待 AI 回复，记录关键信息
- 继续访问下一个 AI 网站获取不同视角
- 最后汇总各个 AI 的回答，形成综合对比报告
- 如果某个网站需要登录、出现验证码或无法访问，跳过继续下一个

---

## 用户任务
${userTask}`;
    },
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
- 这是一个调研/对比类任务，不要急于给出单一答案
- 主动打开 2-4 个相关来源（搜索引擎结果、对比网站、官方信息等），收集多方信息
- 关注差异点：价格、规格、口碑、时间、版本等
- 用结构化方式（表格、要点对比、优劣分析）整理最终答案
- 如有不确定信息，标注「需进一步确认」而不是猜测

---

## 用户任务
${userTask}`,
  },
};

/** 当前对用户可见的模式（删除后只需从这里去掉对应项） */
export const visibleSpiritModes: SpiritMode[] = ['auto', 'farmer', 'explore'];

export function getSpiritModeConfig(mode: SpiritMode): SpiritModeConfig {
  return SPIRIT_MODE_CONFIGS[mode];
}

export function listVisibleSpiritModes(): SpiritModeConfig[] {
  return visibleSpiritModes.map(m => SPIRIT_MODE_CONFIGS[m]);
}

/**
 * 把用户原始输入按模式包装。
 * 返回 { task: 给 LLM 的完整 prompt, displayText: 给用户看的简短文案 }。
 */
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
