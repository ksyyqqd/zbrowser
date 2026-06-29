import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

/**
 * 农场主模式的 AI 网站配置。
 * id 用 stable 的 UUID/随机字符串，便于增删改后保持引用一致。
 */
export interface FarmerSite {
  id: string;
  name: string;
  url: string;
  desc: string;
  /** 自由描述的操作提示（XPath / selector / 备注），用于在 prompt 中告知 Agent 优先参考 */
  hints: string;
  /** 是否启用：false 时不参与农场主轮询 */
  enabled: boolean;
}

export interface FarmerSitesConfig {
  /** 按顺序排列，前面的网站优先被 Agent 访问 */
  sites: FarmerSite[];
}

export type FarmerSitesStorage = BaseStorage<FarmerSitesConfig> & {
  getSites: () => Promise<FarmerSite[]>;
  addSite: (site: Omit<FarmerSite, 'id'>) => Promise<FarmerSite>;
  updateSite: (id: string, patch: Partial<Omit<FarmerSite, 'id'>>) => Promise<void>;
  deleteSite: (id: string) => Promise<void>;
  reorderSites: (orderedIds: string[]) => Promise<void>;
  resetToDefaults: () => Promise<void>;
};

const generateId = (): string =>
  // 不依赖 crypto.randomUUID（部分老环境不支持），用足够随机的组合即可
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** 默认 7 个网站，跟之前硬编码保持一致 */
export const DEFAULT_FARMER_SITES: FarmerSite[] = [
  {
    id: 'site-deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    desc: '深度推理能力强，适合复杂分析',
    hints: '',
    enabled: true,
  },
  {
    id: 'site-qwen',
    name: '通义千问',
    url: 'https://www.qianwen.com',
    desc: '阿里云 AI，中文理解优秀',
    hints: '',
    enabled: true,
  },
  {
    id: 'site-chatgpt',
    name: 'ChatGPT',
    url: 'https://chat.openai.com',
    desc: 'OpenAI 通用对话模型',
    hints: '',
    enabled: true,
  },
  {
    id: 'site-claude',
    name: 'Claude',
    url: 'https://claude.ai',
    desc: 'Anthropic 长文本与推理',
    hints: '',
    enabled: true,
  },
  {
    id: 'site-kimi',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn',
    desc: '月之暗面，长上下文中文助手',
    hints: '',
    enabled: true,
  },
  {
    id: 'site-doubao',
    name: '豆包',
    url: 'https://www.doubao.com',
    desc: '字节跳动通用 AI 助手',
    hints: '',
    enabled: true,
  },
  {
    id: 'site-gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com',
    desc: 'Google 多模态模型',
    hints: '',
    enabled: true,
  },
];

export const DEFAULT_FARMER_SITES_CONFIG: FarmerSitesConfig = {
  sites: DEFAULT_FARMER_SITES,
};

const storage = createStorage<FarmerSitesConfig>('farmer-sites', DEFAULT_FARMER_SITES_CONFIG, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const farmerSitesStore: FarmerSitesStorage = {
  ...storage,

  async getSites() {
    const cfg = (await storage.get()) || DEFAULT_FARMER_SITES_CONFIG;
    return cfg.sites;
  },

  async addSite(site) {
    const cfg = (await storage.get()) || DEFAULT_FARMER_SITES_CONFIG;
    const newSite: FarmerSite = { ...site, id: generateId() };
    await storage.set({ ...cfg, sites: [...cfg.sites, newSite] });
    return newSite;
  },

  async updateSite(id, patch) {
    const cfg = (await storage.get()) || DEFAULT_FARMER_SITES_CONFIG;
    const sites = cfg.sites.map(s => (s.id === id ? { ...s, ...patch } : s));
    await storage.set({ ...cfg, sites });
  },

  async deleteSite(id) {
    const cfg = (await storage.get()) || DEFAULT_FARMER_SITES_CONFIG;
    await storage.set({ ...cfg, sites: cfg.sites.filter(s => s.id !== id) });
  },

  async reorderSites(orderedIds) {
    const cfg = (await storage.get()) || DEFAULT_FARMER_SITES_CONFIG;
    const idIdx = new Map(orderedIds.map((id, i) => [id, i]));
    const sorted = [...cfg.sites].sort((a, b) => {
      const ai = idIdx.has(a.id) ? idIdx.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bi = idIdx.has(b.id) ? idIdx.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
    await storage.set({ ...cfg, sites: sorted });
  },

  async resetToDefaults() {
    await storage.set(DEFAULT_FARMER_SITES_CONFIG);
  },
};
