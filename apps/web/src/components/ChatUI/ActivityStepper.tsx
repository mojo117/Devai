import { useState, useEffect, useRef } from 'react';
import type { StepperStep } from './types';
import { StepperStepRow } from './StepperStepRow';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ActivityStepper({ steps, live }: { steps: StepperStep[]; live: boolean }) {
  const [expanded, setExpanded] = useState(live);
  const prevLive = useRef(live);

  useEffect(() => {
    if (prevLive.current && !live) {
      setExpanded(false);
    }
    prevLive.current = live;
  }, [live]);

  useEffect(() => {
    if (live) setExpanded(true);
  }, [live]);

  if (steps.length === 0) return null;

  const summaryLabels: string[] = [];
  const seenKeys = new Set<string>();
  for (const s of steps) {
    if (s.type === 'status') continue;
    const key = s.toolName || s.type;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    summaryLabels.push(s.label);
    if (summaryLabels.length >= 4) break;
  }

  const totalDuration = steps.reduce((sum, s) => sum + (s.duration ?? 0), 0);

  if (!expanded) {
    return (
      <div className="flex justify-start">
        <button
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1.5 text-[11px] text-devai-text-muted bg-devai-surface/50 border border-devai-border/50 rounded-lg px-3 py-1.5 hover:border-devai-border transition-colors"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          <span>{summaryLabels.join(' \u00B7 ')}</span>
          {totalDuration > 0 && (
            <span className="text-devai-text-muted/60 ml-1">{formatDuration(totalDuration)}</span>
          )}
          <span className="text-[10px] opacity-60">{'\u25BC'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className="bg-devai-surface/30 border border-devai-border/50 rounded-lg px-3 py-2 w-full md:max-w-[85%] cursor-pointer"
        onClick={() => { if (!live) setExpanded(false); }}
      >
        {steps.map((step, i) => (
          <StepperStepRow key={step.id} step={step} isLast={i === steps.length - 1} />
        ))}
        {!live && (
          <div className="flex justify-end mt-1">
            <span className="text-[10px] text-devai-text-muted/50">{'\u25B2'} collapse</span>
          </div>
        )}
      </div>
    </div>
  );
}
