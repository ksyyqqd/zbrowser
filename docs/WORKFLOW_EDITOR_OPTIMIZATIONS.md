# 工作流编辑器优化跟踪

> 路径：`pages/options/src/components/WorkflowEditor.tsx`
> 引擎：React Flow (`@xyflow/react`) + dagre 布局
> 最后更新：2026-06-16

本文档跟踪工作流编辑器从 AntV X6 迁移到 React Flow 之后的所有优化工作 — 已完成项 + 待做项。

---

## ✅ 已完成项

### M0 引擎迁移 — AntV X6 → React Flow（基线）

**完成时间**：2026-06-16
**关联文件**：
- `pages/options/package.json`（依赖替换）
- `pages/options/src/components/WorkflowEditor.tsx`（完全重写）

**变更摘要**：
- 移除依赖：`@antv/x6`、`@antv/x6-react-shape`、`@antv/x6-plugin-dnd`、`@antv/layout`、`@antv/graphlib`
- 新增依赖：`@xyflow/react@12.11.0`、`dagre@0.8.5`、`@types/dagre`、`nanoid`
- 5 个自定义节点（AI/Automation/Condition/Start/End）通过 `<Handle>` API 实现
- 条件节点支持动态多分支 Handle（按 `data.branches` 自动渲染）
- 拖放采用 HTML5 原生 `dataTransfer`（替代 X6 dnd 插件）
- 自动布局采用 `dagre`（替代 `AntVDagreLayout`）
- 暗黑模式通过 React Flow 的 `colorMode` prop 切换
- 用 `ReactFlowProvider` 包裹以启用 `useReactFlow` hook
- 数据契约（`packages/workflow/lib/types/workflow.ts`）保持不变 → 存储数据无需迁移

---

### P0-1 保存前结构校验

**完成时间**：2026-06-16
**关联文件**：
- `pages/options/src/components/WorkflowEditor.tsx`：`handleSave` + 错误横幅 UI
- `packages/workflow/lib/parser/WorkflowParser.ts`：修复 `validateWorkflowStructure` 兼容新版 `branches` 格式

**变更摘要**：
- 调用 `validateWorkflowStructure(workflow)` 在保存前校验
- 校验失败时画布顶部显示红色错误横幅，列出所有问题（缺少 start/end、孤立节点、condition 分支无出边、start→end 不可达等），可一键关闭
- 修复 `validateWorkflowStructure` 适配新版 `branches + sourcePort` 格式（不再误报缺少 `trueNodeId`/`falseNodeId`）

---

### P0-2 MiniMap 小地图

**完成时间**：2026-06-16
**关联文件**：`pages/options/src/components/WorkflowEditor.tsx`

**变更摘要**：
- 添加 `<MiniMap pannable zoomable />` 组件
- 节点按类型着色：AI=紫、Automation=蓝、Condition=橙、Start=绿、End=红
- 工作流大时方便用户快速定位

---

### P0-3 键盘快捷键

**完成时间**：2026-06-16
**关联文件**：`pages/options/src/components/WorkflowEditor.tsx`

**支持快捷键**：

| 快捷键 | 功能 |
|--------|------|
| `Delete` / `Backspace` | 删除选中节点/边（React Flow 内置） |
| `Ctrl+S` / `⌘+S` | 保存工作流（含校验） |
| `Esc` | 取消所有选择 |

---

### P0-4 节点 ID 用 nanoid

**完成时间**：2026-06-16
**关联文件**：`pages/options/src/components/WorkflowEditor.tsx`

**变更摘要**：
- 所有 `Date.now()` 生成的 ID 替换为 `nanoid()`
- 杜绝快速操作时同毫秒 ID 冲突
- workflowId 用 `nanoid(10)`，nodeId/edgeId 用 `nanoid(8)`，branchId 用 `nanoid(6)`
- `createdAt`/`updatedAt` 时间戳保持 `Date.now()` 不变（合法用途）

---

### P1-7 连接验证 isValidConnection

**完成时间**：2026-06-16
**关联文件**：`pages/options/src/components/WorkflowEditor.tsx`

