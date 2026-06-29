/**
 * 已引用元素的 chip：显示在 ChatInput textarea 上方一行。
 * 玉绿小药丸 + × 按钮 + hover tooltip 显示 xpath/text。
 */

import { FiX } from 'react-icons/fi';
import type { ElementRef } from '@src/types/elementRef';

interface RefChipProps {
  refItem: ElementRef;
  onRemove: () => void;
}

export function RefChip({ refItem, onRemove }: RefChipProps) {
  const tooltipParts: string[] = [];
  if (refItem.xpath) tooltipParts.push(`xpath: ${refItem.xpath}`);
  else if (refItem.selector) tooltipParts.push(`selector: ${refItem.selector}`);
  if (refItem.text) tooltipParts.push(`text: ${refItem.text.slice(0, 60)}`);
  const tooltip = tooltipParts.join('\n') || refItem.purpose;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
      style={{
        background: 'var(--accent-glow)',
        color: 'var(--accent-color)',
        border: '1px solid var(--spirit-border)',
      }}
      title={tooltip}>
      <span>@{refItem.label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex size-3.5 items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-card-hover)]"
        aria-label="移除引用"
        title="移除引用">
        <FiX size={10} />
      </button>
    </span>
  );
}
