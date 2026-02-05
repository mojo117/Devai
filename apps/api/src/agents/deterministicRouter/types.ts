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
 * Full routing result
 */
export interface RoutingResult {
  type: 'execute' | 'question' | 'error';
  // For execute
  tasks?: AssignedTask[];
  // For question
  question?: string;
  // For error
  error?: string;
}

/**
 * Result after executing all tasks
 */
export interface ExecutionResult {
  type: 'success' | 'question' | 'error';
  results?: Map<number, AgentExecutionResult>;
  question?: string;
  error?: string;
}

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
