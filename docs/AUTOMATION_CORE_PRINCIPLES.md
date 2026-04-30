# Nanobrowser 自动化核心原理

## 一、元素定位机制：交互元素树 + 数字索引

**核心流程**：
```
页面 DOM → buildDomTree.js 注入 → 过滤可交互元素 → 分配唯一索引 → 返回简化元素树
```

**buildDomTree.js 工作原理**：

1. **遍历页面 DOM**，对每个元素判断是否"可交互"：
   - 可交互类型：`button`, `input`, `a`, `select`, `textarea`, `[onclick]`, `[role="button"]`, `[tabindex]`, `contenteditable`
   - 过滤不可见元素（通过 `getBoundingClientRect()` 判断）

2. **为每个可交互元素分配唯一索引** (`highlightIndex`)：
   ```
   [5]<button>提交</button>
   [10]<input type="text" placeholder="搜索" />
   [15]<a href="/home">首页</a>
   ```

3. **生成简化元素树**，包含：
   - `elementTree`：嵌套的 DOM 树结构（反映元素层级关系）
   - `selectorMap`：`Map<highlightIndex → 元素信息>`（用于快速定位）

4. **页面注入高亮框**（可选显示），每个元素边框角落标注数字索引

---

## 二、AI 规划决策：多信息源融合

Navigator Agent 根据以下信息源进行任务规划和动作生成：

| 信息源 | 获取方式 | 内容 | AI 使用场景 |
|--------|----------|------|-------------|
| **交互元素树** | 每步自动获取 | 带索引的简化元素列表 | 定位点击/输入元素的主要依据 |
| **完整 HTML** | `get_full_html` 动作主动调用 | 指定元素的完整 HTML（含属性、嵌套结构） | 当简化列表无法定位时，深入分析元素 |
| **屏幕截图** | 视觉模式开启时自动获取 | JPEG 格式页面截图（已隐藏遮罩） | 理解页面布局、视觉状态、验证操作结果 |

**AI 决策流程**：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Navigator Agent 决策                          │
├─────────────────────────────────────────────────────────────────┤
│  输入：                                                          │
│  - 交互元素树（必选）：[index]<type>描述</type>                   │
│  - 屏幕截图（可选）：视觉分析页面状态                              │
│  - 任务历史：已完成步骤 + Planner 指导                            │
├─────────────────────────────────────────────────────────────────┤
│  规划判断：                                                       │
│  1. 目标元素是否在交互元素树中？                                   │
│     → 有：直接使用 index 执行动作                                 │
│     → 无：调用 get_full_html 获取完整 HTML 分析                   │
│  2. 是否需要视觉确认？                                            │
│     → 开启视觉时，截图会自动包含，AI 可参考布局                    │
├─────────────────────────────────────────────────────────────────┤
│  输出：                                                          │
│  {"action": [{"click_element": {"index": 5, "intent": "..."}}]}  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、get_full_html：AI 主动调用的深度分析机制

**触发条件**（Navigator 系统提示中明确规定）：

- 简化元素列表中找不到目标元素索引
- 需要查看元素的 `data-*`, `name`, `id` 等关键属性
- 需要理解复杂的 DOM 嵌套结构
- 元素可能被 CSS 隐藏或需要触发才能显示

**使用流程**：

```
场景：需要点击"购买按钮"，但交互元素树只显示 [1]<div>商品卡片</div>

1. Navigator 判断：目标元素不在简化列表中
2. 调用动作：{"get_full_html": {"index": 1, "max_length": 8000}}
3. 返回完整 HTML：<div class="card">...<button class="buy-btn" data-action="purchase">购买</button>...</div>
4. Navigator 分析发现按钮在容器内部，索引为子元素
5. 重新获取状态，此时按钮可能已有独立索引，或通过 XPath 定位
```

---

## 四、视觉能力：截图增强理解

**截图时机**：
- `useVision=true` 时，每步自动截图并附带给 AI

**截图处理**：
- 截图前自动隐藏 AI 遮罩层、高亮框（获取纯净页面）
- 视觉模型分析时识别数字标记元素：`Element [5]: 搜索按钮`

