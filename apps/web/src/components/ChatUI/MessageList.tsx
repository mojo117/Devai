import type { RefObject } from 'react';
import type { ChatMessage, SessionSummary } from '../../types';
import type { ToolEvent } from './types';
import { renderMessageContent } from './utils';

interface MessageListProps {
  messages: ChatMessage[];
  toolEvents: ToolEvent[];
  expandedEvents: Set<string>;
  toggleEventExpanded: (eventId: string) => void;
  copiedMessageId: string | null;
  onCopyMessage: (messageId: string, content: string) => void;
  isLoading: boolean;
  messagesEndRef: RefObject<HTMLDivElement>;
  showSessionControls: boolean;
  sessionId: string | null;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  onSelectSession: (id: string) => void;
  onRestartChat: () => void;
  onNewChat: () => void;
}

export function MessageList({
  messages,
  toolEvents,
  expandedEvents,
  toggleEventExpanded,
  copiedMessageId,
  onCopyMessage,
  isLoading,
  messagesEndRef,
  showSessionControls,
  sessionId,
  sessions,
  sessionsLoading,
  onSelectSession,
  onRestartChat,
  onNewChat,
}: MessageListProps) {
  // Chronological interleaving: user msg → tool events → assistant response
  const hasToolEvents = toolEvents.length > 0;
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const shouldInterleave = hasToolEvents && !isLoading && lastMsg?.role === 'assistant';
  const mainMessages = shouldInterleave ? messages.slice(0, -1) : messages;
  const trailingMessage = shouldInterleave ? lastMsg : null;

  const renderMessage = (message: ChatMessage) => (
    <div
      key={message.id}
      className={`flex ${
        message.role === 'user' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div
        className={`group relative max-w-[80%] px-4 py-2.5 ${
          message.role === 'user'
            ? 'bg-devai-accent text-white rounded-2xl rounded-br-sm'
            : 'bg-devai-card text-devai-text rounded-2xl rounded-bl-sm border border-devai-border'
        }`}
      >
        <button
          onClick={() => onCopyMessage(message.id, message.content)}
          className={`absolute top-2 right-2 p-1 rounded transition-all ${
            copiedMessageId === message.id
              ? 'opacity-100 text-green-400'
              : 'opacity-0 group-hover:opacity-100 text-devai-text-muted hover:text-devai-text'
          }`}
          title={copiedMessageId === message.id ? 'Copied!' : 'Copy message'}
        >
          {copiedMessageId === message.id ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
        <div className="pr-6">
          {renderMessageContent(message.content)}
        </div>
        <p className={`text-xs mt-1 ${
          message.role === 'user' ? 'opacity-60' : 'text-devai-text-muted'
        }`}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
      {showSessionControls && (
        <div className="flex items-center justify-between text-xs text-devai-text-secondary">
          <div className="flex items-center gap-2">
            <span>Session</span>
            <select
              value={sessionId || ''}
              onChange={(e) => onSelectSession(e.target.value)}
              disabled={sessionsLoading || sessions.length === 0}
              className="bg-devai-card border border-devai-border rounded px-2 py-1 text-xs text-devai-text"
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
              onClick={onRestartChat}
              disabled={sessionsLoading || messages.length === 0}
              className="text-[11px] text-devai-accent hover:text-devai-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              title="Save current conversation to history and start fresh"
            >
              {sessionsLoading ? 'Loading...' : 'Restart Chat'}
            </button>
            <button
              onClick={onNewChat}
              disabled={sessionsLoading}
              className="text-[11px] text-devai-text-secondary hover:text-devai-text disabled:opacity-50"
            >
              {sessionsLoading ? 'Loading...' : 'New Chat'}
            </button>
          </div>
        </div>
      )}

      {messages.length === 0 && (
        <div className="text-center text-devai-text-muted mt-8">
          <p className="text-lg">Welcome to DevAI</p>
          <p className="text-sm mt-2">
            Start a conversation to get help with your code.
          </p>
        </div>
      )}

      {/* Main messages (all, or all-except-last-assistant when interleaving) */}
      {mainMessages.map(renderMessage)}

      {/* Inline System Events — chronologically between user msg and response */}
      {hasToolEvents && (
        <div className="space-y-1.5">
          {toolEvents.slice(-10).map((event) => (
            <InlineSystemEvent
              key={event.id}
              event={event}
              isExpanded={expandedEvents.has(event.id)}
              onToggle={() => toggleEventExpanded(event.id)}
              isLoading={isLoading}
            />
          ))}
        </div>
      )}

      {/* Trailing assistant message (after tool events) */}
      {trailingMessage && renderMessage(trailingMessage)}

      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-devai-card border border-devai-border rounded-2xl rounded-bl-sm px-4 py-3">
            <div className="flex space-x-1.5">
              <span className="w-2 h-2 bg-devai-accent rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-devai-accent rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
              <span className="w-2 h-2 bg-devai-accent rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

/** Inline System Event — compact left-aligned badge with inline detail */
function InlineSystemEvent({
  event,
  isExpanded,
  onToggle,
  isLoading,
}: {
  event: ToolEvent;
  isExpanded: boolean;
  onToggle: () => void;
  isLoading: boolean;
}) {
  const getEventLabel = () => {
    if (event.type === 'thinking') return 'Thinking';
    if (event.type === 'status') return String(event.result || 'Status');
    if (event.type === 'tool_call') return `Using: ${event.name || 'tool'}`;
    if (event.type === 'tool_result') return `Result: ${event.name || 'tool'}`;
    return event.type;
  };

  const getEventColor = () => {
    if (event.type === 'thinking') return 'border-cyan-500/30 bg-cyan-500/5 text-cyan-400';
    if (event.type === 'tool_call') return 'border-devai-accent/30 bg-devai-accent/5 text-devai-accent';
    if (event.type === 'tool_result') return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400';
    return 'border-devai-border bg-devai-surface/50 text-devai-text-secondary';
  };

  const getInlineDetail = (): string => {
    const payload = event.type === 'tool_call' ? event.arguments : event.result;
    if (!payload) return '';
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return text.length > 150 ? text.slice(0, 150) + '\u2026' : text;
  };

  const hasContent = Boolean(event.arguments || event.result);
  const detail = isExpanded ? getInlineDetail() : '';

  return (
    <div className="flex justify-start">
      <button
        onClick={hasContent ? onToggle : undefined}
        className={`inline-flex items-center gap-2 rounded-lg border text-xs px-3 py-1.5 max-w-[80%] ${getEventColor()} ${hasContent ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
      >
        {event.type === 'thinking' && (
          <span className={`w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 ${isLoading ? 'animate-pulse' : ''}`} />
        )}
        {event.type === 'tool_call' && <span className="text-[10px] shrink-0">&#9654;</span>}
        {event.type === 'tool_result' && <span className="text-[10px] shrink-0">&#9664;</span>}
        <span className="font-mono text-[11px] whitespace-nowrap">{getEventLabel()}</span>
        {detail && (
          <span className="text-[10px] text-devai-text-secondary font-mono truncate min-w-0">
            _ {detail}
          </span>
        )}
        {hasContent && (
          <span className="text-[10px] opacity-60 shrink-0">{isExpanded ? '\u25B2' : '\u25BC'}</span>
        )}
      </button>
    </div>
  );
}
