import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Template data
const defaultFavoritePrompts = [
  {
    title: '人人租品牌形象调研',
    content:
      '- 打开 DeepSeek (https://chat.deepseek.com)，在对话框输入问题【人人租品牌形象调研】获取回答\n- 记录关键信息后，形成综合对比报告\n- 注意：如果某个网站需要登录，提示用户登录后继续',
  },
  {
    title: '🔥 今日 AI 热点',
    content:
      '- 打开 https://www.aibase.cn/，查看今天的前 3 条 AI 新闻。\n- 对每条新闻：\n  - 记录标题、链接和热度\n  - 用一句话总结核心内容\n- 最后汇总成一份今日 AI 热点简报，按热度排序',
  },
  {
    title: '📖 帮我读懂这个网页',
    content:
      '请帮我阅读当前页面，提取以下信息：\n- 页面的核心主题是什么？\n- 列出 3-5 个关键要点\n- 如果有数据或结论，请整理出来\n- 用通俗易懂的语言做个总结',
  },
  {
    title: '🛒 比价助手',
    content:
      '- 帮我在淘宝、京东、拼多多上搜索当前商品\n- 分别记录各平台的价格、优惠活动、销量和评价数\n- 整理成一个对比表格，标注最划算的选择\n- 注意区分官方旗舰店和第三方店铺',
  },
];

/**
 * 一条书签。
 *
 * 两种形态，靠 `workflowId` 区分：
 *  - 提示词书签（`workflowId` 未设置）：点击把 `content` 填进输入框，用户再自己发送
 *  - 工作流书签（`workflowId` 已设置）：点击直接执行那个工作流，`content` 只作为
 *    列表里的说明文字
 *
 * 复用同一个 store 而不是另开一个：书签列表的排序、重命名、删除、拖拽这些行为对两者
 * 完全一致，分成两个 store 就要把这些逻辑和 UI 都写两遍，而它们唯一的差别只是点击后
 * 干什么。
 */
export interface FavoritePrompt {
  id: number;
  title: string;
  content: string;
  /** 设置时表示这是一条工作流书签，点击即执行该 id 的工作流。 */
  workflowId?: string;
}

// Define the favorites storage type
export interface FavoritesStorage {
  nextId: number;
  prompts: FavoritePrompt[];
}

// Define the interface for favorite prompts storage operations
export interface FavoritePromptsStorage {
  addPrompt: (title: string, content: string) => Promise<FavoritePrompt>;
  updatePrompt: (id: number, title: string, content: string) => Promise<FavoritePrompt | undefined>;
  updatePromptTitle: (id: number, title: string) => Promise<FavoritePrompt | undefined>;
  removePrompt: (id: number) => Promise<void>;
  getAllPrompts: () => Promise<FavoritePrompt[]>;
  getPromptById: (id: number) => Promise<FavoritePrompt | undefined>;
  reorderPrompts: (draggedId: number, targetId: number) => Promise<void>;
  /**
   * 把工作流加入书签。按 `workflowId` 去重 —— 同一个工作流只应有一条书签，
   * 重复调用返回已有那条。
   */
  addWorkflowBookmark: (workflowId: string, title: string, description?: string) => Promise<FavoritePrompt>;
  /** 按 workflowId 取消书签。工作流被删除时也该调它清理悬空书签。 */
  removeWorkflowBookmark: (workflowId: string) => Promise<void>;
  /** 查某个工作流是否已加书签，用于按钮的选中态。 */
  getWorkflowBookmark: (workflowId: string) => Promise<FavoritePrompt | undefined>;
}

// Initial state with proper typing
const initialState: FavoritesStorage = {
  nextId: 1,
  prompts: [],
};

