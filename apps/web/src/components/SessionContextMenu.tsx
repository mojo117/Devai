import { useEffect, useRef, useState } from 'react';
import { useClickOutside } from '../hooks/useClickOutside.js';

interface SessionContextMenuProps {
  sessionId: string;
  anchorRect: DOMRect | null;
  onRename: () => void;
  onRestart: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 176; // w-44 = 11rem = 176px

export function SessionContextMenu({
  sessionId,
  anchorRect,
  onRename,
  onRestart,
  onDelete,
  onClose,
}: SessionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useClickOutside(menuRef, onClose, anchorRect !== null);

  // Close on Escape
  useEffect(() => {
    if (!anchorRect) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [anchorRect, onClose]);

  // Reset delete confirmation when menu reopens for a different session
  useEffect(() => {
    setConfirmingDelete(false);
  }, [sessionId]);

  if (!anchorRect) return null;

  // Calculate position with viewport overflow detection
  const menuHeight = confirmingDelete ? 80 : 130; // approximate heights
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  const goesBelow = anchorRect.bottom + 4 + menuHeight > viewportHeight;
  const top = goesBelow
    ? anchorRect.top - menuHeight - 4
    : anchorRect.bottom + 4;

  const left = Math.min(anchorRect.left, viewportWidth - MENU_WIDTH - 8);

  const itemClass =
    'flex items-center gap-2 px-3 py-2 text-xs cursor-pointer rounded transition-colors';

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-44 bg-devai-surface border border-devai-border rounded-lg shadow-xl py-1"
      style={{ top, left }}
    >
      {confirmingDelete ? (
        <div className="px-3 py-2">
          <p className="text-xs text-devai-text-secondary mb-3">
            Delete this session?
          </p>
          <div className="flex items-center gap-2 justify-end">
            <button
              className="text-xs text-devai-text-secondary px-2 py-1 rounded transition-colors hover:text-devai-text cursor-pointer"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
            <button
              className="text-xs text-red-400 bg-red-400/10 px-2 py-1 rounded transition-colors hover:bg-red-400/20 cursor-pointer"
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Rename */}
          <div
            className={`${itemClass} text-devai-text hover:bg-devai-card`}
            onClick={() => {
              onRename();
              onClose();
            }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            Rename
          </div>

          {/* Restart */}
          <div
            className={`${itemClass} text-devai-text hover:bg-devai-card`}
            onClick={() => {
              onRestart();
              onClose();
            }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h5M20 20v-5h-5M5.5 15.5A7.5 7.5 0 0112 4.5c2.76 0 5.2 1.49 6.5 3.72M18.5 8.5A7.5 7.5 0 0112 19.5c-2.76 0-5.2-1.49-6.5-3.72"
              />
            </svg>
            Restart
          </div>

          {/* Divider */}
          <div className="border-t border-devai-border my-1" />

          {/* Delete */}
          <div
            className={`${itemClass} text-red-400 hover:bg-red-400/10`}
            onClick={() => setConfirmingDelete(true)}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Delete
          </div>
        </>
      )}
    </div>
  );
}
