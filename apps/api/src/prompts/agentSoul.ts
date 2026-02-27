/**
 * Agent Soul — personality/identity loading.
 *
 * With single-agent mode (CHAPO only), this module is retained for API
 * compatibility but returns empty results.
 */

export type AgentSoulName = 'chapo';

export interface AgentSoulStatus {
  agent: AgentSoulName;
  soulFile: string;
  soulPath: string | null;
  loaded: boolean;
  charCount: number;
}

export function getAgentSoulBlock(_agent: AgentSoulName): string {
  return '';
}

export function getAgentSoulStatusReport(): AgentSoulStatus[] {
  return [];
}
