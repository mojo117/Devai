/**
 * AgentStatus Component
 *
 * Displays the current status of the multi-agent system.
 * Shows which agent is active and its current state.
 */

import { useMemo } from 'react';

export type AgentName = 'chapo' | 'devo' | 'scout';
export type AgentPhase = 'qualification' | 'thinking' | 'execution' | 'executing' | 'review' | 'error' | 'idle';

interface AgentStatusProps {
  activeAgent: AgentName | null;
  phase: AgentPhase;
  statusMessage?: string;
  isProcessing?: boolean;
}

const agentInfo: Record<AgentName, { name: string; role: string; color: string; icon: string }> = {
  chapo: {
    name: 'CHAPO',
    role: 'Task Coordinator',
    color: 'text-purple-300 border-purple-500/40 bg-purple-900/10',
    icon: '🎯',
  },
  devo: {
    name: 'DEVO',
    role: 'Developer & DevOps',
    color: 'text-emerald-300 border-emerald-500/40 bg-emerald-900/10',
    icon: '🔧',
  },
  scout: {
    name: 'SCOUT',
    role: 'Explorer & Researcher',
    color: 'text-devai-accent border-devai-accent/40 bg-devai-accent/10',
    icon: '🔍',
  },
};

const phaseLabels: Record<AgentPhase, string> = {
  qualification: 'Analyzing request...',
  thinking: 'Thinking...',
  execution: 'Executing task...',
  executing: 'Executing task...',
  review: 'Reviewing results...',
  error: 'Error occurred',
  idle: 'Ready',
};

export function AgentStatus({
  activeAgent,
  phase,
  statusMessage,
  isProcessing = false,
}: AgentStatusProps) {
  const agent = useMemo(() => (activeAgent ? agentInfo[activeAgent] : null), [activeAgent]);

  if (!agent) {
    return (
      <div className="bg-devai-card border border-devai-border rounded-lg p-3">
        <div className="flex items-center gap-2 text-devai-text-secondary">
          <span className="text-lg">🤖</span>
          <span className="text-sm">Multi-Agent System</span>
          <span className="text-xs text-devai-text-muted ml-auto">Idle</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`border rounded-lg p-3 ${agent.color}`}>
      {/* Agent Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{agent.icon}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{agent.name}</span>
            <span className="text-xs opacity-70">({agent.role})</span>
          </div>
        </div>
        {isProcessing && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
            <span className="text-xs">Processing</span>
          </div>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 text-sm">
        <span className="opacity-70">Status:</span>
        <span>{statusMessage || phaseLabels[phase]}</span>
      </div>

      {/* Phase Indicator */}
      <div className="mt-2 flex items-center gap-1">
        {(['qualification', 'execution', 'review'] as AgentPhase[]).map((p, i) => (
          <div
            key={p}
            className={`flex-1 h-1 rounded-full transition-colors ${
              phase === p
                ? 'bg-current'
                : phase === 'error'
                ? 'bg-red-500/50'
                : i < ['qualification', 'execution', 'review'].indexOf(phase)
                ? 'bg-current opacity-50'
                : 'bg-devai-border'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Compact agent badge for inline display
 */
interface AgentBadgeProps {
  agent: AgentName;
  size?: 'sm' | 'md';
}

export function AgentBadge({ agent, size = 'sm' }: AgentBadgeProps) {
  const info = agentInfo[agent];
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${info.color} ${sizeClasses}`}
    >
      <span>{info.icon}</span>
      <span className="font-medium">{info.name}</span>
    </span>
  );
}

