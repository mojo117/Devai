import { useEffect, useState } from 'react';
import { fetchSessions, fetchSessionMessages } from '../api';
import type { ChatMessage, SessionSummary } from '../types';

export function HistoryPanelContent() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const sessionList = await fetchSessions();
        if (!isMounted) return;
        setSessions(sessionList.sessions);
        if (sessionList.sessions.length > 0) {
          const first = sessionList.sessions[0];
          setSelectedSessionId(first.id);
          const history = await fetchSessionMessages(first.id);
          if (!isMounted) return;
          setMessages(history.messages);
        } else {
          setSelectedSessionId(null);
          setMessages([]);
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelect = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setLoading(true);
    setError(null);
    try {
      const history = await fetchSessionMessages(sessionId);
      setMessages(history.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-devai-text-secondary">History</h2>
        {loading && <span className="text-[10px] text-devai-text-muted">Loading...</span>}
      </div>

      {error && (
        <div className="text-xs text-red-300 mb-3">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {sessions.length === 0 && (
          <p className="text-xs text-devai-text-muted">No sessions yet.</p>
        )}
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => handleSelect(session.id)}
            className={`w-full text-left text-xs rounded px-2 py-2 ${
              selectedSessionId === session.id
                ? 'bg-devai-accent text-white'
                : 'bg-devai-bg text-devai-text-secondary hover:bg-devai-card'
            }`}
          >
            <div className="font-semibold">
              {session.title ? session.title : session.id.slice(0, 8)}
            </div>
            <div className="text-[10px] text-devai-text-muted">
              {new Date(session.createdAt).toLocaleString()}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-devai-border">
        <h3 className="text-xs uppercase tracking-wide text-devai-text-secondary mb-2">
          Messages
        </h3>
        {messages.length === 0 ? (
          <p className="text-xs text-devai-text-muted">No messages to display.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <div key={message.id} className="bg-devai-bg rounded p-2 text-xs text-devai-text">
                <div className="flex items-center justify-between text-[10px] text-devai-text-muted mb-1">
                  <span>{message.role}</span>
                  <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
