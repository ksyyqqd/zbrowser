# Nanobrowser 用户操作录制与 Skill 生成原理

## 概述

Nanobrowser 实现了一套完整的用户操作录制系统，能够将用户在网页上的操作行为记录下来，并自动转换为可复用的自动化 Skill（技能）。本文档详细阐述该系统的架构设计与实现原理。

---

## 用户操作监听核心原理

### 核心架构

用户操作监听是录制系统的"前端"，由 **Content Script** 实现。它注入到目标网页的 DOM 环境中，与页面元素直接交互，捕获用户的各类操作事件。

```
┌─────────────────────────────────────────────────────────────────┐
│                    用户操作监听核心流程                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐                                              │
│   │ 用户操作    │  (click, input, scroll, keydown...)          │
│   │   事件      │                                              │
│   └──────┬──────┘                                              │
│          │                                                      │
│          │ 事件触发 (DOM Event)                                  │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────┐                                              │
│   │ Content     │  document.addEventListener(event, handler,    │
│   │ Script      │              true) // capture mode           │
│   │ 事件监听器   │                                              │
│   └──────┬──────┘                                              │
│          │                                                      │
│          │ 事件处理                                              │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────┐                                              │
│   │ extract     │  提取元素信息：                                │
│   │ ElementInfo │  - tagName, id, className                    │
│   │             │  - name, type, placeholder                   │
│   │             │  - aria-label, data-testid                   │
│   │             │  - href, textContent, xpath                  │
│   └──────┬──────┘                                              │
│          │                                                      │
│          │ 构建 RecordedAction                                  │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────┐                                              │
│   │ sendAction  │  chrome.runtime.sendMessage({                │
│   │ ToBackground│    type: 'recorded_action',                  │
│   │             │    action: { id, type, timestamp, ... }      │
│   │             │  })                                          │
│   └──────┬──────┘                                              │
│          │                                                      │
│          │ Chrome Extension Messaging API                       │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────┐                                              │
│   │ Background  │  recorderState.addAction(action)             │
│   │ Service     │                                              │
│   │ Worker      │                                              │
│   └─────────────┘                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 核心原理一：事件捕获模式（Capture Phase）

#### 为什么使用 Capture Mode？

DOM 事件传播有三个阶段：

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOM 事件传播三阶段                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Capture Phase (捕获阶段 - 从外到内)                          │
│     document ─────────────────────────────────────▶ element     │
│                    ↓                                              │
│                    │ (录制监听器在这里捕获！)                     │
│                    ↓                                              │
│                                                                 │
│  2. Target Phase (目标阶段 - 到达目标元素)                        │
│                    element                                       │
│                    ↓                                              │
│                                                                 │
│  3. Bubble Phase (冒泡阶段 - 从内到外)                            │
│     element ─────────────────────────────────────▶ document     │
│                    ↑                                              │
│                    │ (页面其他处理程序在这里)                     │
│                    ↑                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**关键优势**：

| 特性 | Capture Mode | Bubble Mode |
|-----|-------------|-------------|
| **执行时机** | 最先执行 | 最后执行 |
| **可靠性** | 不受 `stopPropagation()` 影响 | 可能被中间处理程序阻止 |
| **适用场景** | 监控/录制类应用 | 响应类应用 |

#### 核心代码：注册事件监听器

```typescript
// 位置: pages/content/src/index.ts

// 录制状态变量
let isRecording = false;        // 是否正在录制
let sessionId: string | null; null; // 会话 ID

/**
 * 开始录制 - 注册所有事件监听器
 */
function startRecording(id: string) {
  isRecording = true;
  sessionId = id;

  // 核心：使用 capture mode (第三个参数为 true)
  // 确保在页面其他处理程序之前捕获事件
  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('scroll', handleScroll, true);
  document.addEventListener('change', handleSelect, true);
  document.addEventListener('copy', handleCopy, true);
  document.addEventListener('paste', handlePaste, true);
  document.addEventListener('cut', handleCut, true);

  // 记录初始页面导航
  sendActionToBackground('navigate', {
    navigateInfo: {
      url: window.location.href,
      title: document.title,
    },
  });

  console.log('Recording started, session:', sessionId);
}

/**
 * 停止录制 - 移除所有事件监听器
 */
function stopRecording() {
  isRecording = false;
  sessionId = null;

  // 移除事件监听器
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('scroll', handleScroll, true);
  document.removeEventListener('change', handleSelect, true);
  document.removeEventListener('copy', handleCopy, true);
  document.removeEventListener('paste', handlePaste, true);
  document.removeEventListener('cut', handleCut, true);

  console.log('Recording stopped');
}
```

### 核心原理二：事件处理策略

#### 事件处理的核心设计

不同类型的事件需要不同的处理策略：

| 事件类型 | 处理策略 | 核心代码 |
|---------|---------|---------|
| `click` | 直接捕获，提取元素信息 | `handleClick()` |
| `input` | Debounce 500ms，记录最终值 | `handleInput()` + 定时器 |
| `scroll` | Throttle 100ms，计算百分比 | `handleScroll()` + 时间检查 |
| `keydown` | 只捕获特殊键（Enter/Tab等） | `handleKeydown()` + 白名单 |
| `change` | 下拉选择框专用 | `handleSelect()` |
| `copy/paste/cut` | 剪贴板操作 | `handleCopy/Paste/Cut()` |

#### 核心代码：Click 事件处理

```typescript
/**
 * 处理点击事件 - 最基础的事件类型
 * 核心流程：过滤 → 提取 → 发送
 */
function handleClick(event: MouseEvent) {
  // 1. 录制状态检查
  if (!isRecording) return;

  // 2. 获取目标元素
  const target = event.target as HTMLElement;
  if (!target) return;

  // 3. 过滤无效目标（避免记录空白点击）
  const tagName = target.tagName.toUpperCase();
  if (tagName === 'HTML' || tagName === 'BODY') return;

  // 4. 提取元素信息（多维度定位）
  const elementInfo = extractElementInfo(target);

  // 5. 发送到 Background
  sendActionToBackground('click', {
    element: elementInfo,
  });
}
```

#### 核心代码：Input 事件处理（带 Debounce）

```typescript
// Debounce 状态变量
let inputDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastInputValue = '';

/**
 * 处理输入事件 - 需要 Debounce 防止高频事件
 * 核心原理：等待 500ms 后才记录，确保是最终完整输入
 */
function handleInput(event: Event) {
  if (!isRecording) return;

  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target) return;

  const currentValue = target.value;

  // 核心机制：清除之前的定时器，重新开始等待
  if (inputDebounceTimer) {
    clearTimeout(inputDebounceTimer);
  }

  // 设置新的定时器：500ms 后才真正记录
  inputDebounceTimer = setTimeout(() => {
    // 只在值真正变化且不为空时记录
    if (currentValue !== lastInputValue && currentValue.length > 0) {
      const elementInfo = extractElementInfo(target);
      
      sendActionToBackground('input', {
        element: elementInfo,
        value: currentValue,  // 最终完整值
      });
      
      lastInputValue = currentValue;
    }
  }, 500); // 500ms debounce
}
```

**Debounce 原理图解**：

```
用户输入 "hello" 时的事件流：

