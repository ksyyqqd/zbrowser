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
  /** AI鎺ョ鏃舵槸鍚︽樉绀洪伄缃╋紙榛樿寮€鍚級 */
  showSpotlight: boolean;
  /** 宸ヤ綔娴佹墽琛屾椂鏄惁鏄剧ず閬僵锛堥粯璁ゅ叧闂級 */
  showWorkflowSpotlight: boolean;
  /**
   * 瑙嗗彛鎵╁睍鑼冨洿锛堝儚绱狅級
   * - 0: 鍙樉绀哄綋鍓嶅彲瑙嗙獥鍙ｅ唴鐨勫厓绱?   * - -1: 鏄剧ず鏁撮〉鎵€鏈夊厓绱?   * - >0: 鎵╁睍瑙嗗彛杈圭晫锛堝100琛ㄧず涓婁笅宸﹀彸鍚勬墿灞?00px锛?   */
  viewportExpansion: number;
  /** 鏄惁鏄剧ず鍥剧墖鐢熸垚鍔熻兘鎸夐挳锛堥粯璁ゅ叧闂級 */
  showImageGeneration: boolean;
  /**
   * 鐢ㄦ埛鏄惁宸茬粡鐪嬭繃鏂板姛鑳藉紩瀵兼诞灞傦紙@/鏁欏妯″紡/鍏冪礌璁板繂锛夈€?
   * 缂虹渷/undefined 瑙嗕负鏈湅杩囷紝棣栨鍚姩浼氬脊寮曞锛涚湅瀹岀疆 true銆?
   * 鎯抽噸鐪嬶細鍘?chrome.storage.local 鎶婅繖涓瓧娈靛垹鎺夐噸寮€渚ц竟鏍忋€?
   */
  onboardingSeen?: boolean;
  /** 鏄惁寮€鍚繛缁姩浣滄墽琛岋紙瀹為獙鎬у姛鑳斤級 */
  multiActionEnabled: boolean;
  /** 杩炵画鍔ㄤ綔鏈€澶ф暟閲?*/
  maxMultiActions: number;
  /** 鏄惁寮€鍚嚜涓绘ā寮?*/
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
  showImageGeneration: false,
  multiActionEnabled: false,
  maxMultiActions: 3,
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
