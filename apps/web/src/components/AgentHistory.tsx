/**
 * AgentHistory Component
 *
 * Displays the history of agent actions and delegations.
 * Useful for debugging and understanding the multi-agent workflow.
 */

import { useState } from 'react';
import { AgentBadge, type AgentName } from './AgentStatus';

export interface AgentHistoryEntry {
  id: string;
  timestamp: string;
  agent: AgentName;
  action: string;
  input?: unknown;
  output?: unknown;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: string;
  }>;
  duration: number;
  status: 'success' | 'error' | 'escalated';
}

interface AgentHistoryProps {
  entries: AgentHistoryEntry[];
  maxHeight?: string;
  showToolCalls?: boolean;
}

const statusStyles: Record<string, string> = {
  success: 'border-green-600 bg-green-900/10',
  error: 'border-red-600 bg-red-900/10',
  escalated: 'border-yellow-600 bg-yellow-900/10',
};

const statusLabels: Record<string, string> = {
  success: 'Completed',
  error: 'Failed',
  escalated: 'Escalated',
};

export function AgentHistory({
  entries,
  maxHeight = '400px',
  showToolCalls = true,
}: AgentHistoryProps) {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (entries.length === 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="text-sm text-gray-500 text-center">
          No agent activity yet
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden"
      style={{ maxHeight }}
    >
      <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-3 py-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">Agent History</span>
        <span className="text-xs text-gray-500">{entries.length} entries</span>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: `calc(${maxHeight} - 40px)` }}>
        {entries.map((entry, index) => {
          const isExpanded = expandedEntries.has(entry.id);
          const time = new Date(entry.timestamp).toLocaleTimeString();

          return (
            <div
              key={entry.id}
              className={`border-l-2 ${statusStyles[entry.status]} ${
                index < entries.length - 1 ? 'border-b border-gray-700' : ''
              }`}
            >
              {/* Header */}
              <button
                onClick={() => toggleExpanded(entry.id)}
                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-gray-700/30 transition-colors"
              >
                <span className="text-xs text-gray-500 w-16 shrink-0">{time}</span>
                <AgentBadge agent={entry.agent} size="sm" />
                <span className="text-sm text-gray-300 flex-1 truncate">
                  {entry.action}
                </span>
                <span className="text-xs text-gray-500">
                  {entry.duration}ms
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    entry.status === 'success'
                      ? 'bg-green-600/30 text-green-400'
                      : entry.status === 'error'
                      ? 'bg-red-600/30 text-red-400'
                      : 'bg-yellow-600/30 text-yellow-400'
                  }`}
                >
                  {statusLabels[entry.status]}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform ${
                    isExpanded ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  {/* Input */}
                  {entry.input && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Input</div>
                      <pre className="text-xs bg-gray-900 p-2 rounded overflow-x-auto text-gray-300">
                        {typeof entry.input === 'string'
                          ? entry.input
                          : JSON.stringify(entry.input, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Tool Calls */}
                  {showToolCalls && entry.toolCalls && entry.toolCalls.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">
                        Tool Calls ({entry.toolCalls.length})
                      </div>
                      <div className="space-y-1">
                        {entry.toolCalls.map((tc, i) => (
                          <div
                            key={i}
                            className="bg-gray-900 rounded p-2 text-xs"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-blue-400 font-mono">
                                {tc.name}
                              </span>
                            </div>
                            <pre className="text-gray-400 overflow-x-auto">
                              {JSON.stringify(tc.arguments, null, 2)}
                            </pre>
                            {tc.result && (
                              <div className="mt-1 pt-1 border-t border-gray-700">
                                <span className="text-gray-500">Result: </span>
                                <span className="text-green-400">
                                  {tc.result.length > 100
                                    ? tc.result.substring(0, 100) + '...'
                                    : tc.result}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Output */}
                  {entry.output && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Output</div>
                      <pre className="text-xs bg-gray-900 p-2 rounded overflow-x-auto text-gray-300 max-h-48 overflow-y-auto">
                        {typeof entry.output === 'string'
                          ? entry.output
                          : JSON.stringify(entry.output, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact timeline view for agent history
 */
interface AgentTimelineProps {
  entries: AgentHistoryEntry[];
}

export function AgentTimeline({ entries }: AgentTimelineProps) {
  if (entries.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {entries.map((entry, i) => (
        <div key={entry.id} className="flex items-center">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
              entry.status === 'success'
                ? 'bg-green-600/30 text-green-400 border border-green-600'
                : entry.status === 'error'
                ? 'bg-red-600/30 text-red-400 border border-red-600'
                : 'bg-yellow-600/30 text-yellow-400 border border-yellow-600'
            }`}
            title={`${entry.agent}: ${entry.action}`}
          >
            {entry.agent === 'chapo' ? '🎯' : entry.agent === 'koda' ? '💻' : '🔧'}
          </div>
          {i < entries.length - 1 && (
            <div className="w-4 h-0.5 bg-gray-600" />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Live agent activity indicator
 */
interface AgentActivityProps {
  agent: AgentName | null;
  action: string | null;
}

export function AgentActivity({ agent, action }: AgentActivityProps) {
  if (!agent || !action) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-gray-400 animate-pulse">
      <AgentBadge agent={agent} size="sm" />
      <span>{action}</span>
      <div className="flex gap-1">
        <div className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}
