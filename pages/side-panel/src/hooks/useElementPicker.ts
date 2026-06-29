/**
 * 元素拾取通用 hook
 *
 * 抽自 ClarifyDialog.handlePick / MarkElementDialog.handlePick——逻辑几乎一模一样：
 * runtime sendMessage('pick_element_start') → 注入页面 picker overlay → 等用户点击 → 拿
 * selector/xpath/text。
 *
 * 三个调用方共用：
 *  - ClarifyDialog（被动澄清，confidence 闸门触发）
 *  - MarkElementDialog（主动单个标记）
 *  - TeachingDialog（教导模式里"补充列表外的元素"）
 *
 * 拾取过程中 Agent 一直 pause；本 hook 不关心 pause/resume，只管 pick 流程。
 */

import { useState, useCallback } from 'react';

export type PickerPhase = 'idle' | 'picking' | 'picked' | 'error';

export type PickerState =
  | { phase: 'idle' }
  | { phase: 'picking' }
  | { phase: 'picked'; selector?: string; xpath?: string; text?: string }
  | { phase: 'error'; message: string };

export interface UseElementPickerResult {
  state: PickerState;
  /**
   * 触发拾取。若 tabId 为 null/undefined，自动取当前 active tab。
   * 用户在页面上 Esc → state 回 idle；任何其他失败 → state 变 error。
   */
  pick: (explicitTabId?: number | null) => Promise<void>;
  /** 重置到 idle（用户改主意/重新拾取） */
  reset: () => void;
}

export function useElementPicker(defaultTabId?: number | null): UseElementPickerResult {
  const [state, setState] = useState<PickerState>({ phase: 'idle' });

  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  const pick = useCallback(
    async (explicitTabId?: number | null) => {
      if (!chrome?.runtime || !chrome.tabs) {
        setState({ phase: 'error', message: '无法访问 chrome API' });
        return;
      }
      let tabId = explicitTabId ?? defaultTabId ?? null;
      if (typeof tabId !== 'number') {
        try {
          const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = active?.id ?? null;
        } catch {
          /* ignore */
        }
      }
      if (typeof tabId !== 'number') {
        setState({ phase: 'error', message: '找不到目标标签页' });
        return;
      }
      setState({ phase: 'picking' });
      try {
        const result: { success: boolean; selector?: string; xpath?: string; text?: string; error?: string } =
          await chrome.runtime.sendMessage({ type: 'pick_element_start', tabId });
        if (!result || !result.success) {
          if (result?.error === 'cancelled') {
            setState({ phase: 'idle' });
          } else {
            setState({ phase: 'error', message: result?.error || '拾取失败' });
          }
          return;
        }
        setState({
          phase: 'picked',
          selector: result.selector,
          xpath: result.xpath,
          text: result.text,
        });
      } catch (e) {
        setState({ phase: 'error', message: e instanceof Error ? e.message : '拾取失败' });
      }
    },
    [defaultTabId],
  );

  return { state, pick, reset };
}
