/**
 * AgentStatus Component
 *
 * Displays the current status of the multi-agent system.
 * Shows which agent is active and its current state.
 */

import { useMemo } from 'react';

export type AgentName = 'chapo' | 'koda' | 'devo';
export type AgentPhase = 'qualification' | 'execution' | 'review' | 'error' | 'idle';

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
    color: 'text-purple-400 border-purple-500 bg-purple-900/20',
    icon: '🎯',
  },
  koda: {
    name: 'KODA',
    role: 'Senior Developer',
    color: 'text-blue-400 border-blue-500 bg-blue-900/20',
    icon: '💻',
  },
  devo: {
    name: 'DEVO',
    role: 'DevOps Engineer',
    color: 'text-green-400 border-green-500 bg-green-900/20',
    icon: '🔧',
  },
};

const phaseLabels: Record<AgentPhase, string> = {
  qualification: 'Analyzing request...',
  execution: 'Executing task...',
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
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
        <div className="flex items-center gap-2 text-gray-400">
          <span className="text-lg">🤖</span>
          <span className="text-sm">Multi-Agent System</span>
          <span className="text-xs text-gray-500 ml-auto">Idle</span>
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
                : 'bg-gray-600'
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

/**
 * Agent workflow diagram showing the flow between agents
 */
interface AgentWorkflowProps {
  activeAgent: AgentName | null;
  completedSteps: AgentName[];
}

export function AgentWorkflow({ activeAgent, completedSteps }: AgentWorkflowProps) {
  const agents: AgentName[] = ['chapo', 'koda', 'devo'];

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-3">Agent Workflow</div>

      <div className="flex items-center justify-between">
        {agents.map((agent, i) => {
          const info = agentInfo[agent];
          const isActive = activeAgent === agent;
          const isCompleted = completedSteps.includes(agent);

          return (
            <div key={agent} className="flex items-center">
              <div
                className={`flex flex-col items-center ${
                  isActive
                    ? info.color
                    : isCompleted
                    ? 'text-gray-400'
                    : 'text-gray-600'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${
                    isActive
                      ? 'border-current bg-current/20'
                      : isCompleted
                      ? 'border-gray-500 bg-gray-700'
                      : 'border-gray-700'
                  }`}
                >
                  <span className="text-lg">{info.icon}</span>
                </div>
                <span className="text-xs mt-1 font-medium">{info.name}</span>
                <span className="text-[10px] opacity-70">{info.role}</span>
              </div>

              {i < agents.length - 1 && (
                <div className="flex-1 h-0.5 mx-2 bg-gray-700 relative">
                  {(isCompleted || (activeAgent === agents[i + 1])) && (
                    <div className="absolute inset-0 bg-gray-500" />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
