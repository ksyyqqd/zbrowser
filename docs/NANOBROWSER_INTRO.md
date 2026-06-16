# Nanobrowser - AI 浏览器协作助手

## 产品定位

与 Rclaw 等沙箱式方案不同，Nanobrowser 基于浏览器插件实现，构建了一种全新的 AI 与用户协作模式：

| 方案 | 模式 | 特点 |
|------|------|------|
| Rclaw | 沙箱浏览器 | 浏览器作为 AI 工具，完全托管环境，隔离运行 |
| **Nanobrowser** | 浏览器插件 | AI 与用户协作，在真实浏览器中辅助工作，即用即走 |

**插件模式的核心优势**：
- 无需切换环境，AI 直接在你的浏览器中协助处理日常任务
- 保留用户对浏览器的完全控制权
- 隐私安全：所有数据本地处理，不上传云端
- 成本可控：使用自己的 API Key，按用量付费

---

## 技术架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Chrome Extension (Manifest V3)                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Side Panel  │  │   Options    │  │   Content    │   UI Pages    │
│  │   (React)    │  │   (React)    │  │   Script     │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                 │                       │
│         └─────────────────┼─────────────────┘                       │
│                           │ Chrome Messaging API                     │
│                           ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    Background Service Worker                      ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              ││
│  │  │   Executor  │  │Task Manager │  │   Services  │              ││
│  │  │             │  │             │  │ MCP/Skills/ │              ││
│  │  │  ┌─────┐    │  │             │  │ Workflow    │              ││
│  │  │  │Planner│  │  │             │  │             │              ││
│  │  │  └─────┘    │  │             │  │             │              ││
│  │  │  ┌─────┐    │  │             │  │             │              ││
│  │  │  │Navigator│  │             │  │             │              ││
│  │  │  └─────┘    │  │             │  │             │              ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘              ││
│  │                          │                                       ││
│  │                          ▼                                       ││
│  │  ┌─────────────────────────────────────────────────────────────┐││
│  │  │                    Browser Context                           │││
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐  │││
│  │  │  │   Page   │  │DOM Service│  │   Puppeteer CDP          │  │││
│  │  │  │(Tab Mgmt)│  │(Element   │  │   Connection             │  │││
│  │  │  │          │  │ Detection)│  │                          │  │││
│  │  │  └──────────┘  └──────────┘  └──────────────────────────┘  │││
│  │  └─────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌──────────────────────┐
              │   LLM Providers      │
              │  OpenAI/Anthropic/   │
              │  Gemini/Ollama/etc.  │
              └──────────────────────┘
