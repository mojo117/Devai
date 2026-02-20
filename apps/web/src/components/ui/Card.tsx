import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
}

export function Card({ children, header, className = '' }: CardProps) {
  return (
    <div
      className={`bg-devai-card border border-devai-border rounded-lg ${className}`}
    >
      {header && (
        <div className="px-3 py-2 border-b border-devai-border text-sm font-medium text-devai-text">
          {header}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  );
}
