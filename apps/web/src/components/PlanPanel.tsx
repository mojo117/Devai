interface PlanPanelProps {
  items: string[];
  approved: boolean;
  loading: boolean;
  onApprove: () => void;
}

export function PlanPanel({ items, approved, loading, onApprove }: PlanPanelProps) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wide text-gray-400">
          Active Plan
        </div>
        {approved ? (
          <span className="text-[10px] text-green-300">Approved</span>
        ) : loading ? (
          <span className="text-[10px] text-gray-400">Checking...</span>
        ) : (
          <button
            onClick={onApprove}
            className="text-[10px] text-blue-300 hover:text-blue-200"
          >
            Approve plan
          </button>
        )}
      </div>
      <ol className="list-decimal list-inside space-y-1 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      {!approved && (
        <p className="text-[11px] text-gray-400 mt-2">
          Approve the plan to allow execution of its steps.
        </p>
      )}
    </div>
  );
}
