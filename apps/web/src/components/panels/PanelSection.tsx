import type { ReactNode } from 'react';

interface PanelSectionProps {
  title: string;
  count?: number;
  loadedAt?: string | null;
  loading?: boolean;
  onAction?: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  children: ReactNode;
  className?: string;
}

export function PanelSection({
  title,
  count,
  loadedAt,
  loading,
  onAction,
  actionLabel = 'Refresh',
  actionDisabled,
  children,
  className = 'mb-5',
}: PanelSectionProps) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-devai-text-secondary">
          {title}{count !== undefined ? ` (${count})` : ''}
        </h2>
        {onAction && (
          <button
            onClick={onAction}
            disabled={loading || actionDisabled}
            className="text-[10px] text-devai-text-secondary hover:text-devai-text disabled:opacity-50"
          >
            {loading ? 'Loading...' : actionLabel}
          </button>
        )}
      </div>
      {loadedAt && (
        <p className="text-[10px] text-devai-text-muted mt-1">
          Loaded: {new Date(loadedAt).toLocaleTimeString()}
        </p>
      )}
      {children}
    </div>
  );
}