```

### Monorepo 工作区结构

项目采用 **pnpm workspaces + Turbo** 进行构建管理：

```
zbrowser/
├── chrome-extension/          # 核心 Chrome 扩展
│   └────── src/background/    # Service Worker 核心
│       ├── agent/             # 多代理系统
│       │   ├── agents/        # Navigator/Planner 代理实现
│       │   ├── executor.ts    # 执行协调器
│       │   ├── prompts/       # Prompt 模板管理
│       │   ├── actions/       # 动作定义与构建
│       │   └── messages/      # 消息管理服务
│       ├── browser/           # 浏览器自动化
│       │   ├── context.ts     # 浏览器上下文管理
│       │   ├── page.ts        # 页面操作封装
│       │   └── dom/           # DOM 解析与元素检测
│       ├── services/          # 扩展服务
│       │   ├── mcp/           # MCP 协议集成
│       │   ├── skills/        # 技能系统
│       │   ├── workflow/      # 工作流引擎
│       │   └── guardrails/    # 安全防护
│       └── recorder/          # 操作录制
│
├── pages/                     # UI 页面 (React)
│   ├── side-panel/            # 侧边栏聊天界面
│   ├── options/               # 设置页面
│   └── content/               # 内容脚本注入
│
├── packages/                  # 共享包
│   ├── shared/                # 公共类型与工具
│   ├── storage/               # Chrome 存储抽象
│   ├── ui/                    # 共享 React 组件
│   ├── i18n/                  # 国际化
│   ├── mcp-client/            # MCP 客户端
│   ├── skills/                # 技能定义
│   ├── workflow/              # 工作流定义
│   └── schema-utils/          # Zod 验证 schemas
│
└── dist/                      # 构建输出目录
```

### 核心技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **扩展框架** | Chrome Extension Manifest V3 | Service Worker 架构，支持持久化后台 |
| **构建工具** | Vite + Turbo | 模块化构建，任务依赖管理 |
| **前端框架** | React 18 + TypeScript | UI 页面开发 |
| **样式方案** | Tailwind CSS |原子化 CSS，快速开发 |
| **LLM 集成** | LangChain.js | 多模型适配，统一调用接口 |
| **浏览器自动化** | Puppeteer CDP | Chrome DevTools Protocol 直连 |
| **类型验证** | Zod | 运行时类型校验，LLM 输出解析 |
| **状态存储** | Chrome Storage API | 本地持久化，跨页面同步 |

---

## 核心功能实现原理

### 1. 多代理系统 (Multi-Agent System)

Nanobrowser 采用 **Navigator + Planner** 双代理架构，实现高效的任务分解与执行：

#### Planner Agent（规划者）

**职责**：高层任务规划、进度评估、策略调整

```typescript
// Planner 输出结构 (planner.ts)
interface PlannerOutput {
  observation: string;      // 当前状态观察
  challenges: string;       // 遇到的挑战
  done: boolean;            // 任务是否完成
  next_steps: string;       // 下一步行动建议
  final_answer: string;     // 最终答案（任务完成时）
  reasoning: string;        // 推理过程
  web_task: boolean;        // 是否为网页任务
}
```

**工作流程**：
1. 获取当前浏览器状态（包含视觉分析）
2. 分析任务进度，评估是否完成
3. 生成下一步行动建议供 Navigator 参考
4. 按 `planningInterval` 定期运行，动态调整策略

#### Navigator Agent（导航者）

**职责**：页面交互、DOM 操作、具体动作执行

```typescript
// Navigator 输出结构 (navigator.ts)
interface NavigatorOutput {
  current_state: {
    next_goal: string;      // 当前目标
  };
  action: Action[];         // 要执行的动作列表
}
```

**动作类型**：
- `go_to_url` - 导航到指定 URL
- `click_element` - 点击元素（支持索引选择）
- `input_text` - 输入文本
- `send_keys` - 发送键盘按键
- `scroll_to_percent` - 滚动页面
- `extract_content` - 提取页面内容
- `mcp_tool` - 调用 MCP 工具
- `skill_invoke` - 执行技能

**执行循环**：
```
┌───────────────────────────────────────────────────┐
│  Step Loop (maxSteps = default 100)              │
│  ┌─────────────────────────────────────────────┐ │
│  │ 1. Check if stopped/paused                   │ │
│  │ 2. Run Planner (every planningInterval steps)│ │
│  │    - 获取浏览器状态                          │ │
│  │    - 生成下一步建议                          │ │
│  │    - 检查任务是否完成                        │ │
│  │ 3. Run Navigator                             │ │
│  │    - 获取浏览器状态                          │ │
│  │    - 调用 LLM 生成动作                       │ │
│  │    - 执行动作序列                            │ │
│  │    - 智能等待页面稳定                        │ │
│  │ 4. Record history for replay                 │ │
│  └─────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

#### Executor（执行协调器）

**职责**：协调 Planner 和 Navigator，管理任务生命周期

```typescript
// executor.ts 核心逻辑
class Executor {
  async execute(): Promise<void> {
    // 1. 初始化：注入 MCP/Skills 信息、分析用户图片
    await this.injectMCPToolsInfo();
    await this.injectSkillsInfo();
    
    // 2. 执行循环
    for (let step = 0; step < maxSteps; step++) {
      // Planner 定期运行
      if (step % planningInterval === 0) {
        const plan = await this.runPlanner();
        if (plan.result.done) break;
      }
      
      // Navigator 执行动作
      const done = await this.navigate();
      if (done) {
        // 等待 Planner 验证完成
      }
    }
    
    // 3. 存储历史记录（用于重播）
    await this.storeHistory();
  }
}
```

### 2. 浏览器自动化引擎

#### BrowserContext（浏览器上下文）

管理标签页生命周期和页面状态：

```typescript
// context.ts 核心功能
class BrowserContext {
  private _currentTabId: number | null;
  private _attachedPages: Map<number, Page>;
  
  // 标签页操作
  async getCurrentPage(): Promise<Page>;
  async switchTab(tabId: number): Promise<Page>;
  async navigateTo(url: string): Promise<void>;
  async openTab(url: string): Promise<Page>;
  async closeTab(tabId: number): Promise<void>;
  
  // 状态获取
  async getState(useVision: boolean): Promise<BrowserState>;
  async waitForPageStability(): Promise<void>;
}
```

**智能等待策略**：替代固定延迟，动态检测页面稳定：
- DOM 结构变化检测
- 网络请求完成检测
- 页面渲染稳定检测

#### DOM Service（DOM 解析服务）

**核心能力**：实时解析页面 DOM，识别可交互元素

```typescript
// service.ts 核心流程
async function getClickableElements(tabId: number): Promise<DOMState> {
  // 1. 注入 buildDomTree.js 脚本到目标页面
  await injectBuildDomTreeScripts(tabId);
  
  // 2. 在页面上下文中执行 DOM 解析
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.buildDomTree({
      showHighlightElements: true,
      viewportExpansion: 0,
    }),
  });
  
  // 3. 构建结构化 DOM 树
  return _constructDomTree(result);
}
```

