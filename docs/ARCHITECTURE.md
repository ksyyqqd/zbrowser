# Nanobrowser 架构设计

> 状态:本文档反映截至 `2026-06-23` 的实际代码结构,与现有源码逐项对应。后续重大架构变更须同步更新本文档。
>
> 关联资料:
> - `CLAUDE.md`:开发约束、命名/构建规范(必读)
> - `docs/NANOBROWSER_INTRO.md`:产品定位
> - `docs/AUTOMATION_CORE_PRINCIPLES.md`:浏览器自动化设计原则
> - `docs/WORKFLOW_EDITOR_OPTIMIZATIONS.md`:工作流编辑器历次优化记录
> - `docs/recording-skill-generation.md`:录制 → skill 生成方案

---

## 1. 顶层定位

Nanobrowser 是一个 Chrome 扩展(Manifest V3),把"浏览器自动化"和"AI 决策"结合到一起。三大能力支柱:

| 支柱 | 形态 | 主消费者 |
|------|------|---------|
| **多 Agent 自动化**(实时 AI 决策) | 侧栏聊天 → Planner/Navigator/Validator 协作执行 | 终端用户 |
| **工作流系统**(固化脚本) | 可视化 DAG 编辑器 + 执行器 | 终端用户、AI |
| **Skill 系统**(可被 AI 调用的工具) | 顺序步骤定义 + 参数 schema | LLM、Agent |

支撑这三者的:**录制器**(回放为工作流/skill)、**LLM Provider 抽象**、**MCP 客户端**(对接外部工具服务器)、**Browser Context**(统一 Tab/DOM 操作层)。

---

## 2. 仓库结构(Monorepo)

构建工具:**pnpm workspaces + Turbo**。每个 workspace 自带 `vite.config.mts` + `tsconfig.json`。

```
nanobrowser/
├ chrome-extension/             # 扩展主体(manifest + service worker)
│  └ src/background/            # 后台服务总入口
│     ├ index.ts                # 消息总线、tabs/webNavigation 监听、生命周期
│     ├ agent/                  # 多 Agent 系统(Planner/Navigator/Validator)
│     │  ├ executor.ts          # 三 Agent 协作的 Orchestrator
│     │  ├ agents/              # 各 Agent 实现
│     │  ├ actions/             # 浏览器原子动作集
│     │  ├ event/               # 执行事件(EXEC_*)
│     │  ├ messages/            # 会话消息管理(messageManager)
│     │  ├ prompts/             # Agent system prompt 模板
│     │  └ history.ts           # Agent 行为历史
│     ├ browser/                # 浏览器抽象层
│     │  ├ context.ts           # BrowserContext(全局 Tab/Page 注册中心)
│     │  ├ page.ts              # Page 封装(Puppeteer/CDP)
│     │  └ dom/                 # DOM 服务(选择器/快照/可视性)
│     ├ recorder/               # 操作录制器
│     │  ├ RecorderManager.ts   # 录制会话、合成 action、跨 Tab 跟踪
│     │  └ types.ts             # RecordedAction / RecordingSession
│     ├ services/               # 后台服务
│     │  ├ workflow/            # 工作流执行服务(host adapter)
│     │  ├ mcp/                 # MCP 客户端(外部工具服务器)
│     │  ├ skills/              # Skill 注册/查找
│     │  ├ guardrails/          # 防火墙(URL/操作白名单)
│     │  ├ analytics.ts         # PostHog 上报
│     │  └ speechToText.ts      # 语音转文字
│     └ task/                   # 长时任务调度
│
├ pages/                        # UI 端
│  ├ side-panel/                # 主聊天面板(React)
│  ├ options/                   # 设置页(模型/Skill/Workflow/MCP/防火墙)
│  └ content/                   # 内容脚本(录制时的页面侧采集)
│
└ packages/                     # 共享包
   ├ workflow/                  # 工作流核心(纯库,无 DOM 依赖)
   │  ├ types/                  # Workflow/WorkflowNode/WorkflowEdge/ExecutionContext
   │  ├ core/                   # WorkflowExecutor / WorkflowRegistry
   │  ├ parser/                 # 序列化/反序列化
   │  └ converter/              # Workflow ↔ Skill 互转
   ├ skills/                    # Skill 核心(纯库)
   │  ├ types/                  # Skill/SkillStep/Parameter
   │  ├ core/                   # Skill 解析/执行接口
   │  ├ parser/                 # Markdown ↔ Skill / SkillPackage 打包
   │  └ builtin/                # 内置 skill 包
   ├ storage/                   # chrome.storage 抽象
   │  ├ base/                   # createStorage(subscribe/getSnapshot)
   │  ├ settings/               # llmProvider/userSkills/userWorkflows/firewall/...
   │  ├ chat/                   # 会话历史
   │  └ prompt/                 # 收藏 prompt
   ├ mcp-client/                # Model Context Protocol 客户端
   ├ shared/                    # 跨包通用工具/HOC
   ├ ui/                        # 通用 React 组件
   ├ i18n/                      # i18n 生成器(Chrome i18n 协议)
   ├ schema-utils/              # Zod schema 工具
   ├ tailwind-config/           # 共享 Tailwind 配置
   ├ vite-config/               # 共享 Vite 配置(withPageConfig)
   ├ tsconfig/                  # 共享 tsconfig
   ├ hmr/                       # 开发态热重载
   ├ dev-utils/                 # 开发辅助
   └ zipper/                    # 扩展打包(.zip → dist-zip/)
```

