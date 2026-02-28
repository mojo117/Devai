import { useEffect, useCallback } from 'react';
import type { SessionRegistryEntry } from '../ChatUI/hooks/useSessionRegistry';
import { SessionListItem } from './SessionListItem';

interface SessionSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: Map<string, SessionRegistryEntry>;
  sessionOrder: Array<{ id: string; title: string | null; createdAt: string }>;
  activeSessionId: string | null;
  isLoading: boolean;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession?: (id: string) => void;
}

export function SessionSidebar({
  isOpen,
  onClose,
  sessions,
  sessionOrder,
  activeSessionId,
  isLoading,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SessionSidebarProps) {
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Sort sessions by last activity (most recent first)
  const sortedSessions = useCallback(() => {
    return sessionOrder
      .map(s => sessions.get(s.id))
      .filter((s): s is SessionRegistryEntry => !!s)
      .sort((a, b) => {
        // Active session always first
        if (a.id === activeSessionId) return -1;
        if (b.id === activeSessionId) return 1;
        // Then by lastActivity
        const aTime = a.lastActivity || new Date(a.createdAt).getTime();
        const bTime = b.lastActivity || new Date(b.createdAt).getTime();
        return bTime - aTime;
      });
  }, [sessions, sessionOrder, activeSessionId]);

  const sessionList = sortedSessions();

  // Desktop sidebar (always visible on md+)
  const sidebarContent = (
    <div className="flex flex-col h-full bg-devai-surface border-r border-devai-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-devai-border">
        <h2 className="text-sm font-semibold text-devai-text">Sessions</h2>
        <button
          onClick={onCreateSession}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-devai-accent text-white hover:bg-devai-accent-hover disabled:opacity-50 transition-colors"
          title="Neue Session"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">Neu</span>
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && sessionList.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <svg className="w-5 h-5 animate-spin text-devai-text-muted" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : sessionList.length === 0 ? (
          <div className="text-center py-8 text-xs text-devai-text-muted">
            Keine Sessions vorhanden
          </div>
        ) : (
          sessionList.map((session) => (
            <SessionListItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={onSelectSession}
              onDelete={onDeleteSession}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-devai-border text-[10px] text-devai-text-muted">
        {sessionList.length} Session{sessionList.length !== 1 ? 's' : ''}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: Fixed sidebar */}
      <div className="hidden md:block w-60 lg:w-72 flex-shrink-0 h-full">
        {sidebarContent}
      </div>

      {/* Mobile: Slide-over panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 bg-black/40 z-40"
            onClick={onClose}
          />
          
          {/* Panel */}
          <div className="md:hidden fixed inset-y-0 left-0 w-72 z-50 shadow-2xl">
            {/* Close button for mobile */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1.5 text-devai-text-muted hover:text-devai-text transition-colors z-10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {sidebarContent}
          </div>
        </>
      )}
    </>
  );
}
