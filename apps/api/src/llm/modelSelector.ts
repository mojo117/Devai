/**
 * Model Selector
 *
 * Resolves the best available LLM provider for an agent's configured model.
 * Agent definitions declare their own models — this module handles provider
 * availability and fallback, not task classification.
 */

import type { ModelSelection, LLMProviderName } from '../agents/types.js';
import type { AgentDefinition } from '../agents/types.js';
import { llmRouter } from './router.js';

/** Provider preference order when the primary isn't available */
const PROVIDER_FALLBACK_ORDER: LLMProviderName[] = ['zai', 'anthropic', 'openai', 'gemini'];

/**
 * Resolve the model selection for an agent, checking provider availability.
 *
 * Priority:
 *  1. Agent's primary model on its default provider
 *  2. Agent's fallback model (if defined)
 *  3. First configured provider with its default model
 */
export function resolveModelSelection(agent: AgentDefinition): ModelSelection {
  // Try primary model — detect provider from model name
  const primaryProvider = detectProvider(agent.model);
  if (primaryProvider && llmRouter.isProviderConfigured(primaryProvider)) {
    return {
      provider: primaryProvider,
      model: agent.model,
      reason: `${agent.name} default`,
    };
  }

  // Try fallback model
  if (agent.fallbackModel) {
    const fallbackProvider = detectProvider(agent.fallbackModel);
    if (fallbackProvider && llmRouter.isProviderConfigured(fallbackProvider)) {
      return {
        provider: fallbackProvider,
        model: agent.fallbackModel,
        reason: `${agent.name} fallback (${primaryProvider || 'unknown'} unavailable)`,
      };
    }
  }

  // Last resort: any configured provider
  for (const provider of PROVIDER_FALLBACK_ORDER) {
    if (llmRouter.isProviderConfigured(provider)) {
      const models = llmRouter.listModels(provider);
      return {
        provider,
        model: models[0] || 'claude-sonnet-4-20250514',
        reason: `Fallback: only ${provider} configured`,
      };
    }
  }

  throw new Error('No LLM provider configured');
}

function detectProvider(model: string): LLMProviderName | null {
  if (model.startsWith('glm-')) return 'zai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('gemini-')) return 'gemini';
  return null;
}