构建产物:
- 调试加载:`dist/`(`chrome://extensions/` → "Load unpacked")
- 发布包:`dist-zip/nanobrowser-*.zip`(`pnpm zip`)

---

## 3. 进程模型

Manifest V3 强制 service worker,扩展启动后所有"长生命周期"逻辑必须能容忍 worker 休眠。

```
┌─────────────────┐       ┌──────────────────┐       ┌────────────────────┐
│  Side Panel     │ port  │ Background       │ tabs/ │ Target Tab         │
│  (React UI)     │◄─────►│ Service Worker   │◄─────►│ (任意网站)         │
│                 │       │                  │       │  ├ content script  │
│ - 聊天主界面     │       │ - Agent Executor │       │  ├ recorder hooks  │
│ - 工作流卡片     │       │ - Workflow Svc   │       │  └ picker overlay  │
│ - 录制 Pill      │       │ - Recorder       │       │     (按需注入)     │
└─────────────────┘       │ - MCP Client     │       └────────────────────┘
                          │ - Browser Ctx    │
                          └──────────────────┘
                                  ▲
                                  │ runtime msg / port
                                  │
┌─────────────────┐               │       ┌────────────────────┐
│ Options Page    │ ──────────────┘       │ chrome.storage     │
│ (设置页)         │  独立 tab,直读 store  │  (sync + local)    │
└─────────────────┘                       └────────────────────┘
```

通信约定:
- **SidePanel ↔ Background**:长连接 `chrome.runtime.connect` port(实时事件流)+ `runtime.sendMessage`(一次性请求)
- **Options ↔ Background**:`runtime.sendMessage` 为主(执行工作流、注入 picker 等)
- **Background ↔ Target Tab**:`chrome.tabs.sendMessage` + `chrome.scripting.executeScript`(按需注入)
- **跨页同步状态**(主题等):`localStorage` + `storage` 事件 / chrome.storage 订阅

关键 port 消息(非穷举):
- `new_task` / `follow_up_task` / `cancel_task` / `pause_task` / `resume_task`:任务生命周期
- `clarify_response` ↔ `clarify_ack`:`ask_user` 弹窗回应路由(见 §4.4)
- `replay` / `start_recording` / `stop_recording`:重放与录制
- `execute_workflow` / `execute_skill`:工具调用
- `pick_element_start`(runtime msg, 非 port):侧边栏/工作流编辑器 → 注入页面 picker overlay → 拿 selector/xpath

---

## 4. 多 Agent 系统(`background/agent/`)

### 4.1 三个角色

| Agent | 职责 | 关键文件 |
|-------|------|---------|
| **Planner** | 高层任务分解、决定下一步该做什么、产出 plan 草案 | `agents/planner*` |
| **Navigator** | 执行具体浏览器动作(点击/输入/导航/读取);可调用 skill / MCP tool | `agents/navigator*` + `actions/` |
| **Validator** | 检查是否达成用户目标,反馈给 Planner 决定是否继续 | `agents/validator*` |

### 4.2 协作循环

```
USER PROMPT
     │
     ▼
┌──────────┐
│ Executor │ ← 创建 AgentContext / messageManager / event emitter
└────┬─────┘
     │
     ▼
┌──────────┐  plan      ┌───────────┐  actions   ┌───────────┐
│ Planner  │ ─────────► │ Navigator │ ─────────► │ Validator │
└──────────┘            └───────────┘            └─────┬─────┘
     ▲                                                 │
     └──────────────────"未完成,继续"─────────────────┘
                              │
                       "已完成" → 输出最终答案给 SidePanel
```

每一轮事件通过 `EventManager` 发到 SidePanel 显示。

### 4.3 关键约束

- Agent 提示词集中在 `prompts/`,**不与代码逻辑混淆**
- 浏览器原子动作集中在 `actions/`,Navigator 通过工具调用接口(每个 action 都有 zod schema)
- Skill 可以被 Navigator 当作"高层动作"调用,实现"AI 用 skill 完成事"
- MCP tool 同样作为可调用工具,通过 `services/mcp/` 桥接

### 4.4 用户澄清与把握度闸门

为了让 Agent 在不确定时**主动停下问用户**而不是猜,系统在 Agent 协作循环之上叠加了一套澄清机制。

**组成部分:**

