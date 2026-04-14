# Nanobrowser 项目结构说明文档

## 概述

Nanobrowser 是一个开源的 AI Web 自动化 Chrome 扩展，采用 Monorepo 架构（pnpm + Turbo），支持多 LLM 提供商（OpenAI、Anthropic、Gemini、Ollama 等）。项目核心是一个多 Agent 系统，包含 Planner（规划）和 Navigator（执行）两个协作 Agent。

---

## 目录结构总览

```
nanobrowser/
├── chrome-extension/          # 核心 Chrome 扩展代码（Service Worker）
├── pages/                     # UI 页面（side-panel、options、content）
├── packages/                  # 共享包库（monorepo 子包）
├── dist/                      # 构建输出目录
├── dist-zip/                  # 打包输出目录（用于发布）
├── .github/                   # GitHub Actions CI/CD
├── .husky/                    # Git hooks
├── .claude/                   # Claude Code 配置
└── 配置文件                    # package.json、turbo.json、tsconfig 等
```

---

## 一、根目录配置文件

| 文件 | 作用 |
|------|------|
| `package.json` | 主项目配置，定义依赖和脚本命令 |
| `pnpm-workspace.yaml` | pnpm workspace 配置，定义工作区范围 |
| `turbo.json` | Turbo 构建编排配置，管理任务依赖和缓存 |
| `.nvmrc` | Node.js 版本要求（>=22.12.0） |
| `.npmrc` | npm/pnpm 配置，启用 engine-strict |
| `.eslintrc` | ESLint 代码规范配置 |
| `.prettierrc` | Prettier 格式化配置 |
| `vite-env.d.ts` | Vite 环境类型声明 |
| `CLAUDE.md` | Claude AI 开发指南 |
| `AGENTS.md` | Agent 系统说明文档 |
| `README.md` | 项目说明文档 |
| `LICENSE` | Apache-2.0 许可证 |

---

## 二、chrome-extension/ - 核心 Chrome 扩展

核心扩展代码，包含 Service Worker 后台脚本、Agent 系统、浏览器控制和各种服务。

### 目录结构

```
chrome-extension/
├── manifest.js              # Chrome Extension Manifest V3 配置
├── package.json             # 扩展包配置
├── tsconfig.json            # TypeScript 配置
├── vite.config.mts          # Vite 构建配置
│
├── public/                  # 公共资源
│   ├── bg.jpg               # 背景图片
│   ├── buildDomTree.js      # DOM 树构建脚本（注入页面）
│   └── permission/          # 权限请求页面
│       ├── index.html
│       └── permission.js
│
├── utils/                   # 构建工具
│   ├── refresh.js           # HMR 热更新脚本
│   └── plugins/
│       └── make-manifest-plugin.ts  # Manifest 动态生成插件
│
└── src/background/          # Service Worker 源代码
    ├── index.ts             # 主入口，消息处理和任务调度
    ├── log.ts               # 日志工具
    ├── utils.ts             # 工具函数
    │
    ├── agent/               # ⭐ AI Agent 系统
    │   ├── executor.ts      # 任务执行器
    │   ├── history.ts       # 历史记录管理
    │   ├── types.ts         # 类型定义
    │   ├── helper.ts        # 辅助函数（模型判断等）
    │   │
    │   ├── agents/          # Agent 实现
    │   │   ├── base.ts      # Agent 基类
    │   │   ├── navigator.ts # Navigator Agent（执行浏览器操作）
    │   │   ├── planner.ts   # Planner Agent（规划任务步骤）
    │   │   └── errors.ts    # 错误类型定义
    │   │
    │   ├── prompts/         # Agent 提示词
    │   │   ├── base.ts      # 提示词基类
    │   │   ├── navigator.ts # Navigator 提示词
    │   │   ├── planner.ts   # Planner 提示词
    │   │   └── templates/   # 提示词模板
    │   │       ├── common.ts
    │   │       ├── navigator.ts
    │   │       └── planner.ts
    │   │
    │   ├── actions/         # Agent 动作系统
    │   │   ├── schemas.ts   # 动作 JSON Schema 定义
    │   │   ├── builder.ts   # 动作构建器和注册表
    │   │   ├── mcpSchemas.ts # MCP 工具 Schema
    │   │   └── skillSchemas.ts # Skills Schema
    │   │
    │   ├── messages/        # 消息管理
    │   │   ├── service.ts   # 消息服务
    │   │   ├── utils.ts     # 消息工具
    │   │   └── views.ts     # 消息视图类型
    │   │
    │   └── event/           # 事件系统
    │   │   ├── manager.ts   # 事件管理器
    │   │   └── types.ts     # 事件类型定义
    │   │
    ├── browser/             # ⭐ 浏览器控制
    │   ├── context.ts       # BrowserContext（标签页管理、状态获取）
    │   ├── page.ts          # Page（页面操作、截图、DOM 处理）
    │   ├── views.ts         # 类型定义（BrowserState、配置）
    │   ├── util.ts          # URL 验证等工具
    │   │
    │   └── dom/             # DOM 操作
    │   │   ├── service.ts   # DOM 服务（元素检测、高亮）
    │   │   ├── raw_types.ts # DOM 原始类型
    │   │   ├── views.ts     # DOM 视图类型
    │   │   ├── clickable/   # 可点击元素检测
    │   │   │   └── service.ts
    │   │   └── history/     # DOM 历史（元素哈希）
    │   │       ├── service.ts
    │   │       └── view.ts
    │   │
    ├── services/            # ⭐ 服务层
    │   ├── analytics.ts     # PostHog 数据分析
    │   ├── speechToText.ts  # 语音转文字服务
    │   │
    │   ├── mcp/             # MCP (Model Context Protocol)
    │   │   ├── index.ts
    │   │   └── MCPService.ts # MCP 服务集成
    │   │
    │   ├── skills/          # Skills 任务模板
    │   │   ├── index.ts
    │   │   └ SkillsService.ts
    │   │
    │   └── guardrails/      # 安全防护
    │   │   ├── index.ts     # 入口
    │   │   ├── patterns.ts  # 安全模式检测
    │   │   ├── sanitizer.ts # 输入清理
    │   │   ├── types.ts     # 类型定义
    │   │   └── __tests__/   # 单元测试
    │   │
    ├── task/                 # 任务管理
    │   └── manager.ts       # 任务生命周期管理
    │
    └── workflow/             # 工作流（预留）
```

