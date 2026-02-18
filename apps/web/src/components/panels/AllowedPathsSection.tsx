interface AllowedPathsSectionProps {
  allowedRoots?: string[];
}

export function AllowedPathsSection({ allowedRoots }: AllowedPathsSectionProps) {
  if (!allowedRoots || allowedRoots.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-devai-border">
      <h2 className="text-sm font-semibold text-devai-text-secondary mb-3">
        Allowed Paths
      </h2>
      <div className="space-y-2">
        {allowedRoots.map((root) => (
          <div
            key={root}
            className="bg-devai-bg rounded p-2 text-xs text-devai-text-secondary font-mono break-all"
          >
            {root}
          </div>
        ))}
      </div>
    </div>
  );
}