**变更摘要**：
- 在 `<ReactFlow>` 上添加 `isValidConnection` 回调
- 禁止规则：
  - 自环连接（source === target）
  - `end` 节点作为 source（end 无出边）
  - `start` 节点作为 target（start 无入边）
  - 同一 source handle 重复连线（除 condition 多分支外，每个 handle 仅一条出边）
- 用户拖线时无效目标会自动置灰，无法松手成功

---

### P1-8 节点复制 Ctrl+D

**完成时间**：2026-06-16
**关联文件**：`pages/options/src/components/WorkflowEditor.tsx`

**变更摘要**：
- 选中节点后按 `Ctrl+D` / `⌘+D` 原位复制（偏移 +40, +40）
- 工具栏新增"复制"按钮（FiCopy 图标），可点击触发
- 复制行为对 `start` / `end` 节点禁用（这些是单例节点）
- 复制后的节点自动选中，可立即继续编辑

---

### P1-5 Undo/Redo 撤销重做

**完成时间**：2026-06-16
**关联文件**：`pages/options/src/components/WorkflowEditor.tsx`

**变更摘要**：
- 自实现 history 栈（无外部依赖），保留最近 50 个快照
- 监听 `nodes`/`edges` 变化自动入栈，并通过 `isApplyingHistoryRef` 标志防止 undo/redo 自身触发新快照
- 工具栏新增 Undo / Redo 按钮（FiCornerUpLeft / FiCornerUpRight 图标）

**支持快捷键**：

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Z` / `⌘+Z` | 撤销 |
| `Ctrl+Shift+Z` / `⌘+Shift+Z` | 重做 |
| `Ctrl+Y` / `⌘+Y` | 重做（备用） |

---

### P1-9 文件拆分（模块化目录结构）

**完成时间**：2026-06-16
**关联文件**：
- `pages/options/src/components/WorkflowEditor.tsx`（精简为 7 行 re-export）
- `pages/options/src/components/workflow/`（新增模块化目录）

**变更摘要**：
- 把原 1467 行的单文件 `WorkflowEditor.tsx` 拆为模块化目录结构
- 外部调用方（`WorkflowSettings.tsx`）无感知 — 原路径仍可 `import WorkflowEditor from './WorkflowEditor'`
- 拆分后每个文件单一职责，最大 407 行（主编辑器逻辑）

**新目录结构**：
```
pages/options/src/components/
├── WorkflowEditor.tsx          # 7 行 re-export，保持原导入路径
└── workflow/
    ├── index.ts                # 默认导出聚合
    ├── types.ts                # FlowNode / FlowEdge / WorkflowEditorProps
    ├── WorkflowEditor.tsx      # 主编辑器逻辑（407 行）
    ├── nodes/
    │   ├── AINode.tsx
    │   ├── AutomationNode.tsx
    │   ├── ConditionNode.tsx
    │   ├── StartNode.tsx
    │   ├── EndNode.tsx
    │   ├── handleStyle.ts      # 共享 Handle 样式
    │   └── index.ts            # 导出 nodeTypes 映射
    ├── panels/
    │   └── NodeEditorPanel.tsx # 右侧节点编辑面板（240 行）
    ├── palette/
    │   └── index.tsx           # 左侧节点面板 + PaletteCard + 默认数据
    └── utils/
        ├── ids.ts              # nanoid wrappers
        ├── conversions.ts      # toFlowNode / toWorkflowNode
        ├── layout.ts           # dagre 自动布局
        ├── validation.ts       # isValidConnectionFor
        └── index.ts
