import { Fragment, type RefObject } from 'react';
import type { ChatMessage, SessionSummary } from '../../types';
import type { ToolEvent } from './types';
import { mergeConsecutiveThinking } from './mergeEvents';
import type { MergedToolEvent } from './mergeEvents';
import { renderMessageContent } from './utils';
import { getUserfileDownloadUrl } from '../../api';

const AGENT_COLORS: Record<string, string> = {
  chapo: 'text-cyan-400',
  devo: 'text-orange-400',
  caio: 'text-blue-400',
  scout: 'text-purple-400',
};

const AGENT_DOT_COLORS: Record<string, string> = {
  chapo: 'bg-cyan-400',
  devo: 'bg-orange-400',
  caio: 'bg-blue-400',
  scout: 'bg-purple-400',
};

interface MessageListProps {
  messages: ChatMessage[];
  toolEvents: ToolEvent[];
  messageToolEvents: Record<string, ToolEvent[]>;
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
  messageToolEvents,
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
  const renderToolEventsBlock = (events: ToolEvent[], live: boolean) => {
    const merged = mergeConsecutiveThinking(events);
    return (
      <div className="space-y-1.5">
        {merged.map((event) => {
          const doc = getDocumentDelivery(event);
          if (doc) {
            return (
              <DocumentDownloadCard
                key={event.id}
                fileId={doc.fileId}
                filename={doc.filename}
                sizeBytes={doc.sizeBytes}
                description={doc.description}
              />
            );
          }
          return (
            <InlineSystemEvent
              key={event.id}
              event={event}
              mergedCount={event.mergedCount}
              isExpanded={expandedEvents.has(event.id)}
              onToggle={() => toggleEventExpanded(event.id)}
              isLoading={live}
            />
          );
        })}
      </div>
    );
  };

  const renderMessage = (message: ChatMessage) => {
    if (message.role === 'system') {
      return (
        <div key={message.id} className="flex justify-center">
          <div className="inline-flex items-center gap-2 text-xs text-devai-text-muted bg-devai-surface/50 border border-devai-border/50 rounded-lg px-3 py-1.5 max-w-[90%]">
            <svg className="w-3.5 h-3.5 shrink-0 text-devai-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{message.content}</span>
          </div>
        </div>
      );
    }

    return (
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
  };

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

      {/* Messages with associated tool events rendered inline */}
      {messages.map((message) => {
        const frozen = message.role === 'assistant' ? messageToolEvents[message.id] : undefined;
        return (
          <Fragment key={message.id}>
            {frozen && frozen.length > 0 && renderToolEventsBlock(frozen, false)}
            {renderMessage(message)}
          </Fragment>
        );
      })}

      {/* Live tool events for current in-progress exchange */}
      {toolEvents.length > 0 && renderToolEventsBlock(toolEvents, isLoading)}

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

/** Check if a tool_result event represents a document delivery with download info */
function getDocumentDelivery(event: ToolEvent): { fileId: string; filename: string; sizeBytes: number; downloadUrl: string; description?: string } | null {
  if (event.type !== 'tool_result' || event.name !== 'deliver_document') return null;
  const r = event.result as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.fileId !== 'string' || typeof r.downloadUrl !== 'string') return null;
  return {
    fileId: r.fileId as string,
    filename: (r.filename as string) || 'document',
    sizeBytes: (r.sizeBytes as number) || 0,
    downloadUrl: r.downloadUrl as string,
    description: r.description as string | undefined,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Document download card — rendered for deliver_document results */
function DocumentDownloadCard({ fileId, filename, sizeBytes, description }: {
  fileId: string;
  filename: string;
  sizeBytes: number;
  description?: string;
}) {
  const downloadUrl = getUserfileDownloadUrl(fileId);
  return (
    <div className="flex justify-start">
      <a
        href={downloadUrl}
        download={filename}
        className="inline-flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 max-w-[80%] hover:bg-emerald-500/10 transition-colors group"
      >
        <span className="text-xl shrink-0">{'\u{1F4E5}'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-emerald-400 font-medium truncate">{filename}</p>
          <p className="text-xs text-devai-text-muted">
            {formatBytes(sizeBytes)}
            {description ? ` \u00B7 ${description}` : ''}
          </p>
        </div>
        <svg className="w-4 h-4 text-emerald-400 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </a>
    </div>
  );
}

/** Inline System Event — compact left-aligned badge with inline detail */
function InlineSystemEvent({
  event,
  mergedCount,
  isExpanded,
  onToggle,
  isLoading,
}: {
  event: ToolEvent;
  mergedCount?: number;
  isExpanded: boolean;
  onToggle: () => void;
  isLoading: boolean;
}) {
  const getEventLabel = () => {
    const agentPrefix = event.agent ? `${event.agent.toUpperCase()}: ` : '';
    if (event.type === 'thinking') {
      const countSuffix = mergedCount && mergedCount > 1 ? ` (${mergedCount}x)` : '';
      return `${agentPrefix}Thinking${countSuffix}`;
    }
    if (event.type === 'status') return `${agentPrefix}${String(event.result || 'Status')}`;
    if (event.type === 'tool_call') return `${agentPrefix}Using: ${event.name || 'tool'}`;
    if (event.type === 'tool_result') return `${agentPrefix}Result: ${event.name || 'tool'}`;
    return `${agentPrefix}${event.type}`;
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
        {event.agent && (
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${AGENT_DOT_COLORS[event.agent] || 'bg-gray-400'}`} />
        )}
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
