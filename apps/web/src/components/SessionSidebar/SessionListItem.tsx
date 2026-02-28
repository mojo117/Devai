import type { SessionRegistryEntry } from '../ChatUI/hooks/useSessionRegistry';

interface SessionListItemProps {
  session: SessionRegistryEntry;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'jetzt';
  if (minutes < 60) return `vor ${minutes}m`;
  if (hours < 24) return `vor ${hours}h`;
  if (days < 7) return `vor ${days}d`;
  return new Date(timestamp).toLocaleDateString('de-DE');
}

function getTitle(session: SessionRegistryEntry): string {
  if (session.title) return session.title;
  if (session.messages.length > 0) {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      const preview = firstUserMsg.content.slice(0, 40);
      return preview.length < firstUserMsg.content.length ? `${preview}...` : preview;
    }
  }
  return 'Neuer Chat';
}

export function SessionListItem({ session, isActive, onSelect, onDelete }: SessionListItemProps) {
  const title = getTitle(session);

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
        isActive
          ? 'bg-devai-accent/15 border border-devai-accent/30'
          : 'hover:bg-devai-card border border-transparent'
      }`}
      onClick={() => onSelect(session.id)}
    >
      {/* Active indicator */}
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isActive ? 'bg-devai-accent' : session.hasUnread ? 'bg-blue-400' : 'bg-devai-text-muted/30'
        }`}
      />

      {/* Title and time */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isActive ? 'text-devai-text font-medium' : 'text-devai-text-secondary'}`}>
          {title}
        </p>
        <p className="text-[10px] text-devai-text-muted">
          {formatRelativeTime(session.lastActivity || new Date(session.createdAt).getTime())}
        </p>
      </div>

      {/* Unread badge */}
      {session.hasUnread && !isActive && (
        <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
      )}

      {/* Loading indicator */}
      {session.isLoading && (
        <svg className="w-3 h-3 animate-spin text-devai-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}

      {/* Delete button (optional) */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(session.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-devai-text-muted hover:text-red-400 transition-all flex-shrink-0"
          title="Löschen"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
