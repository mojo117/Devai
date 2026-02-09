import { useMemo, useState } from 'react';
import type { Action, ActionStatus } from '../types';
import { ActionCard } from './ActionCard';
import { EmptyState } from './EmptyState';

interface ActionsPageProps {
  actions: Action[];
  onApprove: (actionId: string) => void;
  onReject: (actionId: string) => void;
  onRetry: (actionId: string) => void;
  onRefresh: () => void;
}

const FILTERS: Array<{ key: 'all' | ActionStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'executing', label: 'Executing' },
  { key: 'done', label: 'Done' },
  { key: 'failed', label: 'Failed' },
  { key: 'rejected', label: 'Rejected' },
];

export function ActionsPage({ actions, onApprove, onReject, onRetry, onRefresh }: ActionsPageProps) {
  const [filter, setFilter] = useState<'all' | ActionStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const counts = useMemo(() => ({
    all: actions.length,
    pending: actions.filter((a) => a.status === 'pending').length,
    approved: actions.filter((a) => a.status === 'approved').length,
    executing: actions.filter((a) => a.status === 'executing').length,
    done: actions.filter((a) => a.status === 'done').length,
    failed: actions.filter((a) => a.status === 'failed').length,
    rejected: actions.filter((a) => a.status === 'rejected').length,
  }), [actions]);

  const sortedActions = useMemo(() => (
    [...actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  ), [actions]);

  const filtered = useMemo(() => {
    return sortedActions.filter((a) => {
      const matchesStatus = filter === 'all' || a.status === filter;
      const matchesSearch = searchQuery === '' ||
        a.toolName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [filter, searchQuery, sortedActions]);

  return (
    <div className="flex-1 flex flex-col px-6 py-6 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-200">Action Center</h2>
          <p className="text-xs text-gray-500">Approve, reject, and review tool actions.</p>
        </div>
        <button
          onClick={onRefresh}
          className="text-xs text-gray-300 border border-gray-600 px-3 py-1.5 rounded hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            onClick={() => setFilter(item.key)}
            className={`text-xs px-3 py-1.5 rounded border ${
              filter === item.key
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'border-gray-700 text-gray-300 hover:bg-gray-800'
            }`}
          >
            {item.label}
            <span className="ml-1 opacity-60">({counts[item.key]})</span>
          </button>
        ))}
      </div>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search actions by tool name or description..."
        className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={searchQuery || filter !== 'all' ? '🔍' : '✨'}
          title={searchQuery || filter !== 'all' ? 'No matching actions' : 'No actions yet'}
          description={
            searchQuery || filter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Actions will appear here when tools require approval'
          }
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              onApprove={() => onApprove(action.id)}
              onReject={() => onReject(action.id)}
              onRetry={() => onRetry(action.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
