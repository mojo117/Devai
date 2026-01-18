import type { Action } from '../types';

interface ActionCardProps {
  action: Action;
  onApprove: () => void;
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-600',
  approved: 'bg-blue-600',
  executing: 'bg-purple-600',
  done: 'bg-green-600',
  failed: 'bg-red-600',
};

export function ActionCard({ action, onApprove }: ActionCardProps) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm text-blue-400">
          {action.toolName}
        </span>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            statusColors[action.status] || 'bg-gray-600'
          }`}
        >
          {action.status}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-300 mb-2">{action.description}</p>

      {/* Arguments */}
      <details className="mb-3">
        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
          View arguments
        </summary>
        <pre className="mt-2 text-xs bg-gray-900 p-2 rounded overflow-x-auto">
          {JSON.stringify(action.toolArgs, null, 2)}
        </pre>
      </details>

      {/* Approve Button */}
      {action.status === 'pending' && (
        <button
          onClick={onApprove}
          className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2 px-4 rounded transition-colors"
        >
          Approve Action
        </button>
      )}

      {/* Result/Error */}
      {action.status === 'done' && action.result !== undefined && (
        <div className="mt-2 text-xs text-green-400">
          Result: {String(typeof action.result === 'string' ? action.result : JSON.stringify(action.result))}
        </div>
      )}

      {action.status === 'failed' && action.error && (
        <div className="mt-2 text-xs text-red-400">
          Error: {action.error}
        </div>
      )}
    </div>
  );
}
