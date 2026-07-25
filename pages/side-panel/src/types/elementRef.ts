/**
 * 用户引用的页面元素 —— 通过聊天框 @ 面板或 TeachingDialog 行序号选中。
 *
 * 双层语义：
 *  - 在 textarea 里以 `[purpose #idx]` 可见文本插入（用户能看到、能编辑、能删）
 *  - handleSendMessage 时同步拼成 <nano_referenced_elements>...</nano_referenced_elements>
 *    XML 块，让 Agent 拿到精确 xpath/selector，confidence 直接 0.95+，绕过闸门
 *
 * 这是**临时引用**（每次发送后清空），不等于元素事实库 hint：
 *  - @ 面板里点已有 hint → 生成 ElementRef，*不*重复落库
 *  - @ 面板里现场拾取的新元素 → 同步落库（user_pick）+ 入 refs
 *  - TeachingDialog 里的手动拾取结果 → 入 refs（不影响事实库批量保存）
 */

export interface ElementRef {
  /** 显示用 token，如 "搜索框 #3"；无 index 时如 "搜索框" */
  label: string;
  /** 元素用途；来自 hint.purpose 或用户给的描述 */
  purpose: string;
  /** 当时所属的 selectorMap index；纯库内引用没 index → -1 */
  index: number;
  selector?: string;
  xpath?: string;
  text?: string;
  origin: 'memory' | 'pick' | 'teaching';
}

/** 把 ElementRef 构造成可见 token —— UI 和 XML 都用同一份 label 保证一致 */
export function refToToken(r: ElementRef): string {
  return `[${r.label}]`;
}