**DOM 元素识别算法**：
- **可见性检测**：元素是否在视口内且可见
- **交互性判断**：按钮、链接、输入框等可点击元素
- **层级索引**：为每个可交互元素分配唯一 highlightIndex
- **XPath 生成**：生成稳定的元素定位路径

**页面状态结构**：
```typescript
interface BrowserState {
  url: string;
  title: string;
  elementTree: DOMElementNode;    // DOM 树结构
  selectorMap: Map<number, DOMElementNode>; // 索引映射
  screenshot?: string;             // 视觉截图（可选）
  tabs: TabInfo[];                 // 所有标签页信息
}
```

### 3. 视觉理解能力

**工作原理**：
1. Navigator 执行前，获取当前页面截图
2. 如果配置了视觉模型（Vision LLM），将截图编码为 base64
3. 通过 LangChain 多模态接口发送给 LLM
4. LLM 返回对页面内容的视觉理解

```typescript
// 视觉分析流程
const state = await browserContext.getState(useVision);
if (useVision && state.screenshot) {
  // 将截图作为多模态消息发送给 LLM
  const visionMessage = new HumanMessage({
    content: [
      { type: 'text', text: '分析当前页面状态' },
      { type: 'image_url', image_url: { url: screenshot } }
    ]
  });
}
```

### 4. MCP 协议集成

**Model Context Protocol (MCP)** 允许连接外部工具服务器：

```typescript
// MCPService.ts
class MCPService {
  private client: MCPClient;
  
  async initialize(): Promise<void> {
    // 加载用户配置的 MCP 服务器
    const servers = await mcpServersStore.getEnabledServers();
    
    // 自动连接启用的服务器
    for (const server of servers.filter(s => s.autoConnect)) {
      await this.connectServer(server);
    }
  }
  
  // 工具执行
  async executeTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult>;
}
```

**在 Navigator 中使用 MCP 工具**：
```typescript
// 动作定义
{
  "mcp_tool": {
    "intent": "获取天气信息",
    "server_id": "weather-server",
    "tool_name": "get_weather",
    "arguments": { "city": "北京" }
  }
}
```

### 5. Skills 技能系统

**技能**：可复用的操作模板，支持参数化执行

```typescript
// SkillsService.ts
class SkillsService {
  private registry: SkillRegistry;
  private executor: SkillExecutor;
  
  // 加载内置技能 + 用户自定义技能
  async initialize(): Promise<void> {
    const { builtInSkills } = await import('@extension/skills');
    for (const skill of builtInSkills) {
      this.registry.registerSkill(skill);
    }
    
    const userSkills = await userSkillsStore.getAllSkills();
    for (const skill of userSkills) {
      this.registry.registerSkill(skill);
    }
  }
}
```

**技能结构**：
```typescript
interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: SkillParameter[];
  steps: SkillStep[];
  executionMode: 'expanded' | 'atomic';  // 展开执行或原子执行
}
```

### 6. Workflow 工作流引擎

**工作流**：用户可自行编排的操作序列，无需 AI 参与

```typescript
// WorkflowService.ts
class WorkflowService {
  // 执行工作流
  async executeWorkflow(
    workflowId: string,
    tabId: number,
    params: Record<string, unknown>,
    actionExecutor: ActionExecutor,
    aiInvoker: AIInvoker,
  ): Promise<WorkflowResult>;
}
```

**工作流节点类型**：
- `action` - 执行浏览器动作
- `ai_invoke` - 调用 AI 模型
- `condition` - 条件分支
- `loop` - 循环执行
- `parallel` - 并行执行

**应用场景**：
- 简单操作不需要 AI 参与，节省 Token
- 固定流程自动化，可靠性更高
- 用户自定义操作编排

### 7. 操作录制与 Skill 生成

**RecorderManager** 记录用户操作，自动转换为 Skill：

```typescript
// RecorderManager.ts
class RecorderState {
  startSession(tabId: number): RecordingSession;
  addAction(action: RecordedAction): boolean;
}

// 动作转换器
class ActionConverter {
  convertAction(action: RecordedAction, stepIndex: number): SkillStep {
    switch (action.type) {
      case 'navigate':
        return { action: 'go_to_url', parameters: { url: action.navigateInfo?.url } };
      case 'click':
        return { action: 'click_element', parameters: { selector: action.element?.primary } };
      case 'input':
        return { action: 'input_text', parameters: { text: action.value } };
      // ...
    }
  }
}
```

**录制支持的动作类型**：
- 页面导航（navigate）
- 元素点击（click）
- 文本输入（input）
- 键盘按键（keydown）
- 页面滚动（scroll）
- 下拉选择（select）
- 复制/粘贴/剪切（copy/paste/cut）

### 8. 重播功能

