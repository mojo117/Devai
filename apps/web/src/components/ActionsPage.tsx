import { useMemo, useState } from 'react';
import type { Action, ActionStatus } from '../types';
import { ActionCard } from './ActionCard';

interface ActionsPageProps {
  actions: Action[];
  onApprove: (actionId: string) => void;
  onReject: (actionId: string) => void;
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

export function ActionsPage({ actions, onApprove, onReject, onRefresh }: ActionsPageProps) {
  const [filter, setFilter] = useState<'all' | ActionStatus>('all');

  const sortedActions = useMemo(() => (
    [...actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  ), [actions]);

  const filtered = useMemo(() => {
    if (filter === 'all') return sortedActions;
    return sortedActions.filter((a) => a.status === filter);
  }, [filter, sortedActions]);

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
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-gray-500">No actions found.</div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              onApprove={() => onApprove(action.id)}
              onReject={() => onReject(action.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