// Create the favorites storage
const favoritesStorage: BaseStorage<FavoritesStorage> = createStorage('favorites', initialState, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

/**
 * Creates a storage interface for managing favorite prompts
 */
export function createFavoritesStorage(): FavoritePromptsStorage {
  return {
    addPrompt: async (title: string, content: string): Promise<FavoritePrompt> => {
      // Check if prompt with same content already exists
      const { prompts } = await favoritesStorage.get();
      const existingPrompt = prompts.find(prompt => prompt.content === content);

      // If exists, return the existing prompt
      if (existingPrompt) {
        return existingPrompt;
      }

      // Otherwise add new prompt
      await favoritesStorage.set(prev => {
        const id = prev.nextId;
        const newPrompt: FavoritePrompt = { id, title, content };

        return {
          nextId: id + 1,
          prompts: [newPrompt, ...prev.prompts],
        };
      });

      return (await favoritesStorage.get()).prompts[0];
    },

    updatePrompt: async (id: number, title: string, content: string): Promise<FavoritePrompt | undefined> => {
      let updatedPrompt: FavoritePrompt | undefined;

      await favoritesStorage.set(prev => {
        const updatedPrompts = prev.prompts.map(prompt => {
          if (prompt.id === id) {
            updatedPrompt = { ...prompt, title, content };
            return updatedPrompt;
          }
          return prompt;
        });

        // If prompt wasn't found, leave the storage unchanged
        if (!updatedPrompt) {
          return prev;
        }

        return {
          ...prev,
          prompts: updatedPrompts,
        };
      });

      return updatedPrompt;
    },

    updatePromptTitle: async (id: number, title: string): Promise<FavoritePrompt | undefined> => {
      let updatedPrompt: FavoritePrompt | undefined;

      await favoritesStorage.set(prev => {
        const updatedPrompts = prev.prompts.map(prompt => {
          if (prompt.id === id) {
            updatedPrompt = { ...prompt, title };
            return updatedPrompt;
          }
          return prompt;
        });

        // If prompt wasn't found, leave the storage unchanged
        if (!updatedPrompt) {
          return prev;
        }

        return {
          ...prev,
          prompts: updatedPrompts,
        };
      });

      return updatedPrompt;
    },

    removePrompt: async (id: number): Promise<void> => {
      await favoritesStorage.set(prev => ({
        ...prev,
        prompts: prev.prompts.filter(prompt => prompt.id !== id),
      }));
    },

    getAllPrompts: async (): Promise<FavoritePrompt[]> => {
      const currentState = await favoritesStorage.get();
      let prompts = currentState.prompts;

      // Check if storage is in initial state (empty prompts array and nextId=1)
      if (currentState.prompts.length === 0 && currentState.nextId === 1) {
        // Initialize with default prompts
        for (const prompt of defaultFavoritePrompts) {
          await favoritesStorage.set(prev => {
            const id = prev.nextId;
            const newPrompt: FavoritePrompt = { id, title: prompt.title, content: prompt.content };
            return { nextId: id + 1, prompts: [newPrompt, ...prev.prompts] };
          });
        }
        const newState = await favoritesStorage.get();
        prompts = newState.prompts;
      }
      return [...prompts].sort((a, b) => b.id - a.id);
    },

    getPromptById: async (id: number): Promise<FavoritePrompt | undefined> => {
      const { prompts } = await favoritesStorage.get();
      return prompts.find(prompt => prompt.id === id);
    },

    reorderPrompts: async (draggedId: number, targetId: number): Promise<void> => {
      await favoritesStorage.set(prev => {
        // Create a copy of the current prompts
        const promptsCopy = [...prev.prompts];

        // Find indexes
        const sourceIndex = promptsCopy.findIndex(prompt => prompt.id === draggedId);
        const targetIndex = promptsCopy.findIndex(prompt => prompt.id === targetId);

        // Ensure both indexes are valid
        if (sourceIndex === -1 || targetIndex === -1) {
          return prev; // No changes if either index is invalid
        }

        // Reorder by removing dragged item and inserting at target position
        const [movedItem] = promptsCopy.splice(sourceIndex, 1);
        promptsCopy.splice(targetIndex, 0, movedItem);

        // Assign new IDs based on the order
        const numPrompts = promptsCopy.length;
        const updatedPromptsWithNewIds = promptsCopy.map((prompt, index) => ({
          ...prompt,
          id: numPrompts - index, // Assigns IDs: numPrompts, numPrompts-1, ..., 1
        }));

        return {
          ...prev,
          prompts: updatedPromptsWithNewIds,
          nextId: numPrompts + 1, // Update nextId accordingly
        };
      });
    },

    addWorkflowBookmark: async (workflowId: string, title: string, description = ''): Promise<FavoritePrompt> => {
      // 按 workflowId 去重，不用 content：工作流书签的 content 只是说明文字，
      // 两个不同工作流完全可以有相同的说明，而同一个工作流有两条书签是没有意义的
      const { prompts } = await favoritesStorage.get();
      const existing = prompts.find(p => p.workflowId === workflowId);
      if (existing) {
        return existing;
      }

      await favoritesStorage.set(prev => {
        const id = prev.nextId;
        const newPrompt: FavoritePrompt = { id, title, content: description, workflowId };
        return {
          nextId: id + 1,
          prompts: [newPrompt, ...prev.prompts],
        };
      });

      const after = await favoritesStorage.get();
      // 按 workflowId 找回来而不是取 prompts[0]：reorderPrompts 会重排数组，
      // 「新加的一定在头部」这个假设只在没被重排过时成立
      return after.prompts.find(p => p.workflowId === workflowId)!;
    },

    removeWorkflowBookmark: async (workflowId: string): Promise<void> => {
      await favoritesStorage.set(prev => ({
        ...prev,
        prompts: prev.prompts.filter(p => p.workflowId !== workflowId),
      }));
    },

    getWorkflowBookmark: async (workflowId: string): Promise<FavoritePrompt | undefined> => {
      const { prompts } = await favoritesStorage.get();
      return prompts.find(p => p.workflowId === workflowId);
    },
  };
}

// Export an instance of the storage by default
export default createFavoritesStorage();
