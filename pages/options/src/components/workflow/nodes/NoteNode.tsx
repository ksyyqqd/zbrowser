import { memo, useEffect, useRef, useState } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { FiFileText } from 'react-icons/fi';
import type { FlowNode } from '../types';
import { areNodePropsEqual } from './statusOverlay';

/**
 * Note (sticky) node — display-only.
 * No execution semantics, no handles. Skipped by the executor entirely.
 *
 * Editing:
 *  - Double-click anywhere on the note body to enter inline edit mode.
 *  - Blur or Escape to exit. Esc reverts; blur commits the current text.
 *  - The textarea has `nodrag` so React Flow doesn't steal mouse drag while
 *    the user is selecting/typing inside it.
 *  - Pressing Enter inserts a newline (multi-line notes), not exit.
 */
const COLOR_MAP: Record<string, { bg: string; border: string; text: string }> = {
  yellow: { bg: '#fef9c3', border: '#facc15', text: '#713f12' },
  blue: { bg: '#dbeafe', border: '#60a5fa', text: '#1e3a8a' },
  green: { bg: '#dcfce7', border: '#4ade80', text: '#14532d' },
  pink: { bg: '#fce7f3', border: '#f472b6', text: '#831843' },
  gray: { bg: '#f1f5f9', border: '#94a3b8', text: '#1e293b' },
};

function NoteNodeImpl({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData } = useReactFlow();
  const colorKey = (data.noteColor as string) || 'yellow';
  const palette = COLOR_MAP[colorKey] || COLOR_MAP.yellow;
  const content = (data.content as string) || '';
  const width = (data.noteWidth as number | undefined) ?? 220;
  const height = (data.noteHeight as number | undefined) ?? 120;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Whenever we enter edit mode, mirror the latest committed content into the
  // draft so external changes (e.g. edits via the side panel) aren't lost.
  useEffect(() => {
    if (!editing) return;
    setDraft(content);
    // Defer focus until React has actually mounted the textarea
    const t = setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [editing, content]);

  const commit = () => {
    if (draft !== content) {
      updateNodeData(id, { content: draft });
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(content);
    setEditing(false);
  };

  return (
    <div
      className="rounded-md transition-shadow"
      style={{
        width,
        minHeight: height,
        background: palette.bg,
        borderLeft: `4px solid ${palette.border}`,
        boxShadow: selected ? `0 0 0 2px #60a5fa, 0 4px 12px rgba(0,0,0,0.12)` : `0 1px 4px rgba(0,0,0,0.08)`,
        color: palette.text,
      }}
      onDoubleClick={() => setEditing(true)}>
      <div className="flex items-center gap-1.5 border-b border-current/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide opacity-60">
        <FiFileText className="size-3" />
        <span>{(data.name as string) || '备注'}</span>
        {editing && (
          <span className="ml-auto rounded bg-current/10 px-1 py-px text-[9px] normal-case">编辑中 · Esc 取消</span>
        )}
      </div>
      {editing ? (
        <textarea
          ref={textareaRef}
          // nodrag + nopan ensure React Flow doesn't intercept mouse events
          // while the user is selecting / scrolling inside the textarea.
          className="nodrag nopan m-0 block w-full resize-none border-0 bg-transparent p-2.5 text-xs leading-relaxed outline-none"
          style={{
            color: palette.text,
            // Match the <pre> intrinsic sizing so the layout doesn't jump.
            minHeight: Math.max(0, height - 28),
            fontFamily: 'inherit',
          }}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
            // Stop key events bubbling so they don't trigger global hotkeys
            // (delete, ctrl+c/v, undo) defined on the canvas.
            e.stopPropagation();
          }}
          placeholder="输入备注内容…(Enter 换行,Esc 取消)"
        />
      ) : content ? (
        <pre
          className="m-0 whitespace-pre-wrap break-words p-2.5 text-xs leading-relaxed"
          style={{ fontFamily: 'inherit' }}>
          {content}
        </pre>
      ) : (
        <p className="m-0 p-2.5 text-xs italic opacity-50">双击进入编辑…</p>
      )}
    </div>
  );
}

export const NoteNode = memo(NoteNodeImpl, areNodePropsEqual);
