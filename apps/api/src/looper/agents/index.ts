// ──────────────────────────────────────────────
// Looper-AI  –  Agent Registry
// ──────────────────────────────────────────────

import type { AgentType } from '@devai/shared';
import type { LLMProvider } from '../../llm/types.js';
import type { LooperAgent } from './base-agent.js';
import { DeveloperAgent } from './developer.js';
import { SearcherAgent } from './searcher.js';
import { DocumentManagerAgent } from './document-manager.js';
import { CommanderAgent } from './commander.js';

export type { LooperAgent, AgentContext, AgentResult } from './base-agent.js';

/**
 * Create all agent instances for a given LLM provider.
 */
export function createAgents(provider: LLMProvider): Map<AgentType, LooperAgent> {
  const agents = new Map<AgentType, LooperAgent>();
  agents.set('developer', new DeveloperAgent(provider));
  agents.set('searcher', new SearcherAgent(provider));
  agents.set('document_manager', new DocumentManagerAgent(provider));
  agents.set('commander', new CommanderAgent(provider));
  return agents;
}