时间轴：
t=0ms     input事件触发 "h"     → 设置定时器(500ms)
t=50ms    input事件触发 "he"    → 清除旧定时器，设置新定时器(500ms)
t=100ms   input事件触发 "hel"   → 清除旧定时器，设置新定时器(500ms)
t=150ms   input事件触发 "hell"  → 清除旧定时器，设置新定时器(500ms)
t=200ms   input事件触发 "hello" → 清除旧定时器，设置新定时器(500ms)
t=700ms   定时器到期            → 发送记录："hello"

结果：只记录一条 "hello"，而非 5 条中间状态
```

#### 核心代码：Scroll 事件处理（带 Throttle）

```typescript
// Throttle 状态变量
const THROTTLE_MS = 100;
let lastScrollTime = 0;

/**
 * 处理滚动事件 - 需要 Throttle 减少高频事件
 * 核心原理：100ms 内只记录一次
 */
function handleScroll(event: Event) {
  if (!isRecording) return;

  // Throttle 检查：距离上次记录是否超过 100ms
  const now = Date.now();
  if (now - lastScrollTime < THROTTLE_MS) return;
  lastScrollTime = now;

  // 计算滚动百分比（更有意义的指标）
  const yPercent = Math.round(
    (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
  );

  sendActionToBackground('scroll', {
    scrollInfo: {
      x: window.scrollX,
      y: window.scrollY,
      yPercent: Math.min(100, Math.max(0, yPercent || 0)),
    },
  });
}
```

#### 核心代码：Keydown 事件处理（特殊键过滤）

```typescript
/**
 * 处理按键事件 - 只捕获特殊键
 * 核心原理：普通字符键已被 input 事件覆盖，只记录有语义的特殊键
 */
function handleKeydown(event: KeyboardEvent) {
  if (!isRecording) return;

  // 白名单：只捕获这些特殊键
  const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace'];
  if (!specialKeys.includes(event.key)) return;

  // Enter 键的特殊处理：只在输入框中记录
  if (event.key === 'Enter') {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      sendActionToBackground('keydown', { keys: 'Enter' });
    }
  } else {
    sendActionToBackground('keydown', { keys: event.key });
  }
}
```

### 核心原理三：元素信息提取算法

#### 为什么需要多维度提取？

网页元素的定位存在多种不确定性：

| 问题场景 | 解决方案 |
|---------|---------|
| 动态生成的 ID | 使用 data-testid/name 等后备 |
| 类名变化 | 使用 aria-label/textContent |
| 元素无 ID | XPath 作为终极后备 |
| 按钮无属性 | 使用文本内容匹配 |

#### 核心代码：元素信息提取

```typescript
/**
 * 提取元素信息 - 多维度定位策略
 * 核心原理：收集尽可能多的定位信息，执行时依次尝试
 */
function extractElementInfo(element: HTMLElement): {
  tagName: string;
  id?: string;
  className?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  dataTestId?: string;
  href?: string;
  title?: string;
  textContent?: string;
  xpath?: string;
} {
  const info: Record<string, string | undefined> = {
    tagName: element.tagName,
  };

  // === 高优先级属性（最稳定）===
  
  // ID 选择器（最可靠）
  if (element.id) {
    info.id = element.id;
  }
  
  // data-testid（测试友好，通常稳定）
  if (element.getAttribute('data-testid')) {
    info.dataTestId = element.getAttribute('data-testid');
  }

  // === 中优先级属性（常见定位方式）===
  
  // name 属性（表单元素常用）
  if (element.getAttribute('name')) {
    info.name = element.getAttribute('name');
  }
  
  // type + placeholder 组合（输入框定位）
  if (element.getAttribute('type')) {
    info.type = element.getAttribute('type');
  }
  if (element.getAttribute('placeholder')) {
    info.placeholder = element.getAttribute('placeholder');
  }
  
  // aria-label（无障碍标签）
  if (element.getAttribute('aria-label')) {
    info.ariaLabel = element.getAttribute('aria-label');
  }

  // === 低优先级属性（可能变化）===
  
  // className（过滤动态类名）
  if (element.className && typeof element.className === 'string') {
    info.className = element.className;
  }
  
  // href（链接地址）
  if (element.getAttribute('href')) {
    info.href = element.getAttribute('href');
  }

  // === 特殊处理 ===
  
  // 按钮/链接的文本内容（用于文本匹配）
  const tagName = element.tagName.toUpperCase();
  if (tagName === 'BUTTON' || tagName === 'A' || tagName === 'SPAN') {
    const text = element.textContent?.trim();
    if (text && text.length < 100) {
      info.textContent = text;
    }
  }

  // XPath（终极后备定位方式）
  info.xpath = generateSimpleXPath(element);

  return info;
}
```

#### 核心代码：XPath 生成算法

```typescript
/**
 * 生成简单 XPath - 智能路径生成
 * 核心原理：优先使用最短路径，必要时构建完整路径
 */
function generateSimpleXPath(element: HTMLElement): string {
  // 策略1：如果元素有 id，使用最短可靠的 //*[@id="xxx"] 形式
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  // 策略2：向上遍历，找到有 id 的祖先作为起点
  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // 如果有同标签的兄弟元素，添加索引
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        c => c.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `[${index}]`;
      }
    }

    // 如果祖先有 id，停止向上遍历
    if (current.parentElement?.id) {
      parts.unshift(selector);
      return `//*[@id="${current.parentElement.id}"]/${parts.join('/')}`;
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  // 策略3：完整路径（最后的后备）
  return '/html/body/' + parts.join('/');
}
```

**XPath 生成示例**：

```typescript
// 元素有 id
element.id = "search-btn"
→ xpath: "//*[@id=\"search-btn\"]"

// 元素无 id，但祖先有
element = <button> inside <div id="container">
→ xpath: "//*[@id=\"container\"]/button"

// 无任何 id
element = <span> deep in body
→ xpath: "/html/body/div[2]/span[1]"
```

### 核心原理四：消息发送机制

#### 核心代码：构建和发送 Action

```typescript
/**
 * 发送录制的 Action 到 Background
 * 核心流程：构建 Action 对象 → Chrome Messaging API → Background
 */
