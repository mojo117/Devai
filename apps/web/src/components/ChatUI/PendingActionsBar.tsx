import { InlineAction, type PendingAction } from '../InlineAction';

interface PendingActionsBarProps {
  pendingActions: PendingAction[];
  onApproveAction: (actionId: string) => Promise<void>;
  onRejectAction: (actionId: string) => Promise<void>;
  onBatchApprove: () => void;
  onBatchReject: () => void;
}

export function PendingActionsBar({
  pendingActions,
  onApproveAction,
  onRejectAction,
  onBatchApprove,
  onBatchReject,
}: PendingActionsBarProps) {
  if (pendingActions.length === 0) return null;

  return (
    <div className="border-t border-devai-border px-4 py-2 space-y-2">
      {/* Batch action buttons when multiple actions pending */}
      {pendingActions.length > 1 && (
        <div className="flex items-center justify-between bg-devai-card rounded-lg px-3 py-2 mb-2">
          <span className="text-xs text-devai-text-secondary">
            {pendingActions.length} actions pending
          </span>
          <div className="flex gap-2">
            <button
              onClick={onBatchApprove}
              className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded font-medium transition-colors"
            >
              Approve All
            </button>
            <button
              onClick={onBatchReject}
              className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded font-medium transition-colors"
            >
              Reject All
            </button>
          </div>
        </div>
      )}
      {pendingActions.map((action) => (
        <InlineAction
          key={action.actionId}
          action={action}
          onApprove={onApproveAction}
          onReject={onRejectAction}
        />
      ))}
    </div>
  );
}