| 组件 | 文件 | 作用 |
|---|---|---|
| `ask_user` action | `actions/schemas.ts` + `actions/builder.ts` | Navigator 的可调用动作:暂停任务、向 SidePanel 发 `ASK_USER` 事件、等待 `ClarifyResponse` 后 resume |
| Planner 的 `ask_user` 字段 | `agents/planner.ts` 的 `plannerOutputSchema` | Planner 可直接在 plan JSON 里输出结构化提问,executor 走相同的 pause/await 流程 |
| 把握度闸门 | `agents/navigator.ts` 的 `maybeGateOnLowConfidence` | LLM 输出 `current_state.element_confidence < 0.7` 且本步有元素交互动作时,**丢弃动作**自动转 `ask_user(allow_element_pick=true)` |
| `ClarifyDialog` 弹窗 | `pages/side-panel/src/components/ClarifyDialog.tsx` | 单选项 + 自由文本 + 🎯 元素拾取入口 + 终止任务 |
| `ClarifyResponse` 路由 | `background/index.ts` port `clarify_response` case → `AgentContext.resolveClarification` | 唤醒 Navigator/Planner 那边 `await waitForClarification(requestId)` 的 promise |
| 元素事实库 | `elementHintsStore`(见 §10) | 用户拾取后**接下来的动作执行成功**才落库,按 hostname 索引;state message 里自动拼"已知该站元素"段供 LLM 复用 |
| 手动标记入口 | `pages/side-panel/src/components/MarkElementDialog.tsx` | SidePanel 顶栏 `FiTarget` 按钮触发,**与 ask_user 路径解耦**——用户主动拾取 → 填 purpose → 直接 `elementHintsStore.addHint(source='user_pick')`,无需触发任务 |
| 教导模式入口 | `pages/side-panel/src/components/TeachingDialog.tsx` + background port `get_interactive_elements`/`infer_element_purposes`/`highlight_element` | SidePanel 顶栏 `FiBookOpen` 按钮触发,**一次性批量教**——拉当前页 selectorMap → LLM 批量推测每个元素 purpose+confidence → 用户审阅/编辑/勾选/补充 → `elementHintsStore.addHints` 批量入库;编辑过 purpose 的标 `user_pick`,未改的标 `ai_inferred` |
| 聊天框 @ 引用 | `pages/side-panel/src/components/ElementRefPanel.tsx` + `RefChip.tsx` + `types/elementRef.ts` | ChatInput 工具栏 `FiAtSign` 按钮 → 弹出小面板列出当前 hostname 事实库 / 现场拾取一个新的;选中后在 textarea 光标处插入可见 `[purpose #N]` token + 上方加一个 chip。**TeachingDialog 的行 `[index]` 也可点**,落到同一引用机制。<br/>发送时 SidePanel 把 `referencedElements` 拼成 `<nano_referenced_elements>` XML 块追加到 task 字符串末尾,Agent prompts 第 14 节识别 → 直接复用 xpath,confidence 设 0.95+,**绕过把握度闸门**(用户已亲手指过) |
| 首次启动引导 | `pages/side-panel/src/components/OnboardingTour.tsx` + `generalSettings.onboardingSeen` flag | 3 步浮层介绍 @ / 教导 / 元素记忆;完成或跳过都置 `onboardingSeen=true` 永久关闭。删 flag 即可重看 |
| 空对话首屏快捷卡片 | `pages/side-panel/src/components/EmptyStateCards.tsx` | `messages.length === 0` 时挂在 `BookmarkList` 上方:🎓 教这个网站(开 TeachingDialog) / 🧠 用过的元素(跳 options?tab=memory) / 💡 试试这些任务(按 hostname 给 2-3 个示例) |
| 任务进度条 + 跳过/修改 | `pages/side-panel/src/components/TaskProgressBar.tsx` + 新 port `skip_step` / `amend_next_step` + `AmendNextStepDialog.tsx` | 进度数据复用 EventData.step/maxSteps(原本前端没用);跳过 = `context.skipRequested=true` 在 step 边界消费(不打断 LLM 调用,nSteps++ 防死循环);修改下一步 = pause + 弹 textarea + 提交后 `messageManager.addMessageWithTokens([User mid-task instruction] ...)` + resume |
| 失败 LLM 诊断 | `chrome-extension/src/background/agent/diagnose.ts` + 新 `ExecutionState.TASK_FAIL_DIAGNOSIS` + `FailDiagnosisDialog.tsx` | executor 在 emit TASK_FAIL 之前 await diagnoseTaskFailure(超时 15s):用 navigator LLM 看任务+最近 5 步 history+错误,生成 summary + 3 条建议(严格 JSON 输出),emit 第二个事件;SidePanel 收到挂诊断弹窗,「重试」按钮调 new_task 重发原 task。诊断失败/超时则不发该事件,fallback 到老的 TASK_FAIL 单事件流程 |
| Picker 通用 hook | `pages/side-panel/src/hooks/useElementPicker.ts` + `components/PickerCard.tsx` | 三个弹窗(Clarify/Mark/Teaching)共用的元素拾取状态机和卡片 UI |
| 页面高亮 overlay | `pages/side-panel/public/highlightOverlayInject.js` | TeachingDialog 列表里"在页面上看"按钮 → background 用 `chrome.scripting.executeScript` 注入 → 在目标元素位置画 2 秒红色脉冲框 |

**闭环示意:**

