/**
 * 用户澄清 (ask_user) 相关的共享工具：
 * 给 LLM 看的一行总结。同时被 ask_user action handler 和
 * planner.ask_user 分支共用，放到独立文件避免 executor / builder 循环依赖。
 */

import type { ClarifyResponse } from '@extension/shared';

export function summarizeClarifyResponse(resp: ClarifyResponse, options?: { id: string; label: string }[]): string {
  if (resp.abortTask) return 'User aborted the task.';
  if (resp.cancelled) return 'User cancelled the question without answering.';
  const parts: string[] = [];
  if (resp.choiceId) {
    const opt = options?.find(o => o.id === resp.choiceId);
    parts.push(opt ? `User chose option "${opt.label}" (id=${opt.id}).` : `User chose option id=${resp.choiceId}.`);
  }
  if (resp.text && resp.text.trim()) {
    parts.push(`User typed: ${resp.text.trim()}`);
  }
  if (resp.pickedSelector || resp.pickedXpath) {
    const bits: string[] = [];
    if (resp.pickedSelector) bits.push(`selector=${resp.pickedSelector}`);
    if (resp.pickedStableSelector) bits.push(`stableSelector=${resp.pickedStableSelector}`);
    if (resp.pickedXpath) bits.push(`xpath=${resp.pickedXpath}`);
    if (resp.pickedText) bits.push(`text="${resp.pickedText.slice(0, 80)}"`);
    parts.push(`User picked an element on the page: ${bits.join(', ')}.`);
    // 禁用态是"点了没反应"最常见的成因。不明确告知模型，它会反复点同一个元素并把失败
    // 归因成"选错了按钮"，进而去猜别的元素 —— 而真正的问题在前置条件（表单没填完等）。
    if (resp.pickedDisabled) {
      parts.push(
        'NOTE: that element is currently disabled (disabled/aria-disabled). Clicking it will do nothing — satisfy its precondition first (e.g. fill the required input) instead of picking another element.',
      );
    }
  }
  if (!parts.length) return 'User answered with no content.';
  return parts.join(' ');
}