function sendActionToBackground(actionType: string, data: Record<string, unknown>) {
  // 录制状态检查
  if (!isRecording || !sessionId) return;

  // 构建 Action 对象
  const action = {
    sessionId,
    action: {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: actionType,
      timestamp: Date.now(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      ...data,  // 合并事件数据
    },
  };

  // 使用 Chrome Extension Messaging API 发送
  try {
    chrome.runtime.sendMessage({
      type: 'recorded_action',
      ...action,
    });
  } catch (error) {
    // Extension context invalidated（页面刷新/扩展重载）
    console.warn('Failed to send recorded action:', error);
  }
}
```

#### Action 对象结构

```typescript
interface RecordedAction {
  id: string;              // 唯一 ID: "act-{timestamp}-{random}"
  type: string;            // 操作类型: click/input/scroll...
  timestamp: number;       // 时间戳
  pageUrl: string;         // 页面 URL
  pageTitle: string;       // 页面标题
  element?: ElementSelector;  // 元素信息（click/input）
  value?: string;          // 值（input/select）
  keys?: string;           // 按键（keydown）
  scrollInfo?: {...};      // 滚动信息
  navigateInfo?: {...};    // 导航信息
  selectionInfo?: {...};   // 选区信息（copy）
  pasteInfo?: {...};       // 粘贴信息
  cutInfo?: {...};         // 剪切信息
}
```

### 核心原理五：页面导航恢复机制

#### 问题场景

用户在录制过程中刷新页面或导航到新 URL，Content Script 会重新加载，需要恢复录制状态。

#### 核心代码：状态恢复

```typescript
/**
 * 页面加载时检查录制状态
 * 核心原理：主动询问 Background 当前是否在录制
 */
(function checkRecordingStatus() {
  try {
    chrome.runtime.sendMessage(
      { type: 'check_recording_status' },
      response => {
        if (chrome.runtime.lastError) {
          console.warn('[ContentScript] Extension context not ready');
          return;
        }
        
        // 如果正在录制，恢复录制状态
        if (response && response.isRecording && response.sessionId) {
          console.log('[ContentScript] Recovering recording session:', response.sessionId);
          startRecording(response.sessionId);
        }
      }
    );
  } catch (e) {
    // Extension context might not be ready
    console.warn('[ContentScript] Extension context not ready');
  }
})();
```

#### 恢复流程图

```
页面刷新/导航
    │
    ▼
Content Script 重新加载
    │
    ▼
执行 checkRecordingStatus()
    │
    ▼
发送 { type: 'check_recording_status' } 到 Background
    │
    ▼
Background 检查 recorderState.getActiveSession()
    │
    ├─ 无录制 → 返回 { isRecording: false }
    │
    └─ 有录制 → 返回 { isRecording: true, sessionId: "xxx" }
    │
    ▼
Content Script 收到响应
    │
    ├─ isRecording=false → 不操作
    │
    └─ isRecording=true → 执行 startRecording(sessionId)
    │
    ▼
恢复录制：
├─ 注册事件监听器
├─ 记录初始 navigate
└─ 继续捕获后续操作
```

### 核心原理六：消息监听处理

#### 核心代码：监听 Background 指令

```typescript
/**
 * 监听来自 Background 的消息
 * 核心流程：消息类型判断 → 执行相应操作 → 返回响应
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    // 检查 Content Script 是否加载
    case 'ping_content_script':
      sendResponse({ success: true, loaded: true });
      break;

    // 开始录制指令
    case 'start_recording':
      startRecording(message.sessionId);
      sendResponse({ success: true });
      break;

    // 停止录制指令
    case 'stop_recording':
      stopRecording();
      sendResponse({ success: true });
      break;

    // 查询录制状态
    case 'check_recording_status':
      sendResponse({ isRecording, sessionId });
      break;

    // Workflow 执行相关消息（进度显示）
    case 'workflow_start':
      createWorkflowOverlay();
      updateWorkflowOverlay({
        workflowName: message.workflowName,
        totalNodes: message.totalNodes,
        status: 'running',
      });
      sendResponse({ success: true });
      break;

    case 'workflow_progress':
      updateWorkflowOverlay({
        currentNodeId: message.nodeId,
        currentNodeName: message.nodeName,
        executedNodes: message.executedNodes,
        status: 'running',
      });
      sendResponse({ success: true });
      break;

    case 'workflow_complete':
      updateWorkflowOverlay({ status: 'success' });
      sendResponse({ success: true });
      break;

    case 'workflow_error':
      updateWorkflowOverlay({ status: 'error', error: message.error });
      sendResponse({ success: true });
      break;

    case 'workflow_hide':
      removeWorkflowOverlay();
      sendResponse({ success: true });
      break;

    default:
      // 未知消息类型
      break;
  }

  // 返回 false 表示非异步响应
  return false;
});

// 通知 Background Content Script 已加载
try {
  chrome.runtime.sendMessage({ type: 'content_script_loaded' });
} catch {
  // Extension context might not be ready
}
```

---

## 系统架构（完整版）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              整体架构                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────┐     Chrome Runtime.Port     ┌─────────────────────┐  │
│   │   Side Panel     │ ◄─────────────────────────► │   Background        │  │
│   │   (UI Control)   │                             │   Service Worker    │  │
│   │                  │                             │                     │  │
│   │ RecordingControl │                             │ RecorderState       │  │
│   │    Component     │                             │ SelectorGenerator   │  │
│   └──────────────────┘                             │ ActionConverter     │  │
│                                                    │ SkillsService       │  │
│                                                    └─────────────────────┘  │
│                                                            │               │
│                                                 Chrome Tabs.sendMessage    │
│                                                            │               │
│                                                            ▼               │
│                                                    ┌─────────────────────┐  │
│                                                    │   Content Script    │  │
│                                                    │   (Event Monitor)   │  │
│                                                    │                     │  │
│                                                    │ handleClick         │  │
│                                                    │ handleInput         │  │
│                                                    │ handleScroll        │  │
│                                                    │ handleKeydown       │  │
│                                                    │ handleSelect        │  │
│                                                    │ handleCopy/Paste    │  │
│                                                    └─────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心模块详解

### 1. Content Script - 事件监听层

**位置**: `pages/content/src/index.ts`

Content Script 是录制系统的"眼睛"，它注入到目标网页中，监听用户的各类操作事件。

#### 支持的操作类型

| 操作类型 | 监听事件 | 说明 |
|---------|---------|------|
| `click` | `click` (capture mode) | 点击元素 |
| `input` | `input` (debounced) | 文本输入（500ms debounce） |
| `scroll` | `scroll` (throttled) | 页面滚动（100ms throttle） |
| `keydown` | `keydown` | 特殊按键（Enter/Tab/Escape/Backspace） |
| `select` | `change` | 下拉选择 |
| `navigate` | 页面加载时 | 页面导航 |
| `copy` | `copy` | 复制操作 |
| `paste` | `paste` | 粘贴操作 |
| `cut` | `cut` | 剪切操作 |

#### 元素信息提取

```typescript
function extractElementInfo(element: HTMLElement): {
  tagName: string;
  id?: string;              // 元素 ID（最稳定）
  className?: string;       // CSS 类名
  name?: string;            // form name 属性
  type?: string;            // input type
  placeholder?: string;     // placeholder 文本
  ariaLabel?: string;       // aria-label 属性
  dataTestId?: string;      // data-testid 属性（测试友好）
  href?: string;            // 链接地址
  textContent?: string;     // 文本内容（按钮/链接）
  xpath?: string;           // XPath 路径
}
```

#### XPath 生成策略

系统采用智能 XPath 生成策略，优先使用最短路径：

```typescript
function generateSimpleXPath(element: HTMLElement): string {
  // 优先：如果元素有 id，使用 //*[@id="xxx"]（最短、最可靠）
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  
  // 次选：向上遍历直到找到有 id 的祖先，然后从该祖先开始构建路径
  // 最后：完整路径 /html/body/...
}
```

---

### 2. Background - 录制管理层

**位置**: `chrome-extension/src/background/recorder/RecorderManager.ts`

Background Service Worker 是录制系统的"大脑"，管理录制会话的状态和数据。

#### 核心类结构

```
RecorderState                SelectorGenerator              ActionConverter
├── session                  ├── generateSelectors()        ├── convertAction()
├── lastNavigateUrl          ├── 优先级策略:                ├── isParametricValue()
├── lastNavigateTime         │   1. ID selector            └── extractParameters()
├── recordingTabId           │   2. data-testid
├── startSession()           │   3. name attribute          └── convertAction()
├── stopSession()            │   4. type+placeholder
├── getActiveSession()       │   5. aria-label
├── addAction()              │   6. class selector
├── removeAction()           │   7. textContent
├── updateAction()           └── 返回 ElementSelector
└── clearSession()
```

#### 录制会话状态管理

```typescript
interface RecordingSession {
  id: string;                              // 会话唯一 ID
  tabId: number;                           // 录制的标签页 ID
  startedAt: number;                       // 开始时间戳
  endedAt?: number;                        // 结束时间戳
  actions: RecordedAction[];               // 录制的操作列表
  status: 'recording' | 'stopped' | 'completed';
}
```

#### Navigate 去重机制

为防止页面导航时重复记录相同的 URL，系统实现了去重逻辑：

```typescript
// 同一 URL 在 2 秒内不重复记录
private readonly NAVIGATE_DEDUP_MS = 2000;

if (action.type === 'navigate') {
  const url = action.navigateInfo?.url;
  if (url === this.lastNavigateUrl && now - this.lastNavigateTime < NAVIGATE_DEDUP_MS) {
    return false; // 跳过重复
  }
}
```

---

### 3. ActionConverter - 操作转换层

**位置**: `RecorderManager.ts` 中的 `ActionConverter` 类

这是录制系统最核心的转换逻辑，将用户操作转换为 Skill 步骤。

#### 转换映射表

| RecordedAction | SkillStep Action | 参数 |
|----------------|-----------------|------|
| `navigate` | `go_to_url` | `{ url, intent }` |
| `click` | `click_element` | `{ selector, xpath, fallbacks, attributes }` |
| `input` | `input_text` | `{ selector, text }` - 智能参数化 |
| `keydown` | `send_keys` | `{ keys }` |
| `scroll` | `scroll_to_percent` | `{ yPercent }` |
| `select` | `select_dropdown_option` | `{ selector, text }` |
| `copy` | `copy_text` | `{ selectionInfo }` |
| `paste` | `paste_text` | `{ text }` - 智能参数化 |
| `cut` | `cut_text` | `{ cutInfo }` |

#### 智能参数化检测

系统自动检测用户输入内容是否需要参数化（变为可配置的模板参数）：

```typescript
private isParametricValue(value: string): boolean {
  const patterns = [
    /^[A-Z]/,        // 大写字母开头（姓名、标题）
    /\d{4,}/,        // 连续数字（ID、价格）
    /@/,             // 包含 @（邮箱）
    /\d+\.\d+/,      // 小数（金额）
    /https?:\/\//,   // URL
    /.{20,}/,        // 长文本
  ];
  
  return patterns.some(p => p.test(value));
}
```

如果检测为参数化值，会自动转换为模板语法：

```typescript
// 例如用户输入 "John Doe"
text: isParametric ? '{{inputValue}}' : action.value
```

---

### 4. UI 控制层

**位置**: `pages/side-panel/src/components/RecordingControl.tsx`

#### 主要功能

1. **录制控制**: 开始/停止录制按钮
2. **实时预览**: 显示已录制的操作步骤列表
3. **步骤编辑**: 支持编辑单个步骤的值
4. **保存为 Skill**: 输入名称、描述后保存
5. **AI 优化**: 支持 AI 智能优化 Skill 内容

#### 通信机制

使用 Chrome Runtime Port 进行双向通信：

```typescript
// 消息类型
type RecordingMessages = {
  // Background -> Content Script
  start_recording: { sessionId: string };
  stop_recording: {};
  
  // Content Script -> Background
  recorded_action: { sessionId: string; action: RecordedAction };
  
  // Background -> Side Panel
  recording_state_update: { session: RecordingSession };
  recording_saved: { skillId: string };
  
  // Side Panel -> Background
  save_recording_as_skill: { skillName, skillDescription };
}
```

---

## 完整数据流

### 录制流程

```
1. 用户点击"开始录制"
   │
   ▼
2. Side Panel 发送 start_recording 消息
   │
   ▼
3. Background 创建 RecordingSession
   ├── recorderState.startSession(tabId)
   └── 返回 session 对象
   │
   ▼
4. Background 注入 Content Script
   ├── chrome.scripting.executeScript()
   └── 发送 start_recording 消息到 Content Script
   │
   ▼
5. Content Script 开始监听事件
   ├── 添加事件监听器（click, input, scroll, keydown...）
   └── 记录初始 navigate
   │
   ▼
6. 用户执行操作 → Content Script 捕获
   ├── extractElementInfo() 提取元素信息
   ├── sendActionToBackground() 发送到 Background
   │
   ▼
7. Background 处理 recorded_action
   ├── recorderState.addAction(action)
   ├── 去重检查（navigate）
   └── 通过 Port 推送 recording_state_update 到 Side Panel
   │
   ▼
8. Side Panel 实时显示录制状态
   └── 更新 UI 显示操作列表
```

### 生成 Skill 流程

```
1. 用户点击"停止录制"
   │
   ▼
2. Side Panel 发送 stop_recording
   │
   ▼
3. Background 停止录制
   ├── recorderState.stopSession()
   ├── 发送 stop_recording 到 Content Script
   └── Content Script 移除事件监听器
   │
   ▼
4. 用户输入 Skill 名称和描述
   │
   ▼
5. Side Panel 发送 save_recording_as_skill
   │
   ▼
6. Background 生成 Skill
   ├── generateSkillFromRecording(session, name, description)
   │   ├── ActionConverter.convertAction() 转换每个操作
   │   ├── ActionConverter.extractParameters() 提取参数
   │   └── 返回 GeneratedSkill
   │
   ▼
7. 存储到 Extension Storage
   ├── userSkillsStore.addSkill(skillConfig)
   └── recorderState.clearSession()
   │
   ▼
8. 返回 recording_saved 确认
   └── Side Panel 显示保存成功
```

---

## Skill 数据结构

### GeneratedSkill 结构

```typescript
interface GeneratedSkill {
  id: string;                      // skill ID（格式: recorded-{sessionId}）
  name: string;                    // 用户定义的名称
  description: string;             // 用户定义的描述
  category: 'automation';          // 固定为 automation 类别
  parameters: Array<{              // 自动提取的参数
    name: string;
    type: 'string' | 'number';
    description: string;
    required: boolean;
    default?: string;
  }>;
  steps: Array<{                   // 转换后的步骤
    id: string;
    action: string;
    description?: string;
    parameters: Record<string, unknown>;
    onError: 'stop' | 'continue' | 'retry';
  }>;
  executionMode: 'expanded';       // 默认展开模式
}
```

### SkillStep 示例

```typescript
// 用户操作: 点击"搜索"按钮
{
  id: "step1",
  action: "click_element",
  description: "Click \"搜索\"",
  parameters: {
    intent: "Click 搜索",
    selector: "#search-btn",
    xpath: "//*[@id=\"search-btn\"]",
    fallbacks: ["button.search-btn"],
    attributes: { id: "search-btn", tagName: "BUTTON" }
  },
  onError: "retry"
}

// 用户操作: 输入 "Nanobrowser"
{
  id: "step2",
  action: "input_text",
  description: "Input into \"搜索框\"",
  parameters: {
    intent: "Input text",
    selector: "#search-input",
    xpath: "//*[@id=\"search-input\"]",
    text: "{{inputValue}}"  // 自动参数化
  },
  onError: "stop"
}
```

---

## Skill 存储与执行

### 存储机制

**位置**: `packages/storage/lib/settings/userSkills.ts`

使用 Chrome Extension Storage API 存储 Skill：

```typescript
// 存储结构
interface UserSkillsRecord {
  skills: Record<string, UserSkillConfig>;
}

// 存储 key
const STORAGE_KEY = 'user-skills';
```

### SkillsService 管理

**位置**: `chrome-extension/src/background/services/skills/SkillsService.ts`

```typescript
class SkillsService {
  private registry: SkillRegistry;    // Skill 注册表
  private executor: SkillExecutor;    // Skill 执行器
  
  async initialize(): void {
    // 1. 加载内置 Skills
    // 2. 加载用户 Skills（从 storage）
  }
  
  async executeSkill(skillId, params, context): SkillExecutionResult {
    // 执行 Skill
  }
}
```

### SkillExecutor 执行流程

**位置**: `packages/skills/lib/core/SkillExecutor.ts`

```typescript
async execute(skillId, params, context): SkillExecutionResult {
  // 1. 获取 Skill 定义
  // 2. 验证参数
  // 3. 合理默认参数
  // 4. 解析模板（{{param}}）
  // 5. 逐步骤执行
  // 6. 处理错误（stop/continue/retry）
  // 7. 返回执行结果
}
```

---

## 执行 Workflow 的集成

录制生成的 Skill 可以通过 WorkflowService 执行：

**位置**: `chrome-extension/src/background/index.ts`

```typescript
// Workflow 执行时的 action 处理
switch (action) {
  case 'go_to_url':
    await browserContext.navigateTo(url);
    
  case 'click_element':
    // 尝试多个选择器
    for (const sel of buildSelectorList(params)) {
      if (await page.clickBySelector(sel)) return { success: true };
    }
    
  case 'input_text':
    await page.inputBySelector(selector, text);
    
  case 'scroll_to_percent':
    await page.scrollToPercentDirect(yPercent);
    
  // ... 其他 action
}
```

### 选择器优先级策略

```typescript
function buildSelectorList(params): string[] {
  // 1. Primary CSS selector
  // 2. XPath
  // 3. Fallback selectors
  // 4. Attribute-based selectors（从 attributes 构建）
}
```

---

## 关键设计特点

### 1. 多层选择器容错

系统为每个元素生成多个选择器作为后备：

```typescript
interface ElementSelector {
  primary: string;        // 主选择器（ID/data-testid）
  fallbacks: string[];    // 后备选择器列表
  xpath?: string;         // XPath（终极后备）
  textContent?: string;   // 文本匹配
  attributes: Record<string, string>;  // 属性字典
}
```

执行时依次尝试，确保最大成功率。

### 2. 智能参数提取

系统自动识别"参数化值"，将用户输入转换为模板：

| 模式 | 示例 | 转换结果 |
|-----|------|---------|
| 大写开头 | "John Doe" | `{{inputValue}}` |
| 连续数字 | "12345" | `{{inputValue}}` |
| 邮箱格式 | "test@example.com" | `{{inputValue}}` |
| URL | "https://..." | `{{inputValue}}` |
| 长文本 | 超过 20 字符 | `{{inputValue}}` |

### 3. 页面导航恢复

当录制过程中页面刷新或导航，Content Script 会自动恢复录制状态：

```typescript
// Content Script 加载时检查
(function checkRecordingStatus() {
  chrome.runtime.sendMessage({ type: 'check_recording_status' }, response => {
    if (response?.isRecording) {
      startRecording(response.sessionId);  // 恢复录制
    }
  });
})();
```

### 4. iframe 排除

录制仅在主框架（main frame, frameId: 0）进行，避免 iframe 内的操作干扰：

```typescript
// 发送消息时指定 frameId: 0
await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
```

### 5. Tab 纬度隔离

录制只记录开始录制时的 Tab，切换到其他 Tab 时忽略操作：

```typescript
const recordingTabId = recorderState.getRecordingTabId();
if (senderTabId !== recordingTabId) {
  console.log('Ignoring action from different tab');
  return;
}
```

---

## 消息通信总结

| 消息类型 | 方向 | 携带数据 |
|---------|------|---------|
| `start_recording` | Side Panel → Background → Content Script | `tabId, sessionId` |
| `stop_recording` | Side Panel → Background → Content Script | 无 |
| `recorded_action` | Content Script → Background | `sessionId, action` |
| `recording_state_update` | Background → Side Panel | `session` |
| `recording_started` | Background → Side Panel | `session` |
| `recording_stopped` | Background → Side Panel | `session` |
| `save_recording_as_skill` | Side Panel → Background | `skillName, skillDescription` |
| `recording_saved` | Background → Side Panel | `skillId, skillName` |
| `check_recording_status` | Content Script → Background | 无 |
| `get_recording_state` | Side Panel → Background | 无 |

---

## 事件监听原理详解

### 事件捕获机制

Content Script 采用 **事件捕获模式（capture phase）** 来监听用户操作，这是最可靠的事件监听方式。

```typescript
// 使用 capture: true 确保在其他处理程序之前捕获事件
document.addEventListener('click', handleClick, true);  // 第三个参数 true = capture mode
document.addEventListener('input', handleInput, true);
document.addEventListener('keydown', handleKeydown, true);
document.addEventListener('scroll', handleScroll, true);
document.addEventListener('change', handleSelect, true);
document.addEventListener('copy', handleCopy, true);
document.addEventListener('paste', handlePaste, true);
document.addEventListener('cut', handleCut, true);
```

#### 为什么使用 Capture Mode？

| 对比 | Capture Mode | Bubble Mode |
|-----|-------------|-------------|
| 执行顺序 | 从外到内（document → element） | 从内到外（element → document） |
| 可靠性 | 最高（最先执行） | 可能被阻止 |
| 阻止风险 | 不会被 stopPropagation 影响 | 可能被中间处理程序阻止 |
| 适用场景 | 录制/监控类应用 | 响应类应用 |

**事件传播流程示例**：

```
用户点击按钮时的事件传播：

Capture Phase (捕获阶段):
  document ← handleClick (这里捕获!)
    ↓
  body
    ↓
  div.container
    ↓
  button.submit ← 其他处理程序

Bubble Phase (冒泡阶段):
  button.submit ← 其他处理程序
    ↑
  div.container
    ↑
  body
    ↑
  document
```

### 各事件类型详细处理

#### 1. Click 事件

```typescript
function handleClick(event: MouseEvent) {
  if (!isRecording) return;

  const target = event.target as HTMLElement;

  // 过滤无效目标
  const tagName = target.tagName.toUpperCase();
  if (tagName === 'HTML' || tagName === 'BODY') return;

  // 提取元素信息
  const elementInfo = extractElementInfo(target);

  // 发送到 Background
  sendActionToBackground('click', { element: elementInfo });
}
```

**关键特点**：
- 过滤 `HTML` 和 `BODY` 元素（避免记录空白点击）
- 完整提取元素的多维度定位信息

#### 2. Input 事件（带 Debounce）

```typescript
let inputDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastInputValue = '';

function handleInput(event: Event) {
  if (!isRecording) return;

  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  const currentValue = target.value;

  // Debounce: 500ms 后才记录
  if (inputDebounceTimer) {
    clearTimeout(inputDebounceTimer);
  }

  inputDebounceTimer = setTimeout(() => {
    // 只在值真正变化且不为空时记录
    if (currentValue !== lastInputValue && currentValue.length > 0) {
      sendActionToBackground('input', {
        element: extractElementInfo(target),
        value: currentValue,
      });
      lastInputValue = currentValue;
    }
  }, 500);
}
```

**Debounce 原因**：
- 用户输入时会连续触发多次 `input` 事件
- 500ms 等待确保记录最终完整值
- 避免记录大量中间状态（如逐字符输入）

#### 3. Scroll 事件（带 Throttle）

```typescript
const THROTTLE_MS = 100;
let lastScrollTime = 0;

function handleScroll(event: Event) {
  if (!isRecording) return;

  // Throttle: 100ms 内只记录一次
  const now = Date.now();
  if (now - lastScrollTime < THROTTLE_MS) return;
  lastScrollTime = now;

  // 计算滚动百分比
  const yPercent = Math.round(
    (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
  );

  sendActionToBackground('scroll', {
    scrollInfo: { x: window.scrollX, y: window.scrollY, yPercent },
  });
}
```

**Throttle 原因**：
- 滚动会产生高频事件流
- 100ms throttle 减少事件数量
- 记录有意义的滚动位置（百分比）

#### 4. Keydown 事件（仅特殊键）

```typescript
function handleKeydown(event: KeyboardEvent) {
  if (!isRecording) return;

  // 只捕获特殊键
  const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace'];
  if (!specialKeys.includes(event.key)) return;

  // Enter 键的特殊处理
  if (event.key === 'Enter') {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      sendActionToBackground('keydown', { keys: 'Enter' });
    }
  } else {
    sendActionToBackground('keydown', { keys: event.key });
  }
}
```

**为什么只记录特殊键？**
- 普通字符键已被 `input` 事件覆盖
- Enter/Tab 等有语义含义（提交/切换焦点）
- 减少冗余事件

#### 5. Clipboard 事件（copy/paste/cut）

```typescript
function handleCopy(event: ClipboardEvent) {
  if (!isRecording) return;

  const selection = window.getSelection();
  const copiedText = selection?.toString() || '';

  // 不记录空复制
  if (!copiedText) return;

  sendActionToBackground('copy', {
    value: copiedText.slice(0, 200),  // 限制长度
    selectionInfo: { text: copiedText.slice(0, 200), length: copiedText.length },
  });
}

function handlePaste(event: ClipboardEvent) {
  if (!isRecording) return;

  const target = event.target as HTMLElement;
  const tagName = target.tagName.toUpperCase();

  // 只记录输入区域的粘贴
  if (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && !target.isContentEditable) return;

  const pastedText = event.clipboardData?.getData('text') || '';
  if (!pastedText) return;

  sendActionToBackground('paste', {
    element: extractElementInfo(target),
    value: pastedText.slice(0, 200),
    pasteInfo: { length: pastedText.length, isImage: !!event.clipboardData?.getData('image') },
  });
}
```

### 元素信息提取算法

```typescript
function extractElementInfo(element: HTMLElement): ElementSelectorData {
  const info: Record<string, string | undefined> = { tagName: element.tagName };

  // === 高优先级属性 ===
  if (element.id) info.id = element.id;           // 最稳定
  if (element.getAttribute('data-testid')) info.dataTestId = element.getAttribute('data-testid');

  // === 中优先级属性 ===
  if (element.getAttribute('name')) info.name = element.getAttribute('name');
  if (element.getAttribute('type')) info.type = element.getAttribute('type');
  if (element.getAttribute('placeholder')) info.placeholder = element.getAttribute('placeholder');
  if (element.getAttribute('aria-label')) info.ariaLabel = element.getAttribute('aria-label');

  // === 低优先级属性 ===
  if (element.className && typeof element.className === 'string') info.className = element.className;
  if (element.getAttribute('href')) info.href = element.getAttribute('href');

  // === 特殊处理 ===
  // 按钮/链接的文本内容（用于文本匹配）
  const tagName = element.tagName.toUpperCase();
  if (tagName === 'BUTTON' || tagName === 'A' || tagName === 'SPAN') {
    const text = element.textContent?.trim();
    if (text && text.length < 100) {
      info.textContent = text;
    }
  }

  // XPath（终极后备）
  info.xpath = generateSimpleXPath(element);

  return info;
}
```

### 消息发送机制

```typescript
function sendActionToBackground(actionType: string, data: Record<string, unknown>) {
  if (!isRecording || !sessionId) return;

  const action = {
    sessionId,
    action: {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: actionType,
      timestamp: Date.now(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      ...data,
    },
  };

  try {
    chrome.runtime.sendMessage({ type: 'recorded_action', ...action });
  } catch (error) {
    // Extension context invalidated (页面刷新/关闭)
    console.warn('Failed to send recorded action:', error);
  }
}
```

### 页面导航恢复机制

当录制过程中页面发生导航或刷新，Content Script 会自动恢复录制状态：

```typescript
(function checkRecordingStatus() {
  try {
    chrome.runtime.sendMessage({ type: 'check_recording_status' }, response => {
      if (chrome.runtime.lastError) {
        console.warn('[ContentScript] Extension context not ready');
        return;
      }
      // 如果正在录制，恢复录制状态
      if (response && response.isRecording && response.sessionId) {
        console.log('[ContentScript] Recovering recording session:', response.sessionId);
        startRecording(response.sessionId);
      }
    });
  } catch (e) {
    // Extension context might not be ready
  }
})();
```

**恢复流程**：
```
页面加载
    ↓
checkRecordingStatus 发送
    ↓
Background 检查 recorderState.getActiveSession()
    ↓
返回 { isRecording: true, sessionId: "xxx" }
    ↓
Content Script 执行 startRecording(sessionId)
    ↓
恢复事件监听 + 记录初始 navigate
```

---

## Skill 转 Workflow 机制

### 概述

录制生成的 Skill 是一个线性步骤序列，Workflow 则是可视化的节点图结构。转换过程将 Skill 的线性步骤映射为 Workflow 的节点和边。

### 数据结构对比

```
Skill 结构（线性）:
┌─────────────────────────────────────────┐
│ Skill                                    │
│ ├── parameters: []                       │
│ └── steps: [                             │
│       { action: "go_to_url", ... },      │  ← 步骤 1
│       { action: "click_element", ... },  │  ← 步骤 2
│       { action: "input_text", ... },     │  ← 步骤 3
│       { action: "send_keys", ... },      │  ← 步骤 4
│     ]                                    │
└─────────────────────────────────────────┘

Workflow 结构（图）:
┌─────────────────────────────────────────┐
│ Workflow                                 │
│ ├── nodes: [                             │
│       { id: "start", type: "start" },    │  ← 节点 1
│       { id: "step-0", type: "automation" }, │  ← 节点 2
│       { id: "step-1", type: "automation" }, │  ← 节点 3
│       { id: "step-2", type: "automation" }, │  ← 节点 4
│       { id: "end", type: "end" },        │  ← 节点 5
│     ]                                    │
│ ├── edges: [                             │
│       { source: "start", target: "step-0" }, │  ← 连接 1
│       { source: "step-0", target: "step-1" }, │  ← 连接 2
│       { source: "step-1", target: "step-2" }, │  ← 连接 3
│       { source: "step-2", target: "end" },    │  ← 连接 4
│     ]                                    │
│ └── variables: []                        │
└─────────────────────────────────────────┘
```

### 转换核心算法

**位置**: `packages/workflow/lib/converter/SkillToWorkflow.ts`

#### 主转换函数

```typescript
export function convertSkillToWorkflow(skill: Skill): Workflow {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const variables: WorkflowVariable[] = [];

  // 1. Skill 参数 → Workflow 变量
  for (const param of skill.parameters) {
    variables.push({
      name: param.name,
      type: param.type,
      description: param.description,
      required: param.required,
      default: param.default,
    });
  }

  // 2. 创建 Start 节点
  nodes.push({
    id: 'start',
    type: 'start',
    name: 'Start',
    position: { x: 100, y: 200 },
    data: {},
  });

  // 3. 处理步骤 → 创建自动化节点
  processSteps(skill.steps, nodes, edges, startX, centerY);

  // 4. 创建 End 节点
  nodes.push({
    id: 'end',
    type: 'end',
    name: 'End',
    position: { x: maxX, y: 200 },
    data: {},
  });

  // 5. 最后节点 → End 的边
  edges.push({ source: lastNodeId, target: 'end' });

  return { id, name, description, nodes, edges, variables, ... };
}
```

#### 步骤处理函数

```typescript
function processSteps(steps, nodes, edges, startX, centerY) {
  let currentX = startX;
  let lastNodeId = 'start';

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const nodeId = `step-${i}`;

    if (step.condition) {
      // 条件步骤 → 条件节点 + 分支布局
      processConditionStep(step, nodeId, ...);
    } else {
      // 普通步骤 → 自动化节点
      const automationNode = {
        id: nodeId,
        type: 'automation',
        name: step.description || step.action,
        position: { x: currentX, y: centerY },
        data: {
          action: step.action,         // ← Skill 的 action
          parameters: step.parameters, // ← Skill 的 parameters
          delayAfter: step.delay,
        },
      };
      nodes.push(automationNode);

      // 创建连接边
      edges.push({ source: lastNodeId, target: nodeId });
      lastNodeId = nodeId;
      currentX += HORIZONTAL_SPACING;
    }
  }
}
```

### 映射关系表

| Skill 字段 | Workflow 字段 | 说明 |
|-----------|--------------|------|
| `skill.id` | `workflow.id` | 直接继承 |
| `skill.name` | `workflow.name` | 直接继承 |
| `skill.description` | `workflow.description` | 直接继承 |
| `skill.parameters[]` | `workflow.variables[]` | 参数转变量 |
| `skill.steps[].action` | `node.data.action` | 操作名称 |
| `skill.steps[].parameters` | `node.data.parameters` | 操作参数 |
| `skill.steps[].description` | `node.name` | 节点显示名 |
| `skill.steps[].delay` | `node.data.delayAfter` | 延迟时间 |
| `skill.steps[].onError` | `workflow.executionConfig.onError` | 错误处理 |

### 布局算法

转换时会计算节点的可视化布局位置：

```typescript
const NODE_WIDTH = 180;           // 节点宽度
const START_END_SIZE = 50;        // 开始/结束节点尺寸
const HORIZONTAL_SPACING = 200;   // 水平间距
const BRANCH_OFFSET = 250;        // 分支垂直偏移

// 布局计算
let currentX = 100;               // 起点 X
const currentY = 200;             // 固定 Y（主线）

// 每个节点后，X 前移
currentX += HORIZONTAL_SPACING + NODE_WIDTH;
```

**布局示意**：

```
Y=200 (主线)
    ┌──────┐     ┌──────────┐     ┌──────────┐     ┌──────┐
    │ Start│────▶│ Step-0   │────▶│ Step-1   │────▶│ End  │
    └──────┘     │(automation)│   │(automation)│   └──────┘
                 └──────────┘     └──────────┘
                   X=200            X=400           X=600
```

### 条件步骤处理

当 Skill 步骤包含条件时，转换为 Workflow 的条件节点：

```typescript
function processConditionStep(step, nodeId, ...) {
  // 1. 创建条件节点
  const conditionNode = {
    id: nodeId,
    type: 'condition',
    name: 'Condition',
    position: { x: currentX, y: centerY },
    data: {
      conditionExpression: condition.expression,
      evaluateWithAI: true,
    },
  };
  nodes.push(conditionNode);

  // 2. 计算分支位置（上下偏移）
  const branchYTop = centerY - BRANCH_OFFSET / 2;    // 上分支
  const branchYBottom = centerY + BRANCH_OFFSET / 2; // 下分支

  // 3. 处理 then 分支
  if (condition.thenSteps) {
    processBranchSteps(thenSteps, ..., branchYTop, 'true');
  }

  // 4. 处理 else 分支
  if (condition.elseSteps) {
    processBranchSteps(elseSteps, ..., branchYBottom, 'false');
  }

  // 5. 创建合并节点
  const mergeNode = { id: `${nodeId}-merge`, ... };
}
```

**条件布局示意**：

```
                    ┌──────────┐
                    │ Then-Step│  ← Y = 75 (上分支)
                    └──────────┘     │
                                    │
┌──────┐  ┌──────────┐  ┌───────┐  ┌──────────┐  ┌──────┐
│Start│─▶│ Condition│─▶│ true  │─▶│ Then-Step│  │      │
└──────┘  └──────────┘  └───────┘             │ Merge│─▶│End│
                     │ false │                │      │  └──────┘
                     └───────┘                │      │
                                    │          │
                    ┌──────────┐     │          │
                    │ Else-Step│  ← Y = 325     │
                    └──────────┘     │          │
                                    │          │
                           Y=200 (主线)        │
```

### Workflow 执行流程

**位置**: `chrome-extension/src/background/services/workflow/WorkflowService.ts`

```typescript
async executeWorkflow(workflowId, tabId, params, actionExecutor) {
  // 1. 获取最新 Workflow
  const workflow = await userWorkflowsStore.getWorkflow(workflowId);

  // 2. 创建执行上下文
  const context = new WorkflowExecutionContextImpl(tabId, actionExecutor);

  // 3. 设置初始变量
  for (const [key, value] of Object.entries(params)) {
    context.setVariable(key, value);
  }

  // 4. 执行 Workflow
  return this.executor.execute(workflow, context);
}
```

### 执行上下文实现

```typescript
class WorkflowExecutionContextImpl {
  async executeAction(actionName: string, params: Record<string, unknown>): ActionResult {
    // 调用外部提供的 action 执行器
    return this.actionExecutor(actionName, params);
  }

  async invokeAI(prompt: string, context?: Record<string, unknown>): AIResult {
    // 调用 AI Agent
    return this.aiInvoker(prompt, context);
  }

  getVariable(name: string): unknown {
    return this.variables[name];
  }

  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }
}
```

### Action 执行映射

**位置**: `chrome-extension/src/background/index.ts`

Workflow 执行时，自动化节点的 action 通过以下映射执行：

```typescript
const actionExecutor = async (action: string, params: Record<string, unknown>) => {
  switch (action) {
    case 'go_to_url':
      await browserContext.navigateTo(params.url);
      return { success: true };

    case 'click_element':
      // 尝试多个选择器（优先级策略）
      for (const selector of buildSelectorList(params)) {
        if (await page.clickBySelector(selector)) {
          return { success: true };
        }
      }
      return { success: false, error: 'Element not found' };

    case 'input_text':
      await page.inputBySelector(params.selector, params.text);
      return { success: true };

    case 'scroll_to_percent':
      await page.scrollToPercentDirect(params.yPercent);
      return { success: true };

    case 'send_keys':
      await page.sendKeys(params.keys);
      return { success: true };

    case 'wait':
      await new Promise(resolve => setTimeout(resolve, params.duration || 1000));
      return { success: true };

    // ... 更多 action
  }
};
```

### 选择器优先级执行策略

```typescript
function buildSelectorList(params: Record<string, unknown>): string[] {
  const selectors: string[] = [];

  // 1. 主选择器
  if (params.selector) selectors.push(params.selector);

  // 2. XPath
  if (params.xpath) selectors.push(params.xpath);

  // 3. 后备选择器列表
  if (params.fallbacks) {
    for (const fb of params.fallbacks) {
      selectors.push(fb);
    }
  }

  // 4. 属性选择器（从 attributes 构建）
  if (params.attributes) {
    if (params.attributes.id) selectors.push(`#${params.attributes.id}`);
    if (params.attributes['data-testid']) selectors.push(`[data-testid="${...}"]`);
    if (params.attributes.name) selectors.push(`${tagName}[name="${...}"]`);
    // ...
  }

  return selectors;
}
```

执行时依次尝试，直到成功：

```
尝试 selector: "#search-btn"
    ↓ 失败
尝试 xpath: "//*[@id='search-btn']"
    ↓ 失败
尝试 fallback: "button.search-btn"
    ↓ 成功 ✓
```

---

## 完整数据流（录制 → Skill → Workflow）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         录制 → Skill → Workflow 全流程                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 录制阶段                                                                 │
│  ┌─────────────┐                                                            │
│  │ 用户操作    │                                                            │
│  │ (click等)   │                                                            │
│  └──────┬──────┘                                                            │
│         │ Content Script 捕获                                                │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │RecordedAction│                                                           │
│  │{ type, value│                                                            │
│  │  element }  │                                                            │
│  └──────┬──────┘                                                            │
│         │ 发送到 Background                                                  │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │RecordingSession│                                                         │
│  │{ actions[] }│                                                            │
│  └──────┬──────┘                                                            │
│                                                                             │
│  2. Skill 生成阶段                                                           │
│         │ generateSkillFromRecording()                                       │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ GeneratedSkill│                                                          │
│  │{ steps[]    │                                                            │
│  │ parameters[]│                                                            │
│  │ category }  │                                                            │
│  └──────┬──────┘                                                            │
│         │ userSkillsStore.addSkill()                                         │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ Chrome Storage│                                                          │
│  │{ skills{} } │                                                            │
│  └──────┬──────┘                                                            │
│                                                                             │
│  3. Workflow 转换阶段（可选）                                                  │
│         │ convertSkillToWorkflow()                                          │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ Workflow    │                                                            │
│  │{ nodes[]    │                                                            │
│  │ edges[]     │                                                            │
│  │ variables[] │                                                            │
│  │ layout }    │                                                            │
│  └──────┬──────┘                                                            │
│         │ userWorkflowsStore.addWorkflow()                                   │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ Chrome Storage│                                                          │
│  │{ workflows{}│                                                            │
│  └──────┬──────┘                                                            │
│                                                                             │
│  4. Workflow 执行阶段                                                         │
│         │ WorkflowService.executeWorkflow()                                 │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ WorkflowExecutor│                                                        │
│  │遍历 nodes   │                                                            │
│  └──────┬──────┘                                                            │
│         │ 对 automation 节点调用 actionExecutor                              │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ Browser APIs│                                                            │
│  │(click, input│                                                            │
│  │ navigate)   │                                                            │
│  └──────┬──────┘                                                            │
│         │                                                                    │
│         ▼                                                                    │
│  ┌─────────────┐                                                            │
│  │ WorkflowResult│                                                          │
│  │{ success,   │                                                            │
│  │ results[] } │                                                            │
│  └─────────────┘                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 文件索引

| 文件 | 职责 |
|-----|------|
| `pages/content/src/index.ts` | Content Script，事件监听 |
| `chrome-extension/src/background/recorder/RecorderManager.ts` | 录制状态管理、选择器生成、Action 转换 |
| `chrome-extension/src/background/recorder/types.ts` | 录制相关类型定义 |
| `chrome-extension/src/background/index.ts` | Background 入口，消息处理，Workflow 执行 |
| `pages/side-panel/src/components/RecordingControl.tsx` | UI 控制组件 |
| `packages/storage/lib/settings/userSkills.ts` | Skill 存储管理 |
| `chrome-extension/src/background/services/skills/SkillsService.ts` | Skill 服务管理 |
| `packages/skills/lib/core/SkillExecutor.ts` | Skill 执行引擎 |
| `packages/skills/lib/types/skill.ts` | Skill 类型定义 |

---

## 未来扩展方向

1. **条件步骤**: 支持 `if/while` 条件判断
2. **变量传递**: 步骤间结果传递
3. **截图录制**: 记录操作时的截图
4. **AI 增强**: 自动优化、合并、删除冗余步骤
5. **跨 Tab 录制**: 支持多标签页联动操作
6. **录制回放**: 实时预览录制效果

---

*文档生成日期: 2026-04-30*