```
LLM 输出 element_confidence + element_purpose
    │
    ▼
navigator.maybeGateOnLowConfidence (阈值 0.7)
    ├─ ≥0.7 → 放行 doMultiAction
    └─ <0.7 → emit ASK_USER (allow_element_pick=true)
              → context.pause()
              → await waitForClarification(requestId)
                 ↑
                 │ SidePanel ClarifyDialog → port 'clarify_response'
                 │   ├─ choiceId / text
                 │   ├─ pickedSelector/pickedXpath (来自 picker overlay)
                 │   └─ cancelled / abortTask
              → context.resume()
              → resp 暂存到 context.pendingPickedHints
              → 下一轮 Navigator 看到 [User clarification] 摘要 + 已知元素段
              → 决策执行 click/input/select 成功
                 → persistHintOnSuccess → elementHintsStore.addHint (source='user_pick')
              → 下次访问同 hostname → prompts/base.ts 自动拼 [Known elements on xxx]
                 → LLM confidence ≥ 0.9,不再触发闸门
```

**仅用户拾取后真的成功执行的元素才入库**(`pendingPickedHints` → `persistHintOnSuccess`),避免错拾取污染事实库。AI 自主选择并成功的元素也会以 `source='ai_success'` 入库,但 UI 上明确区分。

### 4.5 流式推理事件

Planner 在决策前会先用一次轻量调用流出"自然语言推理"给用户看(`Actors.PLANNER` + `ExecutionState.STREAM_DELTA` / `STREAM_END`),由 SidePanel 的 `MessageList` 实时追加。失败不阻塞主决策流程。

---

## 5. 浏览器抽象层(`background/browser/`)

### 5.1 BrowserContext

单例,负责:
- 维护所有"被自动化关注的 tab"
- 提供 `getCurrentPage()` / `openTab(url)` / `switchTab(tabId)`
- 拦截导航/关闭事件,同步内部状态

### 5.2 Page 封装

每个被关注的 tab 对应一个 `Page` 实例,封装:
- DOM 查询(`dom/` 服务)
- 元素可视性 / 可交互判定
- 点击 / 输入 / 滚动 / 等待
- 选择器策略(CSS + XPath + 多 fallback)
- 截屏 / 拿 cookies / 元素属性读取

### 5.3 与 Recorder 的关系

录制时,内容脚本在目标 tab 上注入采集器,把用户的 click/input/scroll/navigate 转成 `RecordedAction` 发回 background;background 通过 `BrowserContext` 维护"哪些 tab 在录"。

---

## 6. 工作流系统(`packages/workflow/` + `background/services/workflow/`)

### 6.1 数据模型(`packages/workflow/lib/types/`)

```ts
Workflow {
  id, name, description, version,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  variables: WorkflowVariable[],
  executionConfig: { onError: 'stop' | 'continue' | 'retry' },
}

WorkflowNode {
  id, type, name, position, data,
}

WorkflowNodeType =
  | 'start' | 'end'        // 框架节点
  | 'ai'                   // LLM 调用,可写变量(${name} 模板)
  | 'automation'           // 浏览器原子动作(click/input/scroll/...)
  | 'condition'            // AI 判定走哪个命名分支
  | 'loop'                 // continue/exit 两个端口的循环节点
  | 'output'               // 主输出收集器(side-branch)
  | 'note'                 // 画布注释,不参与执行
  | 'subflow'              // 调用另一个已存的工作流

WorkflowEdge {
  id, source, target,
  sourcePort?: string,  // condition 节点的分支 id / loop 节点的 continue|exit
}

WorkflowVariable {
  name, type, description?, required?, default?,
}
```

### 6.2 执行器(`packages/workflow/lib/core/WorkflowExecutor.ts`)

主循环语义:
1. 从 `start` 节点出发,沿主流连接遍历
2. 每个节点执行后:
   - **condition**:根据 AI 判定走 `selectedBranchId` 对应的 edge
   - **loop**:根据计数/AI 走 `continue` 或 `exit` 端口
   - **subflow**:递归 `execute()` 子工作流,变量空间隔离 + 显式映射穿透
   - 其他:取第一条非 output 出边
3. **output 节点**:作为"侧分支"被父节点附带触发,不影响主流走向
4. **隐式 loop-back**:循环体跑完末节点若无主流出边,自动回到栈顶 loop 节点(无需用户画 return 边)

执行隔离:
- `loopIterations` 是 **每次 execute() 的局部 Map**,父/子工作流各自独立计数
- `_subflowStack` 在 context 上携带,递归调用时拼接,**循环引用检测**(A→B→A 报错)
- 子流程的变量空间独立,通过 `subflowInputs` / `subflowOutputs` 显式映射

容错:
- 节点失败 + `executionConfig.onError === 'stop'` → 立即中止
- `required` 变量启动时无值 → fail-fast,清晰报错
- 循环硬上限 `ABSOLUTE_LOOP_CAP = 1000`,即使配置写更大也截断

### 6.3 模板系统

| 语法 | 含义 | 解析时机 |
|------|------|---------|
| `{{varName}}` | **读取**变量值 | `resolveTemplate()`,所有字符串参数 |
| `{{varName.field}}` | 读取对象字段(浅) | 同上 |
| `${varName}` | **写入**目标(AI prompt 专用) | `extractWriteTargets()` → 让 LLM 按 JSON 返回 |

