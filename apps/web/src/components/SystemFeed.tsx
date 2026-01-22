import { useEffect, useRef } from 'react';

export interface FeedEvent {
  id: string;
  timestamp: string;
  type: 'tool_call' | 'tool_result' | 'status' | 'action' | 'error' | 'agent';
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
  status?: 'pending' | 'running' | 'success' | 'error';
}

interface SystemFeedProps {
  events: FeedEvent[];
  isLoading?: boolean;
}

export function SystemFeed({ events, isLoading }: SystemFeedProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">System Feed</h2>
          {isLoading && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-xs text-gray-400">Running...</span>
            </div>
          )}
        </div>
      </div>

      {/* Events List - fills from bottom, new items at bottom */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-2 flex flex-col justify-end min-h-0"
      >
        <div className="space-y-2">
          {events.length === 0 && !isLoading && (
            <div className="text-center text-gray-500 py-8">
              <p className="text-sm">No system events yet</p>
              <p className="text-xs mt-1">Tool calls and logs will appear here</p>
            </div>
          )}

          {events.map((event) => (
            <FeedEventCard key={event.id} event={event} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedEventCard({ event }: { event: FeedEvent }) {
  const getTypeColor = () => {
    switch (event.type) {
      case 'tool_call':
        return 'border-blue-500/50 bg-blue-500/5';
      case 'tool_result':
        return event.status === 'error'
          ? 'border-red-500/50 bg-red-500/5'
          : 'border-green-500/50 bg-green-500/5';
      case 'status':
        return 'border-gray-500/50 bg-gray-500/5';
      case 'action':
        return 'border-yellow-500/50 bg-yellow-500/5';
      case 'error':
        return 'border-red-500/50 bg-red-500/5';
      case 'agent':
        return 'border-purple-500/50 bg-purple-500/5';
      default:
        return 'border-gray-600 bg-gray-800';
    }
  };

  const getTypeIcon = () => {
    switch (event.type) {
      case 'tool_call':
        return '>';
      case 'tool_result':
        return event.status === 'error' ? 'x' : '<';
      case 'status':
        return 'i';
      case 'action':
        return '!';
      case 'error':
        return 'x';
      case 'agent':
        return '@';
      default:
        return '-';
    }
  };

  const getStatusBadge = () => {
    if (!event.status) return null;
    const colors = {
      pending: 'bg-yellow-500/20 text-yellow-300',
      running: 'bg-blue-500/20 text-blue-300',
      success: 'bg-green-500/20 text-green-300',
      error: 'bg-red-500/20 text-red-300',
    };
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] ${colors[event.status]}`}>
        {event.status}
      </span>
    );
  };

  return (
    <div className={`rounded border ${getTypeColor()} overflow-hidden`}>
      {/* Header */}
      <div className="px-2 py-1.5 flex items-center justify-between border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 flex items-center justify-center rounded bg-gray-800 text-[10px] font-mono text-gray-400">
            {getTypeIcon()}
          </span>
          <span className="text-xs font-medium text-gray-200 truncate max-w-[180px]">
            {event.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge()}
          <span className="text-[10px] text-gray-500">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Content */}
      {event.content && (
        <div className="px-2 py-1.5">
          <pre className="text-[11px] text-gray-300 whitespace-pre-wrap break-all font-mono max-h-32 overflow-y-auto">
            {event.content}
          </pre>
        </div>
      )}
    </div>
  );
}

// Helper to convert tool events to feed events
export function toolEventToFeedEvent(toolEvent: {
  id: string;
  type: 'status' | 'tool_call' | 'tool_result';
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
}): FeedEvent {
  const timestamp = new Date().toISOString();

  if (toolEvent.type === 'status') {
    return {
      id: toolEvent.id,
      timestamp,
      type: 'status',
      title: String(toolEvent.result || 'Status update'),
      status: 'success',
    };
  }

  if (toolEvent.type === 'tool_call') {
    return {
      id: toolEvent.id,
      timestamp,
      type: 'tool_call',
      title: toolEvent.name || 'Tool Call',
      content: toolEvent.arguments ? formatPayload(toolEvent.arguments) : undefined,
      status: 'running',
    };
  }

  // tool_result
  const isError = typeof toolEvent.result === 'object' && toolEvent.result !== null && 'error' in toolEvent.result;
  return {
    id: `${toolEvent.id}-result`,
    timestamp,
    type: 'tool_result',
    title: toolEvent.name || 'Tool Result',
    content: toolEvent.result ? formatPayload(toolEvent.result) : undefined,
    status: isError ? 'error' : 'success',
  };
}

function formatPayload(payload: unknown): string {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    if (text.length > 500) {
      return `${text.slice(0, 500)}\n...`;
    }
    return text;
  } catch {
    return String(payload);
  }
}
