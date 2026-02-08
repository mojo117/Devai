import { useState } from 'react';

export interface PendingApproval {
  approvalId: string;
  description: string;
  riskLevel?: string;
  sessionId?: string;
  actions?: Array<{
    toolName: string;
    toolArgs: Record<string, unknown>;
    description: string;
    preview?: string;
  }>;
  fromAgent?: string;
  timestamp?: string;
}

interface InlineApprovalProps {
  approval: PendingApproval;
  onApprove: (approvalId: string) => Promise<void>;
  onReject: (approvalId: string) => Promise<void>;
}

export function InlineApproval({ approval, onApprove, onReject }: InlineApprovalProps) {
  const [status, setStatus] = useState<'pending' | 'approving' | 'rejecting' | 'approved' | 'rejected' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setStatus('approving');
    setError(null);
    try {
      await onApprove(approval.approvalId);
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
      await onReject(approval.approvalId);
      setStatus('rejected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
      setStatus('error');
    }
  };

  if (status === 'approved') {
    return (
      <div className="bg-green-900/30 border border-green-600 rounded-lg p-3 my-2">
        <div className="flex items-center gap-2">
          <span className="text-green-400">✓ Approved</span>
          <span className="font-mono text-sm text-gray-400">Approval granted</span>
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="bg-red-900/30 border border-red-600 rounded-lg p-3 my-2">
        <div className="flex items-center gap-2">
          <span className="text-red-400">✗ Rejected</span>
          <span className="font-mono text-sm text-gray-400">Approval denied</span>
        </div>
      </div>
    );
  }

  const isLoading = status === 'approving' || status === 'rejecting';

  return (
    <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 my-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-yellow-400 text-sm">⚠️ Approval required to proceed</span>
        {approval.riskLevel && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-700/40 text-yellow-200 uppercase">
            {approval.riskLevel}
          </span>
        )}
      </div>

      <p className="text-sm text-gray-300 mb-2 whitespace-pre-wrap">{approval.description}</p>

      {approval.actions && approval.actions.length > 0 && (
        <details className="mb-3">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
            View planned actions
          </summary>
          <pre className="mt-2 text-xs bg-gray-950 p-2 rounded overflow-x-auto text-gray-300 whitespace-pre-wrap">
            {approval.actions.map((action, index) => (
              `${index + 1}. ${action.description || action.toolName}`
            )).join('\n')}
          </pre>
        </details>
      )}

      {error && (
        <p className="text-sm text-red-400 mb-2">{error}</p>
      )}

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
