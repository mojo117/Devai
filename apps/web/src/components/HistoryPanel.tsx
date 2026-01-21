import { useEffect, useState } from 'react';
import { fetchSessions, fetchSessionMessages } from '../api';
import type { ChatMessage, SessionSummary } from '../types';

export function HistoryPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

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
    <div className="fixed right-0 top-[calc(50%+320px)] -translate-y-1/2 z-40">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute right-0 top-1/2 -translate-y-1/2 bg-purple-700 hover:bg-purple-600 text-gray-200 px-2 py-4 rounded-l-lg shadow-lg transition-all"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {isOpen ? '>' : '<'} History
      </button>

      <div
        className={`bg-gray-800 border-l border-gray-700 shadow-xl transition-all duration-300 overflow-hidden ${
          isOpen ? 'w-80' : 'w-0'
        }`}
      >
        <div className="w-80 h-screen overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-400">History</h2>
            {loading && <span className="text-[10px] text-gray-500">Loading...</span>}
          </div>

          {error && (
            <div className="text-xs text-red-300 mb-3">
              {error}
            </div>
          )}

          <div className="space-y-2">
            {sessions.length === 0 && (
              <p className="text-xs text-gray-500">No sessions yet.</p>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => handleSelect(session.id)}
                className={`w-full text-left text-xs rounded px-2 py-2 ${
                  selectedSessionId === session.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-900 text-gray-300 hover:bg-gray-700'
                }`}
              >
                <div className="font-semibold">
                  {session.title ? session.title : session.id.slice(0, 8)}
                </div>
                <div className="text-[10px] text-gray-400">
                  {new Date(session.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-700">
            <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-2">
              Messages
            </h3>
            {messages.length === 0 ? (
              <p className="text-xs text-gray-500">No messages to display.</p>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className="bg-gray-900 rounded p-2 text-xs text-gray-200">
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
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
      </div>
    </div>
  );
}
