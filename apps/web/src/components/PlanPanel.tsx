interface PlanPanelProps {
  items: string[];
  approved: boolean;
  loading: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function PlanPanel({ items, approved, loading, onApprove, onReject }: PlanPanelProps) {
  return (
    <div className={`rounded-lg p-4 text-sm text-gray-200 ${approved ? 'bg-gray-800 border border-gray-700' : 'bg-yellow-900/30 border-2 border-yellow-500/50'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {!approved && (
            <span className="text-yellow-400 text-lg">⚠</span>
          )}
          <div className="text-sm font-semibold text-gray-200">
            {approved ? 'Plan Approved' : 'Plan Requires Approval'}
          </div>
        </div>
        {approved ? (
          <span className="text-xs px-2 py-1 bg-green-600/30 text-green-300 rounded">Approved</span>
        ) : loading ? (
          <span className="text-xs text-gray-400">Checking...</span>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={onReject}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Reject
            </button>
            <button
              onClick={onApprove}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Approve Plan
            </button>
          </div>
        )}
      </div>
      <ol className="list-decimal list-inside space-y-1 text-sm ml-1">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      {!approved && (
        <p className="text-xs text-yellow-200/70 mt-3">
          You must approve this plan before any actions can be executed.
        </p>
      )}
    </div>
  );
}