AI 节点的 prompt 同时支持读写:Executor 检测到 `${name}` 时,**自动包装 prompt** 要求 LLM 按 `{name: ...}` JSON 返回,然后赋值到对应变量。

### 6.4 UI 编辑器(`pages/options/src/components/workflow/`)

基于 **React Flow v12** + dagre。

```
WorkflowEditor.tsx          # 总入口(顶层 Provider + 工具栏 + 画布 + 右侧面板)
├ nodes/                    # 节点组件
│  ├ index.ts                  # 主画布 nodeTypes 注册
│  ├ nodeTypes.tsx             # 嵌套预览专用(SubflowPreviewNode 等)
│  ├ AINode / AutomationNode / ConditionNode / LoopNode / ...
│  └ statusOverlay.tsx         # 状态徽章 / 运行环
├ palette/                  # 拖拽面板 + getDefaultNodeData
├ panels/
│  ├ NodeEditorPanel.tsx       # 右侧节点编辑(动态字段、token 工具栏、拾取元素按钮)
│  ├ VariablesPanel.tsx        # 变量管理(校验空名/重名/未使用标记)
│  └ ExecutionLogPanel.tsx     # 实时执行事件
├ utils/                    # conversions / layout / validation / ids
└ hooks/                    # useWorkflowExecution 等
```

#### 关键交互能力
- **拖拽建模**:左侧 palette → 画布,自动选中并打开节点编辑器
- **节点编辑器**(右侧):
  - AI / Condition prompt 检测 `${name}` 未声明 → 弹窗一键新建
  - 变量列表为空时显示用法提示
  - Automation 节点的 selector/xpath 字段支持 **📍 拾取元素**(选 tab → 页面悬停高亮 → 点击拾取)
  - 切换 action 时保留旧 parameters
- **循环节点**:`continue`(绿虚线 bezier 动画)/ `exit`(红实线 bezier) 端口,样式区分
- **子流程节点**:支持就地展开为**嵌套 React Flow**,真节点真边可视化预览(只读、可缩放/平移)
- **未保存关闭确认**:JSON 对比 last saved snapshot,有差异时弹原生 confirm
- **自动布局**:dagre `LR` / `TB`,工具栏 + 右键菜单都可触发
- **历史**:undo/redo + 复制/粘贴(以鼠标位置为基准)

### 6.5 执行 host(`background/services/workflow/`)

`WorkflowService.executeAction/invokeAI/getVariable/setVariable/loadWorkflowById` 实现 `WorkflowExecutionContext` 接口,把 `packages/workflow` 的纯库逻辑接到真实的 BrowserContext + Agent。

调用方:
- Options 页"运行"按钮 → `runtime.sendMessage({type: 'execute_workflow', ...})`
- SidePanel 通过 `/workflow <name>` 命令或 Quick Select
- Agent 也可以把 workflow 作为可调用工具(Navigator)

执行事件 (`WORKFLOW_START/_OK/_FAIL/_CANCEL` + `NODE_START/_OK/_FAIL` + `BRANCH_SELECT`) 通过 port 实时推到 UI。

---

## 7. Skill 系统(`packages/skills/` + `background/services/skills/`)

### 7.1 定位

Skill 是**给 AI(Navigator)读的可重用指令**,采用通用 Agent Skill 文本格式:
- `---` 之间是 YAML frontmatter(元信息 + 参数 schema),下方正文是自然语言指令
- 执行时正文原样注入任务,由 Navigator 按页面实际情况自行定位元素
- 可被打包成 `SkillPackage`(含 markdown + 资源文件 + manifest)
- 内置一批通用 skill(`builtin/`)

### 7.2 数据模型

```ts
Skill {
  id, name, description, version,
  category, author, tags,
  parameters: SkillParameter[],   // 入参 schema,正文里用 {{name}} 引用
  instructions: string,           // 正文(Markdown),执行时注入给 LLM —— 主体
  steps: SkillStep[],             // 兼容字段:仅录制产物与 workflow 互转使用,文本编写时为 []
  executionMode: 'expanded' | 'compact' | 'both',
  timeout?,
}

SkillStep {
  id, action, description?,
  parameters: Record<string, unknown>,   // 含 url / selector / xpath 等 locator
  condition?: { type, expression, thenSteps?, elseSteps? },
  onError?: 'continue' | 'stop' | 'retry',
  retryCount?, delay?,
}
```

`steps` 不能假设非空。录制产物里的 locator 是重要数据,读取、保存、渲染三条路径都
不会丢弃它:`userSkills` 读取时只补 `instructions`(不覆盖 steps),文本编辑保存时
保留原 steps,各渲染函数都会把 `url/selector/xpath/text` 写进正文。

渲染统一走 `packages/skills/lib/core/renderSkill.ts`:
- `renderSkillBody` —— 取 `instructions`,回退渲染 `steps`,再回退 `description`;
  替换 `{{param}}`(支持 `a.b` 嵌套),未提供的占位符会显式列出让 LLM 追问而不是静默留着