```

**收益**：
- 单文件不再超 500 行，便于 code review
- 节点组件可独立测试（未来加 unit test 时更容易）
- 工具函数可被其他工作流相关组件复用
- ESLint 警告大幅减少（之前 tailwind 类名顺序的大批量警告随子文件拆分自然降低）

---

### P2-1 执行可视化

**完成时间**：2026-06-16
**关联文件**：
- `chrome-extension/src/background/index.ts`（事件双向广播）
- `pages/options/src/hooks/useWorkflowExecution.ts`（新增）
- `pages/options/src/components/workflow/types.ts`（新增 NodeStatus / ExecutionState 类型）
- `pages/options/src/components/workflow/WorkflowEditor.tsx`（接收 executionState，派生 nodesWithStatus）
- `pages/options/src/components/workflow/nodes/statusOverlay.tsx`（新增视觉 helper）
- `pages/options/src/components/workflow/nodes/{AI,Automation,Condition,Start,End}Node.tsx`（应用状态）
- `pages/options/src/components/WorkflowSettings.tsx`（接入 hook 与 reset）

**变更摘要**：
- Background 新增 `optionsPorts: Set<chrome.runtime.Port>` + `'options-connection'` 端口分支
- `workflowEventEmitter` 同时向 side-panel 和所有 Options 页广播 `workflow_event`
- Options 页 `useWorkflowExecution` hook 建立长连接，把 `WorkflowEvent` 流归约为 `ExecutionState`
- 5 个节点组件读取 `data._executionStatus` 渲染 ring + 角标，运行时实时高亮
- 执行按钮（▶）调用 `resetExecution()` 后再 sendMessage，清空旧状态

**视觉规范**：

| 状态 | 视觉效果 |
|------|---------|
| `idle` | 现有样式 |
| `running` | 蓝色 ring + animate-pulse + 旋转 spinner 角标 |
| `ok` | 绿色 ring + ✓ 角标 |
| `fail` | 红色 ring + ✗ 角标 |

**事件 → 状态映射**：
- `WORKFLOW_START` → `status='running'`，清空 nodeStatus
- `NODE_START` → 该 nodeId='running'，currentNodeId=该 id
- `NODE_OK` → 该 nodeId='ok'
- `NODE_FAIL` → 该 nodeId='fail'
- `WORKFLOW_OK` / `WORKFLOW_FAIL` → 更新 status，currentNodeId=null

---

## 🟠 待做项

### P3-1 变量系统增强 ⏱️ 1-2 天 ⭐⭐⭐⭐

**痛点**：`variables` 字段已定义但 UI 完全没有变量管理面板，节点之间数据流转靠 `outputVariable` 散落配置。

**方案**：
- 新增"变量"侧边栏 Tab：定义全局变量（name/type/default/description）
- AI/Automation 节点 prompt/参数支持 `{{variableName}}` 模板，输入框旁有变量选择下拉
- 可视化展示变量流（哪节点产生、哪节点消费）
- 执行时 `WorkflowExecutor` 已支持 `setVariable`/`getVariable`，仅需 UI 配套

---

### P3-2 并行 / 循环节点 ⏱️ 2-3 天

扩展 `WorkflowNodeType`：
- `parallel` — 多输出端口同时执行（fork-join 语义）
- `loop` — 循环节点，配 `break` 条件 + 列表迭代

需要重写 `WorkflowExecutor` 的执行算法（从 while 串行 → 异步树/递归）。

---

### P3-3 节点级错误处理 ⏱️ 3-4h

当前只有全局 `executionConfig.onError`。`NodeData` 类型已预留 `retryCount`、`onError`、`fallbackNodeId` 字段，UI 未暴露。

**方案**：在 `NodeEditorPanel` 加"高级"折叠区，配置每个节点：
- 重试次数
- 失败行为（停止 / 跳过 / 走 fallback 节点）
- 超时时间

---

## 推荐执行顺序

```
✅ M0 引擎迁移
✅ P0-1 ~ P0-4（保存校验、MiniMap、快捷键、nanoid）
✅ P1-5 ~ P1-8（Undo/Redo、连接验证、复制粘贴）
✅ P1-9 文件拆分
✅ P2-1 执行可视化
✅ P2-2 React.memo 优化
✅ P2-3 代码分割 / Bundle 优化（首屏 -46%）
       ↓
P3 大改造（按业务需求决定是否做）
```

---

## 验证基线

每次优化完成后必跑：

```bash
# 类型检查
pnpm -F @extension/options type-check

# 构建
pnpm -F @extension/options build

# Lint
cd pages/options && npx eslint src/components/WorkflowEditor.tsx --quiet
```

要点：
- 0 错误（warning 可接受 tailwind class order）
- Bundle 体积关注 — 见 P2-3
- 加载 `dist/` 到 Chrome 进行人工功能验证