### 核心文件详解

#### `manifest.js`
- Chrome Extension Manifest V3 动态配置
- 根据 `VITE_BROWSER_TARGET` 生成不同浏览器配置
- 定义权限：debugger、storage、sidePanel、tabs 等

#### `src/background/index.ts`
- Service Worker 主入口
- 处理扩展安装、消息路由、任务调度
- 初始化 BrowserContext、LLM Provider

#### `src/background/agent/executor.ts`
- 任务执行器
- 协调 Planner 和 Navigator Agent
- 处理任务暂停、停止、错误重试

#### `src/background/agent/agents/navigator.ts`
- Navigator Agent 实现
- 执行具体浏览器操作（点击、输入、导航等）
- 使用 LLM 决策下一步动作

#### `src/background/agent/agents/planner.ts`
- Planner Agent 实现
- 分析任务，规划执行步骤
- 生成 Navigator 执行计划

#### `src/background/browser/context.ts`
- BrowserContext 类
- 管理当前标签页、多标签页操作
- 提供页面状态获取、导航、截图等

#### `src/background/browser/page.ts`
- Page 类
- Puppeteer/Debugger API 封装
- 元素定位、点击、输入、滚动、截图
- DOM 树构建和可点击元素检测

---

## 三、pages/ - UI 页面组件

### 目录结构

```
pages/
├── side-panel/              # ⭐ 侧边栏面板（主界面）
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── vite.config.mts
│   │
│   ├── public/icons/        # 图标资源
│   │
│   └── src/
│       ├── index.tsx        # 入口
│       ├── SidePanel.tsx    # 主组件
│       ├── utils.ts         # 工具函数
│       │
│       ├── components/      # UI 组件
│       │   ├── ChatInput.tsx        # 聊天输入框
│       │   ├── MessageList.tsx      # 消息列表
│       │   ├── ChatHistoryList.tsx  # 历史任务列表
│       │   ├── BookmarkList.tsx     # 书签列表
│       │   └── SpiritDoll.tsx        # 执行状态动画
│       │
│       ├── types/           # 类型定义
│       │   ├── event.ts
│       │   └── message.ts
│       │
│       └── utils/
│       │   └── spiritOverlay.ts     # 动画覆盖层
│
├── options/                 # ⭐ 设置页面
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── vite.config.mts
│   │
│   └── src/
│       ├── index.tsx        # 入口
│       ├── Options.tsx      # 主设置界面
│       │
│       └── components/      # 设置组件
│           ├── GeneralSettings.tsx    # 通用设置
│           ├── ModelSettings.tsx      # ⭐ LLM 模型配置
│           ├── MCPSettings.tsx        # MCP 服务器配置
│           ├── SkillSettings.tsx      # Skills 配置
│           ├── FirewallSettings.tsx   # URL 防火墙规则
│           └── AnalyticsSettings.tsx  # 数据分析设置
│
└── content/                 # 内容脚本
│   ├── package.json
│   ├── vite.config.mts
│   │
│   └── src/
│       └── index.ts         # 注入到网页的脚本
                            # 用于 DOM 树构建通信
```

