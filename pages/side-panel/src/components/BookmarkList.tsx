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
  const [editTitle, setEditTitle] = useState<string>('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEditClick = (bookmark: Bookmark) => {
    setEditingId(bookmark.id);
    setEditTitle(bookmark.title);
  };

  const handleSaveEdit = (id: number) => {
    if (onBookmarkUpdateTitle && editTitle.trim()) {
      onBookmarkUpdateTitle(id, editTitle);
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    e.currentTarget.classList.add('dragging');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('dragging');
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    if (onBookmarkReorder) {
      onBookmarkReorder(draggedId, targetId);
    }
  };

  // Focus the input field when entering edit mode
  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  return (
    <div className="p-3">
      <h3 className={`mb-4 text-sm font-semibold tracking-wide ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
        {t('chat_bookmarks_header')}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {bookmarks.map(bookmark => (
          <div
            key={bookmark.id}
            draggable={editingId !== bookmark.id}
            onDragStart={e => handleDragStart(e, bookmark.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, bookmark.id)}
            className={`bookmark-card group relative`}>
            {editingId === bookmark.id ? (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className={`cyber-input grow rounded-lg px-3 py-1.5 text-xs`}
                />
                <button
                  onClick={() => handleSaveEdit(bookmark.id)}
                  className="icon-btn !text-green-500 hover:!text-green-400"
                  aria-label={t('chat_bookmarks_saveEdit')}
                  type="button">
                  <FaCheck size={13} />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="icon-btn !text-red-400 hover:!text-red-300"
                  aria-label={t('chat_bookmarks_cancelEdit')}
                  type="button">
                  <FaTimes size={13} />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onBookmarkSelect(bookmark.content)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onBookmarkSelect(bookmark.content);
                    }
                  }}
                  className="w-full text-left z-[1] relative">
                  <div
                    className={`truncate pr-8 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    {bookmark.title}
                  </div>
                </button>
              </>
            )}

            {editingId !== bookmark.id && (
              <>
                {/* Edit button */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    handleEditClick(bookmark);
                  }}
                  className={`icon-btn absolute right-8 top-1/2 -translate-y-1/2 opacity-0 transition-all duration-200 group-hover:opacity-100 z-10 ${
                    isDarkMode ? '!text-cyber-primary' : '!text-neon-sky'
                  }`}
                  aria-label={t('chat_bookmarks_edit')}
                  type="button">
                  <FaPen size={12} />
                </button>

                {/* Delete button */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (onBookmarkDelete) {
                      onBookmarkDelete(bookmark.id);
                    }
                  }}
                  className={`icon-btn absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-all duration-200 group-hover:opacity-100 z-10`}
                  aria-label={t('chat_bookmarks_delete')}
                  type="button">
                  <FaTrash size={12} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Empty state */}
      {bookmarks.length === 0 && (
        <div className="empty-state mt-4 text-sm">
          <p>{t('chat_history_empty') || 'No bookmarks yet'}</p>
        </div>
      )}
    </div>
  );
};

export default BookmarkList;
