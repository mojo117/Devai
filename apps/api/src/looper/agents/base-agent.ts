// ──────────────────────────────────────────────
// Looper-AI  –  Base Agent Interface
// All specialised agents implement this contract.
// ──────────────────────────────────────────────

import type { AgentType } from '@devai/shared';
import type { ToolExecutionResult } from '../../tools/executor.js';

export interface AgentContext {
  userMessage: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  previousResults?: string[];
}

export interface AgentResult {
  success: boolean;
  output: string;
  toolResults?: ToolExecutionResult[];
  /** If the agent needs a follow-up action. */
  needsFollowUp?: boolean;
  followUpHint?: string;
}

export interface LooperAgent {
  readonly type: AgentType;
  readonly description: string;
  execute(ctx: AgentContext): Promise<AgentResult>;
}