### 页面功能说明

| 页面 | 入口 | 功能 |
|------|------|------|
| **side-panel** | `chrome.sidePanel` | 主交互界面：任务输入、执行状态显示、历史记录、书签管理 |
| **options** | `chrome.runtime.openOptionsPage()` | 设置中心：LLM 配置、MCP 服务器、Skills、防火墙、分析 |
| **content** | 内容脚本注入 | DOM 树构建、页面元素检测、高亮显示 |

---

## 四、packages/ - 共享包库

### 目录结构

```
packages/
├── storage/                 # ⭐ Chrome Storage 封装
│   ├── package.json
│   ├── index.ts
│   └── lib/
│       ├── index.ts
│       ├── base/            # 基础存储类型
│       │   ├── base.ts
│       │   ├── enums.ts
│       │   └── types.ts
│       │
│       ├── chat/            # 聊天历史存储
│       │   ├── index.ts
│       │   └── history.ts
│       │
│       ├── profile/         # 用户 profile
│       │   ├── index.ts
│       │   └── user.ts
│       │
│       ├── prompt/          # Prompt 收藏
│       │   └── favorites.ts
│       │
│       └── settings/        # ⭐ 各种设置存储
│           ├── index.ts
│           ├── types.ts
│           ├── agentModels.ts      # Agent 模型配置
│           ├── llmProviders.ts     # LLM Provider 配置
│           ├── generalSettings.ts  # 通用设置
│           ├── firewall.ts         # URL 防火墙
│           ├── mcpServers.ts       # MCP 服务器配置
│           ├── userSkills.ts       # 用户 Skills
│           └── analyticsSettings.ts
│
├── shared/                  # 共享工具
│   ├── package.json
│   ├── index.ts
│   └── lib/
│       ├── hoc/             # 高阶组件
│       │   └── index.ts     # withErrorBoundary, withSuspense
│       ├── hooks/           # React Hooks
│       │   └── index.ts
│       └── utils/
│           ├── index.ts
│           └── shared-types.ts
│
├── ui/                      # UI 组件库
│   ├── package.json
│   ├── index.ts
│   └── lib/
│       └── components/
│           └── Button.tsx   # 共享 Button 组件
│
├── i18n/                    # ⭐ 国际化
│   ├── package.json
│   ├── index.ts
│   ├── generate-i18n.mjs    # i18n 生成脚本
│   └── locales/
│       ├── en/messages.json     # 英语
│       ├── zh_CN/messages.json  # 简体中文
│       ├── zh_TW/messages.json  # 繁体中文
│       └── pt_BR/messages.json  # 巴西葡萄牙语
│
├── mcp-client/              # ⭐ MCP 客户端
│   ├── package.json
│   ├── index.ts
│   └── lib/
│       ├── client/
│       │   └── MCPClient.ts   # MCP 客户端实现
│       ├── transport/         # 传输层
│       ├── types/             # 类型定义
│       └── utils/
│
├── skills/                  # ⭐ Skills 系统
│   ├── package.json
│   ├── index.ts
│   └── lib/
│       ├── core/
│       │   ├── SkillExecutor.ts    # Skill 执行器
│       │   ├── SkillRegistry.ts    # Skill 注册表
│       │   ├── TemplateEngine.ts   # 模板引擎
│       ├── parser/
│       │   └── MarkdownParser.ts   # Markdown 解析
│       ├── types/
│       │   ├── skill.ts        # Skill 类型定义
│       │   ├── execution.ts
│       │   └── template.ts
│       └── builtin/            # 内置 Skills
│
├── dev-utils/               # 开发工具
│   ├── package.json
│   └── lib/
│       ├── logger.ts
│       └── manifest-parser/
│
├── hmr/                     # 热更新模块
│   ├── package.json
│   └── lib/
│       ├── constant.ts
│       ├── initializers/
│       ├── injections/
│       ├── interpreter/
│       └── plugins/
│
├── vite-config/             # Vite 配置共享
│   ├── package.json
│   └── lib/
│       └── index.ts         # withPageConfig 等工具
│
├── tsconfig/                # TypeScript 配置共享
│   ├── package.json
│   └── bases/               # 基础 tsconfig
│
├── tailwind-config/         # Tailwind 配置共享
│   ├── package.json
│   └── index.ts             # 共享 Tailwind tokens
│
├── schema-utils/            # Schema 工具
│   ├── package.json
│   └── lib/
│
└── zipper/                  # 打包工具
    ├── package.json
    └── lib/
        └── zip-bundle/
```

