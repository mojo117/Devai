import { useState } from 'react';
import type { DelegationToolStep } from './types';

export function ToolTimeline({ steps }: { steps: DelegationToolStep[] }) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      {steps.map((step, index) => {
        const isExpanded = expandedStep === step.id;
        const icon = step.success === true ? '\u2713' : step.success === false ? '\u2717' : '\u25CB';
        const iconColor = step.success === true
          ? 'text-emerald-400'
          : step.success === false
            ? 'text-red-400'
            : 'text-devai-text-muted';

        return (
          <div key={step.id}>
            <button
              onClick={(e) => { e.stopPropagation(); setExpandedStep(isExpanded ? null : step.id); }}
              className="flex items-center gap-2 w-full text-left px-1 py-0.5 rounded hover:bg-devai-surface/50 transition-colors"
            >
              <span className="text-[10px] text-devai-text-muted font-mono w-4 text-right shrink-0">
                {index + 1}.
              </span>
              <span className={`text-[10px] ${iconColor} shrink-0`}>{icon}</span>
              <span className="text-[11px] text-devai-text font-mono truncate">
                {step.name}
              </span>
              <span className="text-[10px] text-devai-text-muted font-mono truncate flex-1 min-w-0">
                {step.argsPreview}
              </span>
              {step.durationMs != null && (
                <span className="text-[10px] text-devai-text-muted font-mono shrink-0">
                  {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </button>
            {isExpanded && step.resultPreview && (
              <div className="ml-8 mt-0.5 mb-1 rounded bg-devai-surface/30 border border-devai-border/30 px-2 py-1.5">
                <p className="text-[10px] text-devai-text-secondary font-mono whitespace-pre-wrap break-all">
                  {step.resultPreview}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