**AI 使用截图的场景**：
- 理解页面整体布局和视觉状态
- 验证操作是否成功（如检查弹窗是否出现）
- 识别视觉元素（图标、颜色、状态指示）

---

## 五、完整执行链路

```
用户任务: "在淘宝搜索 iPhone 15"
    ↓
[Step 1] 获取页面状态
    ├─ 交互元素树：[1]<input placeholder="搜索">, [5]<button>搜索</button>
    ├─ 截图（可选）：页面布局分析
    ↓
[Navigator 分析]
    ├─ 目标元素：搜索框(index=1)、搜索按钮(index=5) ✓ 在列表中
    ├─ 无需调用 get_full_html
    ↓
[生成动作]
    {"action": [
      {"input_text": {"index": 1, "text": "iPhone 15"}},
      {"click_element": {"index": 5}}
    ]}
    ↓
[执行动作] → Puppeteer CDP → 真实浏览器操作
    ↓
[Step 2] 页面变化，重新获取状态...
```

---

## 六、核心设计理念

| 特性 | 实现方式 | 目的 |
|------|----------|------|
| **简化先行** | 交互元素树作为首选信息源 | 减少 token 消耗，快速定位 |
| **按需深入** | AI 自主判断调用 `get_full_html` | 避免不必要的全量分析 |
| **视觉辅助** | 截图作为可选增强 | 提升复杂场景理解能力 |
| **数字索引** | 唯一标识每个可交互元素 | 简化动作参数，避免 XPath 复杂性 |

---

## 七、关键代码位置

| 功能模块 | 文件路径 | 说明 |
|----------|----------|------|
| DOM 解析注入 | `chrome-extension/public/buildDomTree.js` | 页面内运行的元素树构建脚本 |
| DOM 服务层 | `chrome-extension/src/background/browser/dom/service.ts` | 调用注入脚本，处理返回结果 |
| DOM 数据结构 | `chrome-extension/src/background/browser/dom/views.ts` | DOMElementNode、DOMState 定义 |
| Navigator Agent | `chrome-extension/src/background/agent/agents/navigator.ts` | 动作生成与执行决策 |
| Navigator 提示模板 | `chrome-extension/src/background/agent/prompts/templates/navigator.ts` | 系统提示（含 get_full_html 使用规则） |
| 动作定义 | `chrome-extension/src/background/agent/actions/schemas.ts` | 所有可用动作的 Schema |
| 动作执行器 | `chrome-extension/src/background/agent/actions/builder.ts` | 动作到浏览器操作的实际执行 |
| 页面操作 | `chrome-extension/src/background/browser/page.ts` | CDP/Puppeteer 封装，点击/输入/截图等 |
| 浏览器上下文 | `chrome-extension/src/background/browser/context.ts` | 标签页管理、页面连接管理 |
| Executor | `chrome-extension/src/background/agent/executor.ts` | 任务执行循环，协调 Planner + Navigator |

---

## 八、技术栈总结

```
┌─────────────────────────────────────────────────────────────────┐
│                    技术栈层次                                     │
├─────────────────────────────────────────────────────────────────┤
│  协议层     │  Chrome DevTools Protocol (CDP)                   │
│  封装层     │  Puppeteer + ExtensionTransport                   │
│  注入层     │  buildDomTree.js (Content Script)                 │
│  定位层     │  数字索引 + XPath + CSS Selector                   │
│  模拟层     │  Keyboard/Mouse Events                            │
│  智能层     │  Planner + Navigator 双 Agent                     │
│  结构层     │  JSON Schema 结构化输出                            │
└─────────────────────────────────────────────────────────────────┘
```

**这套架构的优势**：

1. **无需外部服务器** - 全部在浏览器扩展内运行，数据不出本地
2. **真实用户行为** - 模拟鼠标键盘事件，绕过反爬检测
3. **智能规划** - 双 Agent 系统提供思考和执行分离，提高可靠性
4. **容错设计** - 多策略定位 + 多种点击方式 + 自动重试机制
5. **按需深入** - AI 自主决定是否获取完整 HTML，平衡效率与准确性