- `renderSkillForPrompt` / `renderSkillAsTask` —— 侧边栏注入 / 后台 `execute_skill` 各自的包装

### 7.3 编辑器(`pages/options/src/components/SkillSettings.tsx`)

- **只有文本编辑**:直接编辑 frontmatter + 正文。原先那套结构化 UI 表单(逐字段编
  parameters / steps)已移除 —— 同一份数据两个编辑入口会产生两个真相来源,而且 steps
  的执行路径本来就没接通
- 详情视图只读,录制的 locator 数据折叠在「录制的定位数据」里
- Skill 包(`.zip`)导入/导出,基于 JSZip;JSON 导入会为旧文件补出 `instructions`

### 7.4 与 Workflow 的转换

`packages/workflow/lib/converter/`:
- `WorkflowToSkill`:把 workflow 序列化为 skill(扁平化,丢失 DAG 表达)
- `SkillToWorkflow`(**已禁用入口**):产品决策上目前 Options 只保留 W→S,反向用户从空白构建

---

## 8. 录制系统(`background/recorder/` + `pages/content/`)

### 8.1 设计目标

**跨 Tab 录制** + 可重放为 workflow / skill。

### 8.2 模型

```ts
RecordingSession {
  id, startedAt, status,
  tabIds: number[],          // 已跟踪的 tab 集合
  activeTabId?: number,      // 当前焦点
  actions: RecordedAction[],
}

RecordedAction {
  id, ts, type,              // click/input/scroll/navigate/tab_open/tab_switch/tab_close/...
  tabId?, tabInfo?,
  selectors?, attributes?,
  value?, intent?,
}
```

### 8.3 跨 Tab 跟踪

- `chrome.tabs.onCreated`:opener tab 在 session 内 → 新 tab **自动加入**
- `chrome.tabs.onActivated`:任意 tab 切到 → 自动加入 + 合成 `tab_switch` action
- `chrome.tabs.onRemoved`:合成 `tab_close` action 后清理
- 启动时已存在的多 tab 一并接管

### 8.4 内容脚本采集(`pages/content/src/index.ts`)

- 监听 `click` / `input` / `beforeinput` / `compositionend` / `scroll` 等
- 支持 **contenteditable**(Slate/Lexical/Qwen 这类富文本)
- **用户滚动 vs 自动滚动**:`isTrusted` + 600ms 内用户输入窗口才录入
- 选择器生成:多重 fallback(id → 唯一 class 链 → attribute → role → tag+nth)
- **过滤 Tailwind JIT 类**(含 `[](){}/!@%` 的不可用作 selector)

### 8.5 重放(`ActionConverter`)

把 `RecordedAction[]` 转成 workflow 节点序列,4 级 URL 匹配兜底:
1. 精确等
2. 同 origin + 同首段路径
3. 同 origin
4. 完全前缀

---

## 9. UI 端(`pages/`)

### 9.1 SidePanel(`pages/side-panel/`)

主聊天面板。

- React + Tailwind + Lexical(输入框)
- 通过 long-lived port 接收 background 实时事件(任务执行流、录制状态)
- 核心组件:
  - `SidePanel.tsx`:总入口
  - `ChatInput.tsx`:输入(支持斜杠命令 `/skill` `/workflow` `/state` 等)
  - `MessageList.tsx`:消息流
  - `RecordingPill.tsx`:录制控制条
  - `WorkflowQuickSelect` / `SkillQuickSelect`:快速选择

主题:**localStorage['nanobrowser_dark_mode']**,跨页面 `storage` 事件同步。

### 9.2 Options(`pages/options/`)

设置页,**多 tab 布局**:
- 通用 / 模型 / 图片 / MCP / Skill / Workflow / 防火墙 / 分析

工作流 tab 是重点:
- 卡片列表(grid,响应式 1/2/3 列)
- 创建 / 导入(JSON) / 转 Skill / 删除 / 运行 / 编辑
- 编辑器以 fullscreen modal 形式打开(`createPortal` 到 body,避免 `<main>` 的 backdrop-filter 困住 `position:fixed`)

主题同步 SidePanel(读 `localStorage`,跟随 storage 事件)。

### 9.3 Content(`pages/content/`)

页面侧脚本:**仅在需要时被注入**(录制启动 / 元素拾取)。
- 不常驻 — manifest 不带 `content_scripts`,完全靠 `chrome.scripting.executeScript`

---

## 10. Storage 抽象(`packages/storage/`)

基于 `chrome.storage` 的响应式封装:

```
createStorage<T>(key, defaultValue, {
  storageEnum: 'local' | 'sync' | 'session',
  liveUpdate: true,        // 跨页/跨 worker 自动同步
  serialization?,
})

returns {
  get, set, getSnapshot, subscribe,  // React 18 useSyncExternalStore 兼容
}
```

