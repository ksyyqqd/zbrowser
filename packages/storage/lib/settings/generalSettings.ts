import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for general settings configuration
export interface GeneralSettingsConfig {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  planningInterval: number;
  displayHighlights: boolean;
  minWaitPageLoad: number;
  replayHistoricalTasks: boolean;
  showRequestLogs: boolean;
  /** AI接管时是否显示遮罩（默认开启） */
  showSpotlight: boolean;
  /** 工作流执行时是否显示遮罩（默认关闭） */
  showWorkflowSpotlight: boolean;
  /**
   * 视口扩展范围（像素）
   * - 0: 只显示当前可视窗口内的元素
   * - -1: 显示整页所有元素
   * - >0: 扩展视口边界（如100表示上下左右各扩展100px）
   */
  viewportExpansion: number;
  /**
   * 用户是否已经看过新功能引导浮层（@/教导模式/元素记忆）。
   * 缺省/undefined 视为没看过，首次启动会弹引导；看完置 true。
   * 想重看：去 chrome.storage.local 把这个字段删掉重开侧边栏。
   */
  onboardingSeen?: boolean;
  /** 是否开启自主模式 */
  autonomousMode: boolean;
}

export type GeneralSettingsStorage = BaseStorage<GeneralSettingsConfig> & {
  updateSettings: (settings: Partial<GeneralSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<GeneralSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

// Default settings
export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsConfig = {
  maxSteps: 100,
  maxActionsPerStep: 5,
  maxFailures: 3,
  useVision: false,
  useVisionForPlanner: false,
  planningInterval: 3,
  displayHighlights: true,
  minWaitPageLoad: 250,
  replayHistoricalTasks: true,
  showRequestLogs: false,
  showSpotlight: true,
  showWorkflowSpotlight: false,
  viewportExpansion: 0,
  autonomousMode: false,
};

const storage = createStorage<GeneralSettingsConfig>('general-settings', DEFAULT_GENERAL_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const generalSettingsStore: GeneralSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<GeneralSettingsConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_GENERAL_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    // If useVision is true, displayHighlights must also be true
    if (updatedSettings.useVision && !updatedSettings.displayHighlights) {
      updatedSettings.displayHighlights = true;
    }

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      ...settings,
    };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_GENERAL_SETTINGS);
  },
};
