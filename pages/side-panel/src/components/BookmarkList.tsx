/* eslint-disable react/prop-types */
import { useState, useRef, useEffect } from 'react';
import { FaTrash, FaPen, FaCheck, FaTimes, FaPlay } from 'react-icons/fa';
import { t } from '@extension/i18n';

interface Bookmark {
  id: number;
  title: string;
  content: string;
  /** 有值表示这是工作流书签：点击直接执行，而不是把文本填进输入框。 */
  workflowId?: string;
}

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onBookmarkSelect: (content: string) => void;
  /**
   * 点击工作流书签时调用。不传时工作流书签退化成普通书签（点击填入说明文字），
   * 这样两个渲染点里只有需要执行能力的那个必须接线。
   */
  onWorkflowExecute?: (workflowId: string) => void;
  onBookmarkUpdateTitle?: (id: number, title: string) => void;
  onBookmarkDelete?: (id: number) => void;
  onBookmarkReorder?: (draggedId: number, targetId: number) => void;
  isDarkMode?: boolean;
}

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
  onWorkflowExecute,
  onBookmarkUpdateTitle,
  onBookmarkDelete,
  onBookmarkReorder,
  isDarkMode = false,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEditClick = (b: Bookmark) => {
    setEditingId(b.id);
    setEditTitle(b.title);
  };
  const handleSaveEdit = (id: number) => {
    if (onBookmarkUpdateTitle && editTitle.trim()) onBookmarkUpdateTitle(id, editTitle);
    setEditingId(null);
  };
  const handleCancelEdit = () => setEditingId(null);

  // 工作流书签点击 = 一键执行；没接执行回调时退回填入文本，不做静默无响应的按钮
  const handleActivate = (b: Bookmark) => {
    if (b.workflowId && onWorkflowExecute) {
      onWorkflowExecute(b.workflowId);
      return;
    }
    onBookmarkSelect(b.content);
  };

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    e.currentTarget.classList.add('dragging');
  };
  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('dragging');
    setDraggedId(null);
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId !== null && draggedId !== targetId && onBookmarkReorder) onBookmarkReorder(draggedId, targetId);
  };

  useEffect(() => {
    if (editingId !== null && inputRef.current) inputRef.current.focus();
  }, [editingId]);

  return (
    <div className="p-3">
      <h3 className="mb-4 text-sm font-semibold tracking-wide" style={{ color: `var(--text-primary)` }}>
        {t('chat_bookmarks_header')}
      </h3>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {bookmarks.map(bookmark => (
          <div
            key={bookmark.id}
            draggable={editingId !== bookmark.id}
            onDragStart={e => handleDragStart(e, bookmark.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, bookmark.id)}
            className="bookmark-scroll group relative">
            {editingId === bookmark.id ? (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="jade-input grow rounded-lg px-3 py-1.5 text-xs"
                />
                <button onClick={() => handleSaveEdit(bookmark.id)} className="icon-btn !text-green-500">
                  <FaCheck size={12} />
                </button>
                <button onClick={handleCancelEdit} className="icon-btn !text-red-400">
                  <FaTimes size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleActivate(bookmark)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') handleActivate(bookmark);
                }}
                title={bookmark.workflowId ? t('chat_bookmarks_runWorkflow', [bookmark.title]) : bookmark.content}
                className="relative z-[1] w-full text-left py-0.5">
                <div
                  className="flex min-w-0 items-center gap-1.5 pr-8 text-sm font-medium"
                  style={{ color: `var(--text-primary)` }}>
                  {/* 工作流书签点了就直接跑，和「填入输入框」的提示词书签行为不同，
                      必须在点之前就能看出来 */}
                  {bookmark.workflowId && (
                    <FaPlay size={9} className="shrink-0" style={{ color: `var(--accent-color)` }} aria-hidden="true" />
                  )}
                  <span className="truncate">{bookmark.title}</span>
                </div>
              </button>
            )}
            {editingId !== bookmark.id && (
              <>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    handleEditClick(bookmark);
                  }}
                  className="icon-btn absolute right-7 top-3 opacity-0 group-hover:opacity-100 z-10"
                  style={{ color: `var(--accent-color)` }}
                  aria-label={t('chat_bookmarks_edit')}
                  type="button">
                  <FaPen size={11} />
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (onBookmarkDelete) onBookmarkDelete(bookmark.id);
                  }}
                  className="icon-btn absolute right-2 top-3 opacity-0 group-hover:opacity-100 z-10"
                  aria-label={t('chat_bookmarks_delete')}
                  type="button">
                  <FaTrash size={11} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {bookmarks.length === 0 && (
        <div className="empty-state mt-4 text-sm">{t('chat_history_empty') || '暂无收藏'}</div>
      )}
    </div>
  );
};

export default BookmarkList;