### 包功能说明

| 包名 | 作用 | 主要使用者 |
|------|------|-----------|
| **storage** | Chrome Storage API 封装，提供类型安全的存储访问 | chrome-extension, pages |
| **shared** | 共享工具、HOC、Hooks | pages |
| **ui** | 共享 UI 组件 | pages |
| **i18n** | 国际化消息和本地化 | chrome-extension, pages |
| **mcp-client** | MCP (Model Context Protocol) 客户端实现 | chrome-extension |
| **skills** | Skills 任务模板系统 | chrome-extension |
| **dev-utils** | 开发和构建工具 | chrome-extension |
| **hmr** | 热更新模块 | chrome-extension |
| **vite-config** | Vite 配置共享 | pages, chrome-extension |
| **tsconfig** | TypeScript 配置共享 | 所有包 |
| **tailwind-config** | Tailwind CSS 配置共享 | pages |
| **schema-utils** | JSON Schema 工具 | chrome-extension |
| **zipper** | 扩展打包工具 | root |

---

## 五、依赖关系图

```
                    ┌─────────────────────┐
                    │  chrome-extension   │
                    │   (核心扩展)         │
                    └─────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│    storage    │    │    shared     │    │     i18n      │
│  (设置存储)   │    │  (共享工具)   │    │   (国际化)   │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │
        ▼                     ▼
┌───────────────┐    ┌───────────────┐
│      ui       │    │  mcp-client   │
│  (UI组件)     │    │  (MCP协议)    │
└───────────────┘    └───────────────┘
                              │
                              ▼
                      ┌───────────────┐
                      │    skills     │
                      │  (任务模板)   │
                      └───────────────┘


pages/side-panel ──────► storage, shared, ui, i18n
pages/options   ──────► storage, shared, ui, i18n
pages/content   ──────► i18n
```

---

## 六、核心架构流程

### 任务执行流程

```
用户输入任务
    │
    ▼
┌─────────────────────────────────────────────┐
│              Executor (执行器)               │
│  src/background/agent/executor.ts           │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│            Planner Agent                     │
│  src/background/agent/agents/planner.ts     │
│  • 分析任务目标                              │
│  • 规划执行步骤                              │
│  • 输出计划给 Navigator                      │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│           Navigator Agent                    │
│  src/background/agent/agents/navigator.ts   │
│  • 执行浏览器操作                            │
│  • 点击、输入、导航、滚动                    │
│  • 使用 LLM 决策下一步                      │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│          BrowserContext                      │
│  src/background/browser/context.ts          │
│  • 管理标签页                                │
│  • 获取页面状态                              │
│  • 执行导航操作                              │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│               Page                           │
│  src/background/browser/page.ts             │
│  • Puppeteer/Debugger API 操作              │
│  • DOM 元素定位和交互                        │
│  • 截图和状态获取                            │
└─────────────────────────────────────────────┘
```

### Agent 动作系统

```
Navigator Agent 输出动作
    │
    ▼
┌─────────────────────────────────────────────┐
│          ActionBuilder                       │
│  src/background/agent/actions/builder.ts    │
│  • 解析动作 JSON                             │
│  • 验证动作 Schema                           │
│  • 调用对应 Action 实现                      │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│          具体动作执行                        │
│  • click_element(index)      → 点击         │
│  • input_text(index, text)   → 输入         │
│  • go_to_url(url)            → 导航         │
│  • scroll(direction)         → 滚动         │
│  • wait(seconds)             → 等待         │
│  • extract_content(goal)     → 提取         │
└─────────────────────────────────────────────┘
```

---

## 七、关键类型和接口

### BrowserContextConfig (`browser/views.ts`)

