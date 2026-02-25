import { nanoid } from 'nanoid';
import { getSupabase } from './index.js';

export type AgentName = 'chapo' | 'devo' | 'caio' | 'scout';
export type AgentExecutionPhase = 'start' | 'success' | 'failure' | 'escalated';

export interface AgentExecutionLogRow {
  id: string;
  session_id: string;
  agent: AgentName;
  delegated_from: AgentName | null;
  phase: AgentExecutionPhase;
  duration_ms: number | null;
  iterations: number;
  tokens_used: number | null;
  tool_count: number;
  model: string | null;
  provider: string | null;
  delegation_objective: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LogAgentExecutionParams {
  sessionId: string;
  agent: AgentName;
  delegatedFrom?: AgentName;
  phase: AgentExecutionPhase;
  durationMs?: number;
  iterations?: number;
  tokensUsed?: number;
  toolCount?: number;
  model?: string;
  provider?: string;
  delegationObjective?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export async function logAgentExecution(params: LogAgentExecutionParams): Promise<string> {
  const id = nanoid();
  const row = {
    id,
    session_id: params.sessionId,
    agent: params.agent,
    delegated_from: params.delegatedFrom || null,
    phase: params.phase,
    duration_ms: params.durationMs ?? null,
    iterations: params.iterations ?? 0,
    tokens_used: params.tokensUsed ?? null,
    tool_count: params.toolCount ?? 0,
    model: params.model || null,
    provider: params.provider || null,
    delegation_objective: params.delegationObjective?.slice(0, 500) || null,
    error_message: params.errorMessage?.slice(0, 1000) || null,
    metadata: params.metadata || null,
    created_at: new Date().toISOString(),
  };

  const { error } = await getSupabase()
    .from('agent_execution_logs')
    .insert(row);

  if (error) {
    console.error('[AgentExecution] Failed to log:', error);
  }

  return id;
}

export interface AgentExecutionStatsRow {
  id: string;
  session_id: string;
  agent: AgentName;
  delegated_from: AgentName | null;
  phase: string;
  duration_ms: number | null;
  iterations: number;
  tokens_used: number | null;
  tool_count: number;
  model: string | null;
  provider: string | null;
  delegation_objective: string | null;
  created_at: string;
}

export async function getAgentExecutionStats(sinceMinutes: number = 90): Promise<AgentExecutionStatsRow[]> {
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString();

  const { data, error } = await getSupabase()
    .from('agent_execution_logs')
    .select('id, session_id, agent, delegated_from, phase, duration_ms, iterations, tokens_used, tool_count, model, provider, delegation_objective, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[AgentExecution] Failed to fetch stats:', error);
    return [];
  }

  return (data || []) as AgentExecutionStatsRow[];
}

export async function getAgentExecutionStatsBySession(sessionId: string): Promise<AgentExecutionStatsRow[]> {
  const { data, error } = await getSupabase()
    .from('agent_execution_logs')
    .select('id, session_id, agent, delegated_from, phase, duration_ms, iterations, tokens_used, tool_count, model, provider, delegation_objective, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[AgentExecution] Failed to fetch session stats:', error);
    return [];
  }

  return (data || []) as AgentExecutionStatsRow[];
}
