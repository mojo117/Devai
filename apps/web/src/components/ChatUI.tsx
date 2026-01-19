import { useState, useRef, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { sendMessage, fetchSessions, createSession, fetchSessionMessages, fetchSetting, saveSetting, updateSessionTitle } from '../api';
import type { ChatMessage, LLMProvider, SessionSummary } from '../types';

interface ToolEvent {
  id: string;
  type: 'status' | 'tool_call' | 'tool_result';
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
}

interface ToolEventUpdate {
  type: ToolEvent['type'];
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
  chunk?: string;
}

interface ChatUIProps {
  provider: LLMProvider;
  projectRoot?: string | null;
  skillIds?: string[];
}

export function ChatUI({ provider, projectRoot, skillIds }: ChatUIProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const planItems = extractPlanItems(messages);

  const refreshSessions = async (selectId?: string | null) => {
    const sessionList = await fetchSessions();
    setSessions(sessionList.sessions);
    const targetId = selectId || sessionList.sessions[0]?.id || null;
    if (targetId) {
      setSessionId(targetId);
      const history = await fetchSessionMessages(targetId);
      setMessages(history.messages);
    } else {
      setSessionId(null);
      setMessages([]);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setSessionsLoading(true);
      try {
        const stored = await fetchSetting('lastSessionId');
        const storedId = typeof stored.value === 'string' ? stored.value : null;
        await refreshSessions(storedId);
      } catch {
        // Ignore load errors for now.
      } finally {
        if (isMounted) {
          setSessionsLoading(false);
        }
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setToolEvents([]);

    try {
      const response = await sendMessage(
        [...messages, userMessage],
        provider,
        projectRoot || undefined,
        skillIds,
        sessionId || undefined,
        (event) => {
          if (event.type === 'status') {
            setToolEvents((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                type: 'status',
                result: event.status,
              },
            ]);
          }
          if (event.type === 'tool_call') {
            const id = String(event.id || crypto.randomUUID());
            upsertToolEvent(setToolEvents, id, {
              type: 'tool_call',
              name: event.name as string | undefined,
              arguments: event.arguments,
            });
          }
          if (event.type === 'tool_result_chunk') {
            const id = String(event.id || crypto.randomUUID());
            const chunk = typeof event.chunk === 'string' ? event.chunk : '';
            upsertToolEvent(setToolEvents, id, {
              type: 'tool_result',
              name: event.name as string | undefined,
              chunk,
            });
          }
          if (event.type === 'tool_result') {
            const id = String(event.id || crypto.randomUUID());
            upsertToolEvent(setToolEvents, id, {
              type: 'tool_result',
              name: event.name as string | undefined,
              result: event.result,
              completed: Boolean(event.completed),
            });
          }
        }
      );
      if (response.sessionId) {
        setSessionId(response.sessionId);
        await saveSetting('lastSessionId', response.sessionId);
      }
      setMessages((prev) => [...prev, response.message]);
      await refreshSessions(response.sessionId);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = async () => {
    setSessionsLoading(true);
    try {
      const response = await createSession();
      await saveSetting('lastSessionId', response.session.id);
      await refreshSessions(response.session.id);
    } catch {
      // Ignore create errors for now.
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleSelectSession = async (selectedId: string) => {
    setSessionsLoading(true);
    try {
      await saveSetting('lastSessionId', selectedId);
      await refreshSessions(selectedId);
    } catch {
      // Ignore select errors for now.
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleRestartChat = async () => {
    if (messages.length === 0) {
      // No messages to save, just create new session
      await handleNewChat();
      return;
    }

    setSessionsLoading(true);
    try {
      // Mark the current session as restarted if it has messages
      if (sessionId) {
        const currentSession = sessions.find((s) => s.id === sessionId);
        const currentTitle = currentSession?.title || 'Untitled';
        const timestamp = new Date().toLocaleString();
        await updateSessionTitle(sessionId, `[Restarted ${timestamp}] ${currentTitle}`);
      }

      // Create a new session
      const response = await createSession();
      await saveSetting('lastSessionId', response.session.id);
      await refreshSessions(response.session.id);
      setToolEvents([]);
    } catch {
      // Ignore restart errors for now.
    } finally {
      setSessionsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <span>Session</span>
            <select
              value={sessionId || ''}
              onChange={(e) => handleSelectSession(e.target.value)}
              disabled={sessionsLoading || sessions.length === 0}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
            >
              {sessions.length === 0 && (
                <option value="">No sessions</option>
              )}
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title ? session.title : session.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRestartChat}
              disabled={sessionsLoading || messages.length === 0}
              className="text-[11px] text-orange-400 hover:text-orange-300 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Save current conversation to history and start fresh"
            >
              {sessionsLoading ? 'Loading...' : 'Restart Chat'}
            </button>
            <button
              onClick={handleNewChat}
              disabled={sessionsLoading}
              className="text-[11px] text-gray-300 hover:text-white disabled:opacity-50"
            >
              {sessionsLoading ? 'Loading...' : 'New Chat'}
            </button>
          </div>
        </div>

        {toolEvents.length > 0 && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs text-gray-200">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">
              Tool Activity
            </div>
            <div className="space-y-2">
              {toolEvents.map((event) => (
                <div key={event.id} className="bg-gray-800 rounded p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 uppercase text-[10px]">{event.type}</span>
                    {event.name && (
                      <span className="text-blue-300 font-mono text-[11px]">{event.name}</span>
                    )}
                  </div>
                  {event.type === 'status' && (
                    <p className="text-[11px] text-gray-300 mt-1">{String(event.result)}</p>
                  )}
                  {event.type === 'tool_call' && event.arguments !== undefined && (
                    <pre className="text-[11px] text-gray-300 mt-2 bg-gray-950 rounded p-2 overflow-x-auto">
                      {formatToolPayload(event.arguments)}
                    </pre>
                  )}
                  {event.type === 'tool_result' && event.result !== undefined && (
                    <pre className="text-[11px] text-gray-300 mt-2 bg-gray-950 rounded p-2 overflow-x-auto">
                      {formatToolPayload(event.result)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {planItems.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200">
            <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">
              Active Plan
            </div>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              {planItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        )}

        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-lg">Welcome to DevAI</p>
            <p className="text-sm mt-2">
              Start a conversation to get help with your code.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-100'
              }`}
            >
              {renderMessageContent(message.content)}
              <p className="text-xs opacity-50 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-700 rounded-lg px-4 py-2">
              <div className="flex space-x-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-700 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function renderMessageContent(content: string) {
  if (!content.includes('```')) {
    return <p className="whitespace-pre-wrap">{content}</p>;
  }

  const segments = content.split('```');

  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        if (index % 2 === 1) {
          const lines = segment.split('\n');
          let language = '';
          if (lines.length > 1 && /^[a-zA-Z0-9+-]+$/.test(lines[0].trim())) {
            language = lines.shift() || '';
          }
          const code = lines.join('\n');
          return (
            <div key={`code-${index}`} className="bg-gray-900 rounded">
              {language && (
                <div className="px-2 py-1 text-[10px] text-gray-400 border-b border-gray-700 uppercase tracking-wide">
                  {language}
                </div>
              )}
              <pre className="text-xs p-2 overflow-x-auto font-mono text-gray-200 whitespace-pre-wrap">
                {code}
              </pre>
            </div>
          );
        }

        if (!segment.trim()) {
          return null;
        }

        return (
          <p key={`text-${index}`} className="whitespace-pre-wrap">
            {segment}
          </p>
        );
      })}
    </div>
  );
}

function extractPlanItems(messages: ChatMessage[]): string[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    const lines = message.content.split('\n').map((line) => line.trim());
    const planStart = lines.findIndex((line) => line.toLowerCase().startsWith('plan'));
    if (planStart === -1) continue;

    const planLines = lines.slice(planStart + 1).filter(Boolean);
    const items = planLines
      .map((line) => line.replace(/^[\-\d\.\)\s]+/, '').trim())
      .filter(Boolean);

    if (items.length > 0) {
      return items;
    }
  }
  return [];
}

function upsertToolEvent(
  setToolEvents: Dispatch<SetStateAction<ToolEvent[]>>,
  id: string,
  update: ToolEventUpdate
) {
  setToolEvents((prev) => {
    const index = prev.findIndex((event) => event.id === id);
    if (index === -1) {
      const initial: ToolEvent = {
        id,
        type: update.type,
        name: update.name,
        arguments: update.arguments,
        result: update.chunk || update.result,
        completed: update.completed,
      };
      return [...prev, initial];
    }

    const existing = prev[index];
    const next: ToolEvent = {
      ...existing,
      type: update.type ?? existing.type,
      name: update.name ?? existing.name,
      arguments: update.arguments ?? existing.arguments,
      completed: update.completed ?? existing.completed,
      result: update.result ?? existing.result,
    };

    if (update.chunk) {
      const current = typeof existing.result === 'string' ? existing.result : '';
      next.result = current + update.chunk;
    }

    const copy = [...prev];
    copy[index] = next;
    return copy;
  });
}

function formatToolPayload(payload: unknown): string {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    if (text.length > 400) {
      return `${text.slice(0, 400)}\n...`;
    }
    return text;
  } catch {
    return String(payload);
  }
}
