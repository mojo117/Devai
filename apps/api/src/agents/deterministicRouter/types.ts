// apps/api/src/agents/deterministicRouter/types.ts
import type { AgentName } from '../types.js';
import type { CapabilityAnalysis, TaskBreakdown } from '../analyzer/types.js';

/**
 * Result from an agent execution
 */
export interface AgentExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  uncertain?: boolean;
  uncertaintyReason?: string;
}

/**
 * Task with assigned agent
 */
export interface AssignedTask extends TaskBreakdown {
  index: number;
  agent: AgentName;
}

/**
 * Routing result - discriminated union for type safety
 */
export type RoutingResult =
  | { type: 'execute'; tasks: AssignedTask[]; question?: never; error?: never }
  | { type: 'question'; question: string; tasks?: never; error?: never }
  | { type: 'error'; error: string; tasks?: never; question?: never };

/**
 * Execution result - discriminated union for type safety
 */
export type ExecutionResult =
  | { type: 'success'; results: Map<number, AgentExecutionResult>; question?: never; error?: never }
  | { type: 'question'; question: string; results?: never; error?: never }
  | { type: 'error'; error: string; results?: never; question?: never };

/**
 * Capability to agent mapping
 */
export const CAPABILITY_AGENT_MAP: Record<string, AgentName> = {
  web_search: 'scout',
  code_read: 'koda',
  code_write: 'koda',
  devops: 'devo',
};

// Re-export for convenience
export type { CapabilityAnalysis, TaskBreakdown };