```typescript
interface BrowserContextConfig {
  minimumWaitPageLoadTime: number;      // 最小页面加载等待
  waitForNetworkIdlePageLoadTime: number; // 网络空闲判定时间
  maximumWaitPageLoadTime: number;      // 最大等待时间
  waitBetweenActions: number;           // 动作间等待
  smartWaitEnabled: boolean;            // 智能等待开关
  smartWaitMaxTimeout: number;          // 智能等待最大超时
  smartWaitDomStableTime: number;       // DOM 稳定判定时间
  browserWindowSize: { width, height }; // 浏览器窗口大小
  viewportExpansion: number;            // 视口扩展
  allowedUrls: string[];                // 允许的 URL
  deniedUrls: string[];                 // 禁止的 URL
  homePageUrl: string;                  // 主页 URL
  displayHighlights: boolean;           // 高亮显示开关
}
```

### BrowserState (`browser/views.ts`)

```typescript
interface BrowserState extends PageState {
  url: string;              // 当前 URL
  title: string;            // 页面标题
  elementTree: DOMElementNode; // DOM 树
  selectorMap: Map<number, DOMElementNode>; // 元素索引映射
  screenshot: string | null; // 截图 base64
  tabs: TabInfo[];          // 标签页列表
}
```

### ActionResult (`agent/types.ts`)

```typescript
interface ActionResult {
  isDone: boolean;          // 任务是否完成
  extractedContent?: string; // 提取的内容
  error?: string;           // 错误信息
  includeInMemory: boolean; // 是否包含在记忆中
  interactedElement?: DOMHistoryElement; // 交互的元素
}
```

---

## 八、构建和开发

### 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式（热更新）
pnpm dev

# 构建
pnpm build

# 类型检查
pnpm type-check

# 代码格式化
pnpm prettier

# 代码检查
pnpm lint

# 单元测试
pnpm -F chrome-extension test

# E2E 测试
pnpm e2e

# 打包扩展
pnpm zip
```

### 构建产物

```
dist/
├── manifest.json           # 扩展 Manifest
├── background.iife.js      # Service Worker 脚本
├── side-panel/             # 侧边栏页面
├── options/                # 设置页面
├── content/                # 内容脚本
├── public/                 # 公共资源
└── icons/                  # 图标

dist-zip/
└── nanobrowser-x.x.x.zip   # 发布包
```

---

## 九、扩展能力

### MCP (Model Context Protocol)

集成外部工具和服务的协议：
- 配置位置：`packages/storage/lib/settings/mcpServers.ts`
- 服务实现：`chrome-extension/src/background/services/mcp/`
- UI 配置：`pages/options/src/components/MCPSettings.tsx`

### Skills 任务模板

预定义任务模板系统：
- 包位置：`packages/skills/`
- 服务实现：`chrome-extension/src/background/services/skills/`
- UI 配置：`pages/options/src/components/SkillSettings.tsx`

### 支持的 LLM 提供商

| Provider | 模型 |
|----------|------|
| Anthropic | Claude 3.5 Sonnet, Claude 4, Opus |
| OpenAI | GPT-4o, GPT-4o-mini |
| Google | Gemini 2.0 Flash, Gemini 1.5 Pro |
| DeepSeek | DeepSeek Chat, DeepSeek Coder |
| Groq | Llama 3.1, Mixtral |
| Ollama | 本地模型 |
| Cerebras | Llama 3.1/3.3 |
| XAI | Grok |

---

## 十、安全机制

### Guardrails 安全防护 (`services/guardrails/`)

- **patterns.ts**: 检测敏感模式和恶意指令
- **sanitizer.ts**: 清理用户输入，防止注入攻击
- URL 防火墙：限制访问特定域名

### URL 验证 (`browser/util.ts`)

```typescript
function isUrlAllowed(url: string, allowedUrls: string[], deniedUrls: string[]): boolean
```

---

## 十一、国际化 (i18n)

### 键命名规范

```
{component}_{category}_{specificAction}_{state}

例如：
- bg_errors_noTabId           # Background 错误
- act_click_ok                # Action 点击成功
- chat_input_placeholder      # Chat 输入占位符
- options_model_title         # Options 模型标题
```

### 使用方式

```typescript
import { t } from '@extension/i18n';

t('bg_errors_noTabId')
t('act_click_ok', ['5', 'Submit Button'])  // 带参数
```

---

## 参考资料

- [CLAUDE.md](../CLAUDE.md) - Claude AI 开发指南
- [AGENTS.md](../AGENTS.md) - Agent 系统详细说明
- [README.md](../README.md) - 项目说明
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [Puppeteer](https://pptr.dev/)
- [LangChain.js](https://js.langchain.com/)