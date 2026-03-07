import { useState } from 'react';
import type { SessionSummary } from '../types.js';
import { SessionContextMenu } from './SessionContextMenu.js';

interface CommandPaletteProps {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  isOpen: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  filteredSessions: SessionSummary[];
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  inputRef: React.Ref<HTMLInputElement>;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onRestartSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${day} ${month}`;
}

export function CommandPalette({
  currentSessionId,
  isOpen,
  query,
  onQueryChange,
  filteredSessions,
  activeIndex,
  onActiveIndexChange,
  inputRef,
  onKeyDown,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onRestartSession,
  onDeleteSession,
  onClose,
}: CommandPaletteProps) {
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenuTarget, setContextMenuTarget] = useState<{
    sessionId: string;
    rect: DOMRect;
  } | null>(null);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (renamingSessionId) return;
      if (activeIndex < filteredSessions.length) {
        onSelectSession(filteredSessions[activeIndex].id);
        onClose();
      } else {
        onNewSession();
        onClose();
      }
      return;
    }
    onKeyDown(e);
  };

  const commitRename = (sessionId: string, value: string) => {
    if (value.trim()) {
      onRenameSession(sessionId, value.trim());
    }
    setRenamingSessionId(null);
    setRenameValue('');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 animate-fade-in"
        onClick={onClose}
      />

      {/* Centering wrapper */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] pointer-events-none">
        {/* Modal card */}
        <div
          className="w-full max-w-md bg-devai-surface border border-devai-border rounded-xl shadow-2xl overflow-hidden animate-scale-in mx-4 pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input area */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-devai-border bg-devai-bg">
            <svg
              className="w-4 h-4 text-devai-text-muted shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="text-sm text-devai-text bg-transparent outline-none flex-1 placeholder:text-devai-text-muted"
              placeholder="Search sessions..."
            />
          </div>

          {/* Session list */}
          <div className="max-h-[50vh] overflow-y-auto">
            {filteredSessions.map((session, index) => (
              <div
                key={session.id}
                className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors text-sm ${
                  activeIndex === index ? 'bg-devai-card' : 'hover:bg-devai-card/50'
                }`}
                onClick={() => {
                  onSelectSession(session.id);
                  onClose();
                }}
                onMouseEnter={() => onActiveIndexChange(index)}
              >
                {/* Accent dot for current session */}
                {session.id === currentSessionId ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-devai-accent shrink-0" />
                ) : (
                  <div className="w-1.5 h-1.5 shrink-0" />
                )}

                {/* Title or inline rename input */}
                {renamingSessionId === session.id ? (
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename(session.id, renameValue);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setRenamingSessionId(null);
                        setRenameValue('');
                      }
                    }}
                    onBlur={() => commitRename(session.id, renameValue)}
                    className="text-devai-text bg-transparent outline-none flex-1 min-w-0 text-sm border-b border-devai-accent"
                  />
                ) : (
                  <span className="text-devai-text truncate flex-1 min-w-0">
                    {session.title || session.id.slice(0, 8)}
                  </span>
                )}

                {/* Date */}
                <span className="text-[11px] text-devai-text-muted shrink-0">
                  {formatDate(session.lastUsedAt || session.createdAt)}
                </span>

                {/* Ellipsis button */}
                <button
                  className="p-1 text-devai-text-muted hover:text-devai-text rounded transition-colors shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setContextMenuTarget({ sessionId: session.id, rect });
                  }}
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="5" cy="12" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="19" cy="12" r="2" />
                  </svg>
                </button>
              </div>
            ))}

            {/* New Session row */}
            <div
              className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors text-sm ${
                activeIndex === filteredSessions.length ? 'bg-devai-card' : 'hover:bg-devai-card/50'
              }`}
              onClick={() => {
                onNewSession();
                onClose();
              }}
              onMouseEnter={() => onActiveIndexChange(filteredSessions.length)}
            >
              <svg
                className="w-4 h-4 text-devai-accent shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span className="text-devai-accent">New Session</span>
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenuTarget && (
        <SessionContextMenu
          sessionId={contextMenuTarget.sessionId}
          anchorRect={contextMenuTarget.rect}
          onRename={() => {
            const session = filteredSessions.find(
              (s) => s.id === contextMenuTarget.sessionId,
            );
            setRenamingSessionId(contextMenuTarget.sessionId);
            setRenameValue(session?.title || '');
            setContextMenuTarget(null);
          }}
          onRestart={() => {
            onRestartSession(contextMenuTarget.sessionId);
            setContextMenuTarget(null);
            onClose();
          }}
          onDelete={() => {
            onDeleteSession(contextMenuTarget.sessionId);
            setContextMenuTarget(null);
          }}
          onClose={() => setContextMenuTarget(null)}
        />
      )}
    </>
  );
}