**原理**：存储历史执行记录，支持精确回放

```typescript
// executor.ts replayHistory
async replayHistory(sessionId: string): Promise<ActionResult[]> {
  // 1. 加载历史记录
  const history = await chatHistoryStore.loadAgentStepHistory(sessionId);
  
  // 2. 逐步骤回放
  for (const historyItem of history.history) {
    // 解析模型输出，获取要执行的动作
    const { actionsToReplay } = this.parseHistoryModelOutput(historyItem);
    
    // 更新元素索引（DOM 可能变化）
    const updatedActions = await this.updateActionIndices(interactedElement, action, currentState);
    
    // 执行动作
    await this.doMultiAction(updatedActions);
  }
}
```

**元素索引更新算法**：处理 DOM 结构变化，智能匹配历史元素：
```typescript
async updateActionIndices(
  historicalElement: DOMHistoryElement,
  action: Record<string, unknown>,
  currentState: BrowserState,
): Promise<Record<string, unknown> | null> {
  // 在当前 DOM 树中查找历史元素
  const currentElement = await HistoryTreeProcessor.findHistoryElementInTree(
    historicalElement,
    currentState.elementTree,
  );
  
  // 更新动作中的元素索引
  if (currentElement.highlightIndex !== oldIndex) {
    actionInstance.setIndexArg(actionArgs, currentElement.highlightIndex);
  }
}
```

---

## 核心能力

### 🎯 精准交互
- **标签页自动化**：自动切换、收集、整理多个标签页信息
- **图像识别增强**：引入视觉理解能力，更精准识别页面元素
- **交互式操作**：点击、输入、滚动等浏览器操作的自动化执行
- **智能等待**：动态检测页面稳定，替代固定延迟

### 🔄 能力沉淀
- **操作录制**：记录用户操作流程
- **Skill 生成**：将录制转为可复用的技能脚本
- **工作流编排**：Skill 可转换为工作流，用户可自行编排，无需 AI 参与，节省 Token
- **历史重播**：精确回放历史执行记录，支持 DOM 变化适配

### 📊 输出增强
- 对话框支持 **Markdown 渲染**
- **表格导出**（Excel/CSV）
- **Markdown 文档导出**
- 集成 **MCP** 与 **Skill** 扩展能力

---

## 典型使用场景

### 📋 信息收集
> "帮我梳理这些接口文档"

AI 自动切换每个标签页，提取关键信息，输出结构化文档。

**实现原理**：
1. Planner 分析任务，制定标签页遍历策略
2. Navigator 依次切换标签页，提取页面内容
3. 将信息汇总，生成结构化输出

### 📝 内容生成
> 语雀周报自动生成  
> 参照当前页面表格格式，生成类似内容

**实现原理**：
1. 视觉模型分析页面表格结构
2. 根据用户需求生成内容
3. 按原有格式填充表格

### 🔍 辅助分析
> PRD 需求分析  
> 竞品调研整理

**实现原理**：
1. 多页面信息收集
2. AI 分析整合
3. 输出分析报告

### ⚡ 即时辅助
浏览过程中突然需要 AI 帮忙处理当前页面内容，或执行重复操作——一键唤起，即用即走。

---

## AI 编码体验

### 技术栈适配度

| 技术栈 | AI 生成质量 | 说明 |
|--------|------------|------|
| React + Tailwind CSS | ⭐⭐⭐⭐⭐ | 表现优秀，代码质量高 |
| 主流前端框架 (Vue/Svelte) | ⭐⭐⭐⭐ | 较好，偶有调整 |
| 小程序 (微信/支付宝) | ⭐⭐⭐ | 常有语法错误、样式还原度低 |

**建议**：
- 在主流技术栈上让 AI 参与开发，效率显著提升
- 小程序场景需更多人工校验，AI 对平台特性理解不足

### 架构建议

**模块化是必须的**：

```
┌─────────────────────────────────────────────────────┐
│  模块化架构原则                                      │
├─────────────────────────────────────────────────────┤
│  1. 先定好基础架构                                   │
│  2. 功能模块化拆分                                   │
│  3. 保持文件精简（单文件 < 500 行为佳）              │
│  4. 清晰的接口边界                                   │
│  5. 类型定义独立文件                                 │
├─────────────────────────────────────────────────────┤
│  ⚠️ 代码过长时 AI 容易误改其他功能                  │
│     模块化可降低风险，提高 AI 理解准确度            │
└─────────────────────────────────────────────────────┘
```

---

## 项目地址

👉 [GitHub - Nanobrowser](https://github.com/nanobrowser/nanobrowser)

---

*开源免费，支持多 LLM 提供商（OpenAI、Anthropic、Gemini、Ollama、Groq、Cerebras 等），本地运行，隐私安全。*

**Made with ❤️ by the Nanobrowser Team**