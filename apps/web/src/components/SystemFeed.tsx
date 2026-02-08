import { useEffect, useRef } from 'react';

export type AgentName = 'chapo' | 'koda' | 'devo' | 'scout';

export interface FeedEvent {
  id: string;
  timestamp: string;
  type: 'tool_call' | 'tool_result' | 'status' | 'action' | 'error' | 'agent' | 'thinking';
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
  status?: 'pending' | 'running' | 'success' | 'error';
  agent?: AgentName;
  toolName?: string; // Tool name for tool_call/tool_result
}

interface SystemFeedProps {
  events: FeedEvent[];
  isLoading?: boolean;
  onClear?: () => void;
}

export function SystemFeed({ events, isLoading, onClear }: SystemFeedProps) {
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
          <div className="flex items-center gap-3">
            {isLoading && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span className="text-xs text-gray-400">Running...</span>
              </div>
            )}
            {onClear && events.length > 0 && (
              <button
                onClick={onClear}
                className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
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
      case 'thinking':
        return 'border-cyan-500/50 bg-cyan-500/5';
      default:
        return 'border-gray-600 bg-gray-800';
    }
  };

  const getTypeIcon = () => {
    switch (event.type) {
      case 'tool_call':
        return '▶';
      case 'tool_result':
        return event.status === 'error' ? '✗' : '◀';
      case 'status':
        return 'i';
      case 'action':
        return '!';
      case 'error':
        return '✗';
      case 'agent':
        return '@';
      case 'thinking':
        return '💭';
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

  const getAgentBadge = () => {
    if (!event.agent) return null;
    const agentColors: Record<AgentName, string> = {
      chapo: 'bg-purple-600/30 text-purple-300 border-purple-500/50',
      koda: 'bg-blue-600/30 text-blue-300 border-blue-500/50',
      devo: 'bg-green-600/30 text-green-300 border-green-500/50',
      scout: 'bg-orange-600/30 text-orange-300 border-orange-500/50',
    };
    const agentLabels: Record<AgentName, string> = {
      chapo: '🎯 CHAPO',
      koda: '💻 KODA',
      devo: '🔧 DEVO',
      scout: '🔍 SCOUT',
    };
    return (
      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${agentColors[event.agent]}`}>
        {agentLabels[event.agent]}
      </span>
    );
  };

  // Format title based on event type
  const getFormattedTitle = () => {
    if (event.type === 'tool_call' && event.toolName) {
      return (
        <span className="flex items-center gap-1.5">
          <span className="text-blue-300 font-mono text-[11px]">{event.toolName}</span>
          <span className="text-gray-500 text-[10px]">→</span>
        </span>
      );
    }
    if (event.type === 'tool_result' && event.toolName) {
      return (
        <span className="flex items-center gap-1.5">
          <span className="text-gray-500 text-[10px]">←</span>
          <span className={`font-mono text-[11px] ${event.status === 'error' ? 'text-red-300' : 'text-green-300'}`}>{event.toolName}</span>
        </span>
      );
    }
    if (event.type === 'thinking') {
      return (
        <span className="text-cyan-300 text-xs italic">{event.title}</span>
      );
    }
    return <span className="text-xs font-medium text-gray-200 truncate max-w-[150px]">{event.title}</span>;
  };

  return (
    <div className={`rounded border ${getTypeColor()} overflow-hidden`}>
      {/* Header */}
      <div className="px-2 py-1.5 flex items-center justify-between border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 flex items-center justify-center rounded bg-gray-800 text-[10px] text-gray-400">
            {getTypeIcon()}
          </span>
          {getAgentBadge()}
          {getFormattedTitle()}
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
  type: 'status' | 'tool_call' | 'tool_result' | 'thinking';
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
  agent?: AgentName;
}): FeedEvent {
  const timestamp = new Date().toISOString();

  if (toolEvent.type === 'status') {
    return {
      id: toolEvent.id,
      timestamp,
      type: 'status',
      title: String(toolEvent.result || 'Status update'),
      status: 'success',
      agent: toolEvent.agent,
    };
  }

  if (toolEvent.type === 'thinking') {
    return {
      id: toolEvent.id,
      timestamp,
      type: 'thinking',
      title: String(toolEvent.result || 'Thinking...'),
      agent: toolEvent.agent,
    };
  }

  if (toolEvent.type === 'tool_call') {
    const toolName = toolEvent.name || 'unknown';
    return {
      id: toolEvent.id,
      timestamp,
      type: 'tool_call',
      title: `Calling ${toolName}`,
      toolName,
      content: toolEvent.arguments ? formatToolArgs(toolName, toolEvent.arguments) : undefined,
      status: 'running',
      agent: toolEvent.agent,
    };
  }

  // tool_result
  const isError = typeof toolEvent.result === 'object' && toolEvent.result !== null && 'error' in toolEvent.result;
  const toolName = toolEvent.name || 'unknown';
  return {
    id: `${toolEvent.id}-result`,
    timestamp,
    type: 'tool_result',
    title: isError ? `${toolName} failed` : `${toolName} completed`,
    toolName,
    content: toolEvent.result ? formatPayload(toolEvent.result) : undefined,
    status: isError ? 'error' : 'success',
    agent: toolEvent.agent,
  };
}

// Format tool arguments in a human-readable way
function formatToolArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return String(args);

  const obj = args as Record<string, unknown>;

  // Format based on common tool patterns
  if (toolName.includes('read') || toolName.includes('Read')) {
    return obj.path ? `📄 ${obj.path}` : formatPayload(args);
  }
  if (toolName.includes('write') || toolName.includes('Write') || toolName.includes('edit') || toolName.includes('Edit')) {
    return obj.path ? `✏️ ${obj.path}` : formatPayload(args);
  }
  if (toolName.includes('search') || toolName.includes('grep') || toolName.includes('Grep')) {
    const pattern = obj.pattern || obj.query || '';
    const path = obj.path || obj.directory || '';
    return `🔍 "${pattern}"${path ? ` in ${path}` : ''}`;
  }
  if (toolName.includes('glob') || toolName.includes('Glob') || toolName.includes('list')) {
    return obj.pattern ? `📁 ${obj.pattern}` : formatPayload(args);
  }
  if (toolName.includes('diff') || toolName.includes('Diff')) {
    return '📊 Checking changes...';
  }
  if (toolName.includes('status')) {
    return '📋 Getting status...';
  }
  if (toolName.includes('web_search') || toolName.includes('WebSearch')) {
    return obj.query ? `🌐 "${obj.query}"` : formatPayload(args);
  }

  // Default: show key-value pairs compactly
  const pairs = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 50) : JSON.stringify(v).slice(0, 50)}`);

  return pairs.join('\n') || formatPayload(args);
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