主要 store:
- `llmProviderStore`:多 provider 配置(API key、模型列表)
- `agentModelStore`:每个 agent 的默认模型选择
- `userWorkflowsStore` / `userSkillsStore`
- `firewallStore`:URL/操作白名单
- `mcpServersStore`:MCP 服务器列表
- `farmerSitesStore`:农场主模式 AI 网站清单(`packages/storage/lib/settings/farmerSites.ts`)
- `elementHintsStore`:元素事实库,按 hostname 索引(`packages/storage/lib/settings/elementHints.ts`)
  - schema:`{ buckets: { [hostname]: { hostname, hints: ElementHint[], updatedAt } } }`
  - `ElementHint { id, purpose, selector?, stableSelector?, xpath?, textContent?, source: 'user_pick' | 'ai_success' | 'ai_inferred' | 'manual', createdAt, lastUsedAt, useCount, pinned?, staleHits? }`
  - 由 Navigator/Planner 的 `ask_user` 闭环写入(见 §4.4),不允许 UI 手动添加
  - 同 selector+xpath 已存在则 `touchHint`(useCount + 1),不重复
  - **优先级**:`scoreHint` = (来源权重 + min(useCount,10)×5) × 0.5^(闲置天数/14)。
    注入名额只有 `MAX_KNOWN_ELEMENTS`(8) 条,而 prompt 写的是「优先用它的 selector 不要另猜」,
    所以选谁进去很关键。只按 useCount 排会让半年前点过 20 次的旧 selector 永久占位,
    而用户昨天刚教的那条(useCount=1)挤不进来
  - **过期**:按来源给不同 TTL,从 `lastUsedAt` 起算(user_pick/manual 90 天、ai_success 30 天、
    ai_inferred 14 天)—— 一直在用的不会过期,只淘汰「存进来后再没派上用场」的。
    另有独立判据:连续 `MAX_STALE_HITS`(3) 次定位失败即判过期(站点改版的典型表现,
    此时 TTL 还远没到,靠计数才能及时把坏数据挤出注入名额)。`markHintStale` 由
    `builder.ts` 三个元素动作的 locator 解析失败分支调用
  - **置顶**(`pinned`):跳过评分直接进名额且永不过期。自动评分总有判错的时候 ——
    某站点关键入口一个月才用一次,分数天然低,给个手动兜底比反复调参可靠
  - **容量**:单 hostname 上限 `MAX_HINTS_PER_HOSTNAME`(60),超出按分数从低到高淘汰
  - 过期项在**读取时过滤**(不改数据,TTL 常量以后调大还能回来),在**写入时真正删除**;
    管理 UI 的「清理过期」按钮走 `pruneExpired` 手动触发
  - `getByHostname` 已完成过滤 + 排序,三个读取方(prompt 注入、`@` 引用面板、闸门记忆查询)
    都直接用,不再各自重排 —— 否则用户在面板里看到的第一条未必是真正注入的那条
- 各类 `chatStore` / `promptStore` / `favoritesStore`

---

## 11. MCP 客户端(`packages/mcp-client/`)

