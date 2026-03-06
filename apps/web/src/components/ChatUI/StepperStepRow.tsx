import type { StepperStep } from './types';
import { ThinkingPreview } from './ThinkingPreview';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function StepperStepRow({ step, isLast }: { step: StepperStep; isLast: boolean }) {
  const dotClass =
    step.status === 'active'
      ? 'bg-cyan-400 animate-stepper-pulse'
      : step.status === 'completed'
        ? 'bg-emerald-400'
        : 'border border-devai-text-muted';

  const labelClass =
    step.status === 'active'
      ? 'text-cyan-400'
      : step.status === 'completed'
        ? 'text-devai-text'
        : 'text-devai-text-muted';

  return (
    <div className="flex gap-0 min-h-[24px]">
      <div className="flex flex-col items-center w-5 shrink-0">
        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotClass}`} />
        {!isLast && <div className="w-px flex-1 bg-devai-border mt-0.5" />}
      </div>
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${labelClass}`}>{step.label}</span>
          {step.duration != null && step.duration > 0 && (
            <span className="text-[10px] text-devai-text-muted">{formatDuration(step.duration)}</span>
          )}
        </div>
        {step.detail && (
          <p className="text-[11px] text-devai-text-muted font-mono truncate mt-0.5">{step.detail}</p>
        )}
        {step.type === 'thinking' && step.thinkingText && (
          <ThinkingPreview text={step.thinkingText} isActive={step.status === 'active'} />
        )}
      </div>
    </div>
  );
}
