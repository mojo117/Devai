import { useState } from 'react';

export interface PendingAction {
  actionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
}

interface InlineActionProps {
  action: PendingAction;
  onApprove: (actionId: string) => Promise<void>;
  onReject: (actionId: string) => Promise<void>;
}

export function InlineAction({ action, onApprove, onReject }: InlineActionProps) {
  const [status, setStatus] = useState<'pending' | 'approving' | 'rejecting' | 'approved' | 'rejected' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setStatus('approving');
    setError(null);
    try {
      await onApprove(action.actionId);
      setStatus('approved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
      setStatus('error');
    }
  };

  const handleReject = async () => {
    setStatus('rejecting');
    setError(null);
    try {
      await onReject(action.actionId);
      setStatus('rejected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
      setStatus('error');
    }
  };

  // After action is handled, show status
  if (status === 'approved') {
    return (
      <div className="bg-green-900/30 border border-green-600 rounded-lg p-3 my-2">
        <div className="flex items-center gap-2">
          <span className="text-green-400">✓ Approved</span>
          <span className="font-mono text-sm text-gray-400">{action.toolName}</span>
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="bg-red-900/30 border border-red-600 rounded-lg p-3 my-2">
        <div className="flex items-center gap-2">
          <span className="text-red-400">✗ Rejected</span>
          <span className="font-mono text-sm text-gray-400">{action.toolName}</span>
        </div>
      </div>
    );
  }

  const isLoading = status === 'approving' || status === 'rejecting';

  return (
    <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 my-2">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-400 text-sm">⚠️ Action requires approval</span>
      </div>

      {/* Tool info */}
      <p className="font-mono text-sm text-blue-400 mb-1">{action.toolName}</p>
      <p className="text-sm text-gray-300 mb-2">{action.description}</p>

      {/* Arguments preview */}
      <details className="mb-3">
        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
          View arguments
        </summary>
        <pre className="mt-2 text-xs bg-gray-900 p-2 rounded overflow-x-auto text-gray-300">
          {JSON.stringify(action.toolArgs, null, 2)}
        </pre>
      </details>

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-400 mb-2">{error}</p>
      )}

      {/* Buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={isLoading}
          className="bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed text-white text-sm font-medium py-1.5 px-4 rounded transition-colors"
        >
          {status === 'approving' ? 'Approving...' : '✓ Approve'}
        </button>
        <button
          onClick={handleReject}
          disabled={isLoading}
          className="text-red-400 hover:text-red-300 disabled:text-red-600 disabled:cursor-not-allowed text-sm font-medium py-1.5 px-2 transition-colors"
        >
          {status === 'rejecting' ? 'Rejecting...' : '✗ Reject'}
        </button>
      </div>
    </div>
  );
}
