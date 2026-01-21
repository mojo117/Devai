import { useState, useRef, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { sendMessage, fetchSessions, createSession, fetchSessionMessages, fetchSetting, saveSetting, updateSessionTitle, approveAction, rejectAction, globProjectFiles } from '../api';
import type { ChatMessage, ContextStats, LLMProvider, SessionSummary } from '../types';
import { InlineAction, type PendingAction } from './InlineAction';
import { PlanPanel } from './PlanPanel';

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
  allowedRoots?: string[];
  pinnedFiles?: string[];
  onPinFile?: (file: string) => void;
  onContextUpdate?: (stats: ContextStats) => void;
}

export function ChatUI({ provider, projectRoot, skillIds, allowedRoots, pinnedFiles, onPinFile, onContextUpdate }: ChatUIProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [fileHints, setFileHints] = useState<string[]>([]);
  const [fileHintsLoading, setFileHintsLoading] = useState(false);
  const [fileHintsError, setFileHintsError] = useState<string | null>(null);
  const [activeHintIndex, setActiveHintIndex] = useState(0);
  const [planApproved, setPlanApproved] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [retryState, setRetryState] = useState<null | {
    input: string;
    userMessage: ChatMessage;
    runRequest: () => Promise<{ message: ChatMessage; sessionId?: string } | null>;
  }>(null);
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

  useEffect(() => {
    if (!sessionId) {
      setPlanApproved(false);
      return;
    }
    if (planItems.length === 0) {
      setPlanApproved(false);
      return;
    }

    let cancelled = false;
    const loadPlanState = async () => {
      setPlanLoading(true);
      try {
        const key = `planState:${sessionId}`;
        const stored = await fetchSetting(key);
        const value = stored.value as { hash?: string; approved?: boolean } | null;
        if (cancelled) return;
        const currentHash = hashPlan(planItems);
        if (value && value.hash === currentHash && value.approved) {
          setPlanApproved(true);
        } else {
          setPlanApproved(false);
        }
      } catch {
        if (!cancelled) setPlanApproved(false);
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    };

    loadPlanState();
    return () => {
      cancelled = true;
    };
  }, [sessionId, planItems]);

  useEffect(() => {
    const token = extractAtToken(input);
    if (!token) {
      setFileHints([]);
      setFileHintsError(null);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setFileHintsLoading(true);
      setFileHintsError(null);
      try {
        const basePath = allowedRoots && allowedRoots.length > 0 ? allowedRoots[0] : undefined;
        const safeToken = escapeGlob(token.value);
        const pattern = `**/*${safeToken}*`;
        const data = await globProjectFiles(pattern, basePath);
        if (cancelled) return;
        const files = data.files.slice(0, 20);
        setFileHints(files);
        setActiveHintIndex(0);
      } catch (err) {
        if (cancelled) return;
        setFileHints([]);
        setFileHintsError(err instanceof Error ? err.message : 'Failed to load file hints');
      } finally {
        if (!cancelled) setFileHintsLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [input, allowedRoots]);

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
    const originalInput = input;
    setInput('');
    setIsLoading(true);
    setToolEvents([]);
    setFileHints([]);

    const runRequest = async (): Promise<{ message: ChatMessage; sessionId?: string } | null> => {
      const response = await sendMessage(
        [...messages, userMessage],
        provider,
        projectRoot || undefined,
        skillIds,
        pinnedFiles,
        planApproved,
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
          if (event.type === 'action_pending') {
            const pendingAction: PendingAction = {
              actionId: event.actionId as string,
              toolName: event.toolName as string,
              toolArgs: event.toolArgs as Record<string, unknown>,
              description: event.description as string,
              preview: event.preview as PendingAction['preview'],
            };
            setPendingActions((prev) => [...prev, pendingAction]);
          }
          if (event.type === 'context_stats' && onContextUpdate) {
            const stats = event.stats as ContextStats | undefined;
            if (stats) {
              onContextUpdate(stats);
            }
          }
        }
      );
      if (response.contextStats && onContextUpdate) {
        onContextUpdate(response.contextStats);
      }
      if (response.sessionId) {
        setSessionId(response.sessionId);
        await saveSetting('lastSessionId', response.sessionId);
      }
      setMessages((prev) => [...prev, response.message]);
      await refreshSessions(response.sessionId);
      return { message: response.message, sessionId: response.sessionId };
    };

    try {
      await runRequest();
      setRetryState(null);
    } catch (error) {
      const err = error instanceof Error ? error.message : 'Unknown error';
      const shouldRetry = /network|fetch|timeout|503|502|504|tempor/i.test(err);

      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err}${shouldRetry ? '\\n\\nYou can retry the last message below.' : ''}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);

      if (shouldRetry) {
        setRetryState({
          input: originalInput,
          userMessage,
          runRequest,
        });
      } else {
        setRetryState(null);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!retryState) return;
    setIsLoading(true);
    setToolEvents([]);
    try {
      await retryState.runRequest();
      setRetryState(null);
    } catch (error) {
      const err = error instanceof Error ? error.message : 'Unknown error';
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err}`,
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

  const handlePickHint = (hint: string) => {
    const token = extractAtToken(input);
    if (!token) return;
    const before = input.slice(0, token.start);
    const after = input.slice(token.end);
    const next = `${before}@${hint} ${after}`.replace(/\s{2,}/g, ' ');
    setInput(next);
    setFileHints([]);
    if (onPinFile) {
      onPinFile(hint);
    }
  };

  const handleApprovePlan = async () => {
    if (!sessionId || planItems.length === 0) return;
    const key = `planState:${sessionId}`;
    const payload = { hash: hashPlan(planItems), approved: true };
    setPlanApproved(true);
    await saveSetting(key, payload);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (fileHints.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveHintIndex((prev) => (prev + 1) % fileHints.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveHintIndex((prev) => (prev - 1 + fileHints.length) % fileHints.length);
    } else if (e.key === 'Enter') {
      const token = extractAtToken(input);
      if (token && fileHints[activeHintIndex]) {
        e.preventDefault();
        handlePickHint(fileHints[activeHintIndex]);
      }
    } else if (e.key === 'Escape') {
      setFileHints([]);
    }
  };

  const handleApproveAction = async (actionId: string) => {
    const pendingAction = pendingActions.find((a) => a.actionId === actionId);
    const response = await approveAction(actionId);

    // Add result to chat as a message
    const resultMessage: ChatMessage = {
      id: `action-result-${actionId}`,
      role: 'assistant',
      content: response.action.error
        ? `**Action failed:** ${pendingAction?.description || response.action.toolName}\n\nError: ${response.action.error}`
        : `**Action completed:** ${pendingAction?.description || response.action.toolName}\n\n${response.result ? '```json\n' + JSON.stringify(response.result, null, 2) + '\n```' : 'Success'}`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, resultMessage]);

    // Remove from pending list after a short delay to show the approved state
    setTimeout(() => {
      setPendingActions((prev) => prev.filter((a) => a.actionId !== actionId));
    }, 1000);
  };

  const handleRejectAction = async (actionId: string) => {
    const pendingAction = pendingActions.find((a) => a.actionId === actionId);
    await rejectAction(actionId);

    // Add rejection to chat
    const rejectMessage: ChatMessage = {
      id: `action-rejected-${actionId}`,
      role: 'assistant',
      content: `**Action rejected:** ${pendingAction?.description || 'Unknown action'}`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, rejectMessage]);

    // Remove from pending list after a short delay to show the rejected state
    setTimeout(() => {
      setPendingActions((prev) => prev.filter((a) => a.actionId !== actionId));
    }, 1000);
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
          <PlanPanel
            items={planItems}
            approved={planApproved}
            loading={planLoading}
            onApprove={handleApprovePlan}
          />
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

      {/* Pending Actions - Fixed above input, always visible */}
      {pendingActions.length > 0 && (
        <div className="border-t border-gray-700 px-4 py-2 space-y-2">
          {pendingActions.map((action) => (
            <InlineAction
              key={action.actionId}
              action={action}
              onApprove={handleApproveAction}
              onReject={handleRejectAction}
            />
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-700 p-4">
        {retryState && !isLoading && (
          <div className="mb-2 flex items-center justify-between bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-300">
            <span>Last message failed.</span>
            <button
              type="button"
              onClick={handleRetry}
              className="text-blue-300 hover:text-blue-200"
            >
              Retry
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Type your message... (use @ to quick-open files)"
              disabled={isLoading}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            {fileHints.length > 0 && (
              <div className="absolute bottom-12 left-0 right-0 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto text-xs">
                {fileHints.map((hint, idx) => (
                  <button
                    type="button"
                    key={hint}
                    onClick={() => handlePickHint(hint)}
                    className={`w-full text-left px-3 py-2 ${
                      idx === activeHintIndex ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            )}
            {fileHintsLoading && (
              <div className="absolute bottom-12 left-0 right-0 text-[10px] text-gray-400 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                Searching files...
              </div>
            )}
            {fileHintsError && (
              <div className="absolute bottom-12 left-0 right-0 text-[10px] text-red-300 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                {fileHintsError}
              </div>
            )}
          </div>
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

function extractAtToken(input: string): { value: string; start: number; end: number } | null {
  const atIndex = input.lastIndexOf('@');
  if (atIndex === -1) return null;
  const after = input.slice(atIndex + 1);
  const match = after.match(/^[^\s]*/);
  if (!match) return null;
  return {
    value: match[0],
    start: atIndex,
    end: atIndex + 1 + match[0].length,
  };
}

function escapeGlob(value: string): string {
  return value.replace(/([\\*?[\]{}()!])/g, '\\$1');
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

function hashPlan(items: string[]): string {
  return JSON.stringify(items);
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
