/* eslint-disable react/prop-types */
import { useState, useRef, useEffect } from 'react';
import { FaTrash, FaPen, FaCheck, FaTimes } from 'react-icons/fa';
import { t } from '@extension/i18n';

interface Bookmark {
  id: number;
  title: string;
  content: string;
}

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onBookmarkSelect: (content: string) => void;
  onBookmarkUpdateTitle?: (id: number, title: string) => void;
  onBookmarkDelete?: (id: number) => void;
  onBookmarkReorder?: (draggedId: number, targetId: number) => void;
  isDarkMode?: boolean;
}

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
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
                onClick={() => onBookmarkSelect(bookmark.content)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') onBookmarkSelect(bookmark.content);
                }}
                className="relative z-[1] w-full text-left py-0.5">
                <div className="truncate pr-8 text-sm font-medium" style={{ color: `var(--text-primary)` }}>
                  {bookmark.title}
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
