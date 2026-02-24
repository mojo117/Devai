import { useState } from 'react';
import type { DelegationData } from './types';
import { ToolTimeline } from './ToolTimeline';

const AGENT_ICONS: Record<string, string> = {
  chapo: '\u{1F3AF}',
  devo: '\u{1F527}',
  scout: '\u{1F50D}',
  caio: '\u{1F4CB}',
};

const AGENT_COLORS: Record<string, string> = {
  chapo: 'text-purple-400',
  devo: 'text-devai-accent',
  scout: 'text-cyan-400',
  caio: 'text-emerald-400',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  working: { label: 'working', color: 'text-yellow-400' },
  completed: { label: 'completed', color: 'text-emerald-400' },
  failed: { label: 'failed', color: 'text-red-400' },
  escalated: { label: 'escalated', color: 'text-amber-400' },
};

function formatDuration(ms?: number): string {
  if (ms == null) return '...';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function DelegationCard({ delegation }: { delegation: DelegationData }) {
  const [expanded, setExpanded] = useState(false);
  const fromIcon = AGENT_ICONS[delegation.from] || '';
  const toIcon = AGENT_ICONS[delegation.to] || '';
  const toColor = AGENT_COLORS[delegation.to] || 'text-devai-text';
  const statusInfo = STATUS_LABELS[delegation.status] || STATUS_LABELS.working;
  const toolCount = delegation.toolSteps.length;
  const isWorking = delegation.status === 'working';

  const progressMax = isWorking ? Math.max(toolCount + 2, 4) : toolCount;
  const progressPct = progressMax > 0 ? Math.min((toolCount / progressMax) * 100, 100) : 0;

  return (
    <div className="flex justify-start">
      <div
        className="rounded-xl border border-devai-border bg-devai-card max-w-[85%] w-full overflow-hidden cursor-pointer hover:border-devai-border/80 transition-colors"
        onClick={() => setExpanded(prev => !prev)}
      >
        {/* Header */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-mono">
              <span>{fromIcon}</span>
              <span className="text-devai-text-muted">{delegation.from.toUpperCase()}</span>
              <span className="text-devai-text-muted">{'\u2192'}</span>
              <span>{toIcon}</span>
              <span className={toColor}>{delegation.to.toUpperCase()}</span>
            </div>
            <span className="text-xs text-devai-text-muted font-mono">
              {formatDuration(delegation.durationMs)}
            </span>
          </div>

          <p className="text-xs text-devai-text-secondary leading-relaxed line-clamp-2">
            {delegation.task}
          </p>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-1 bg-devai-surface rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isWorking ? 'animate-pulse' : ''
                } ${delegation.status === 'failed' ? 'bg-red-500' : 'bg-devai-accent'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] text-devai-text-muted font-mono whitespace-nowrap">
              Tools: {toolCount}
            </span>
            <span className={`text-[10px] font-mono ${statusInfo.color}`}>
              {delegation.status === 'completed' ? '\u2713' : delegation.status === 'failed' ? '\u2717' : '\u25CF'}{' '}
              {statusInfo.label}
            </span>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-devai-border px-4 py-3 space-y-3">
            {delegation.prompt && (
              <div className="rounded-lg bg-devai-surface/50 border border-devai-border/50 px-3 py-2">
                <p className="text-[10px] text-devai-text-muted font-mono mb-1">Delegation Prompt</p>
                <p className="text-xs text-devai-text-secondary leading-relaxed whitespace-pre-wrap">
                  {delegation.prompt.length > 500 ? `${delegation.prompt.slice(0, 500)}...` : delegation.prompt}
                </p>
              </div>
            )}

            {delegation.toolSteps.length > 0 && (
              <ToolTimeline steps={delegation.toolSteps} />
            )}

            {delegation.response && (
              <div className="rounded-lg bg-devai-surface/50 border border-devai-border/50 px-3 py-2">
                <p className="text-[10px] text-devai-text-muted font-mono mb-1">
                  {delegation.to.toUpperCase()} Response
                </p>
                <p className="text-xs text-devai-text-secondary leading-relaxed whitespace-pre-wrap">
                  {delegation.response.length > 800 ? `${delegation.response.slice(0, 800)}...` : delegation.response}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-1.5 text-center">
          <span className="text-[10px] text-devai-text-muted font-mono">
            {expanded ? '\u25BE Hide delegation details' : '\u25B8 Show delegation details'}
          </span>
        </div>
      </div>
    </div>
  );
}