实现 [Model Context Protocol](https://modelcontextprotocol.io) 的客户端:
- 多 server 并行连接(WebSocket / stdio bridge)
- 工具发现 → 注入 Navigator 的可调用工具列表
- 资源订阅 / Prompt 模板
- `services/mcp/` 负责声明周期管理 + 后台 health-check

---

## 12. LLM Provider 抽象

LangChain.js 之上的薄封装:
- 统一 chat-completion 接口
- 支持 OpenAI / Anthropic / Gemini / Ollama / Azure / 自定义 OpenAI 兼容端点
- **Light invoker**(`invokeAILight`):跳过完整 Agent 上下文,用于纯文本任务(condition 判定、loop AI 判定、轻量摘要)
- 多 agent 可分别配模型(Planner 用强模型 / Navigator 用快模型)

---

## 13. 国际化(`packages/i18n/`)

Chrome i18n 协议 + 自研生成器:
- 源:`locales/<lang>.json`(带 placeholders 定义)
- 生成器(`generate-i18n.mjs`)产出 `lib/`:TypeScript 类型化 `t()` + Chrome 兼容 `_locales/`
- 命名约定参考 `CLAUDE.md`(`component_category_action_state`)

---

## 14. 构建 / 调试

### 主要命令(根目录)

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 全量开发模式(watch + HMR) |
| `pnpm build` | 生产构建 → `dist/` |
| `pnpm zip` | 打包 → `dist-zip/` |
| `pnpm e2e` | 端到端测试(build + zip + 测试) |
| `pnpm type-check` | TS 类型检查 |
| `pnpm lint` / `prettier` | 代码风格 |

### Workspace 级(更快)

```sh
pnpm -F chrome-extension build      # 仅构建后台
pnpm -F @extension/options build    # 仅构建 Options 页
pnpm -F @extension/sidepanel build  # 仅构建 SidePanel
pnpm -F @extension/workflow ready   # 构建 workflow 纯库(node build.mjs)
pnpm -F @extension/workflow type-check
pnpm -F chrome-extension test       # Vitest 单测
```

### 单元测试

- 框架:**Vitest**
- 位置:`chrome-extension/src/**/__tests__/*.test.ts`
- 偏向纯逻辑(选择器生成、URL 匹配、模板解析等),不模拟 Chrome 全栈

---

## 15. 关键设计权衡记录

### 15.1 工作流为何用 React Flow v12 而非自研

- React Flow 提供完善的拖拽/缩放/选区/连线交互
- v12 的 `useReactFlow().updateNodeData(id, ...)` 让"节点内部就地编辑"(如备注双击 / 子流程展开切换)无需经过外层 state
- 支持嵌套 `ReactFlowProvider`,使得**子流程节点就地展开成完整子图**这种特性可实现

### 15.2 循环节点为何用方案 A(loop-back edge)而非容器

- 容器(group node)在 React Flow v12 里支持,但**边界识别复杂**(谁在容器内?跨容器边怎么算?)
- Loop-back edge 方案:loop 节点只有 `continue` / `exit` 两个端口,循环体内部用普通边,**末节点的"无下一节点"由执行器栈隐式回环**
- 代价:用户得自己摆好"循环范围",但相比容器模型实现复杂度低 90%

### 15.3 子流程为何不递归展开

- 嵌套展开 = 每层一个 `ReactFlow` 实例,N 层会有 N^2 个节点组件
- 设计上:**最多 1 层展开**,子流程里的 subflow 节点用轻量 `SubflowPreviewNode` 占位(纯卡片,不挂 ReactFlow)
- 避免:循环引用导致无限渲染、性能炸裂

### 15.4 录制为何不依赖常驻 content script

- Manifest V3 中 `content_scripts` 常驻会导致每个 tab 都注入,对非自动化场景是浪费
- 录制启动时按需 `chrome.scripting.executeScript` 注入采集器,关闭时自然失效
- 同样,**元素拾取**也是按需注入的浮层

### 15.5 主题为何用 localStorage 而非 chrome.storage

- 跨页面同步通过 `window.storage` 事件即时触发,无延迟
- chrome.storage 异步 + 跨 worker 序列化,UI 端"切完主题等 200ms 才生效"体验差
- 主题状态丢失无关紧要,localStorage 足够

### 15.6 工作流的变量空间为何子流程隔离

- 子工作流是**可复用单元**,不应假设父空间存在某变量
- 显式 `subflowInputs` / `subflowOutputs` 映射 = 明确的接口契约
- 默认隔离 + 显式穿透,Skill 系统的参数 schema 思路一致

### 15.7 为何把握度评估是「闸门」而非「提示词劝说」

**问题**:让 Agent 在不确定时问用户,而不是猜。

**两种方案权衡**:

| 方案 | 实现 | 问题 |
|---|---|---|
| 软推动:prompt 里加"不确定时调用 ask_user" | 改 navigator 提示词,LLM 自己决定何时问 | 模型有"完成任务"的训练偏好,会倾向硬猜而不是问;阈值不可控 |
| **硬闸门**(选用) | LLM 必须在 `current_state` 输出 `element_confidence` 分数,executor 在执行前根据 0.7 阈值**强制拦截**元素动作 | LLM 仍可虚报高分,但**门槛在系统侧而非模型侧**,行为可预测 |

**为何不做"二步确认"**(所有元素动作前都问):
- 太烦扰,会严重拖慢任务,与"自动化"目标矛盾
- 大多数元素操作是没歧义的(页面只有一个登录按钮),没必要问

**事实库的位置**:闸门拦截 → 用户拾取 → 落库后下次访问同 hostname 自动注入到 state message → LLM 直接复用,confidence 自然提到 0.9+ → 不再触发闸门。**形成正反馈,每次拾取换永久免问。**

---

## 16. 安全与隐私

参考 `CLAUDE.md` 的安全部分,关键点:
- API key 等密钥只存 `chrome.storage.local`,不进 sync
- 防火墙(`firewallStore`)拦截 URL/动作,默认安装时启用
- 录制不存 password 类输入(类型识别 + 黑名单)
- LLM 调用走 provider 直连,不经任何 Nanobrowser 中间服务器
- MCP 服务器为用户自配,不内置

---

## 17. 文档维护规则

> ✅ 修改本文档的触发条件

凡涉及以下变更必须同步更新本文档对应章节:
1. **新增 workspace / 包** → 更新「2. 仓库结构」
2. **新增 / 删除 / 重命名 节点类型** → 更新「6.1 数据模型」「6.4 关键交互能力」
3. **执行器主循环语义改动**(condition/loop/subflow/output 处理) → 更新「6.2 执行器」
4. **新增 Agent 角色 / 改变协作循环** → 更新「4. 多 Agent 系统」
5. **新增主要 storage key / 数据模型** → 更新「10. Storage 抽象」
6. **新增 background message 类型** → 更新「3. 进程模型」的通信约定
7. **构建命令 / 工作流变化** → 更新「14. 构建 / 调试」
8. **关键设计权衡新增** → 追加「15. 关键设计权衡记录」

> ❌ 不需要更新的情况

- 单纯 bugfix / 内部重构未改对外接口
- CSS / 文案 / i18n 仅文本
- 不影响架构的依赖升级

---

**最后更新人**:代码助手(基于 commit / 工作区当前状态自动生成)
**最后更新日期**:2026-06-29(教导模式)
