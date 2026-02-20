import { InlineAction, type PendingAction } from '../InlineAction';
import { Button, Card } from '../ui';

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
        <Card className="mb-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-devai-text-secondary">
              {pendingActions.length} actions pending
            </span>
            <div className="flex gap-2">
              <Button onClick={onBatchApprove} size="sm" className="bg-green-600 hover:bg-green-500 text-white">
                Approve All
              </Button>
              <Button onClick={onBatchReject} size="sm" variant="danger">
                Reject All
              </Button>
            </div>
          </div>
        </Card>
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
