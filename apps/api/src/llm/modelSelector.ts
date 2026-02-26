/**
 * Model Selector
 *
 * Resolves the best available LLM provider for an agent's configured model.
 * Agent definitions declare their own models — this module handles provider
 * availability, fallback, and engine profile overrides.
 */

import type { ModelSelection, LLMProviderName } from '../agents/types.js';
import type { AgentDefinition } from '../agents/types.js';
import { llmRouter } from './router.js';
import { getEngineProfile, type EngineName } from './engineProfiles.js';
import { getState } from '../agents/stateManager.js';

/** Provider preference order when the primary isn't available */
const PROVIDER_FALLBACK_ORDER: LLMProviderName[] = ['zai', 'anthropic', 'openai', 'gemini', 'moonshot'];

/**
 * Read the active engine profile from session state, if any.
 */
function getSessionEngine(sessionId?: string): EngineName | null {
  if (!sessionId) return null;
  const state = getState(sessionId);
  const engine = state?.taskContext.gatheredInfo.engineProfile;
  if (typeof engine === 'string') return engine as EngineName;
  return null;
}

/**
 * Resolve the model selection for an agent, checking provider availability.
 * If sessionId is provided and an engine profile is active, use the profile's
 * model overrides instead of the agent defaults.
 *
 * Priority:
 *  1. Engine profile model (if active) or agent's primary model
 *  2. Engine profile fallback (if active) or agent's fallback model
 *  3. First configured provider with its default model
 */
export function resolveModelSelection(agent: AgentDefinition, sessionId?: string): ModelSelection {
  const engine = getSessionEngine(sessionId);
  const override = engine ? getEngineProfile(engine)[agent.name] : null;

  const effectiveModel = override?.model ?? agent.model;
  const effectiveFallback = override?.fallbackModel ?? agent.fallbackModel;
  const sameProviderFallback = override?.sameProviderFallback;
  const reasonPrefix = engine ? `${agent.name} (engine: ${engine})` : `${agent.name} default`;

  // Try primary model — detect provider from model name
  const primaryProvider = detectProvider(effectiveModel);
  if (primaryProvider && llmRouter.isProviderConfigured(primaryProvider)) {
    return {
      provider: primaryProvider,
      model: effectiveModel,
      reason: reasonPrefix,
      sameProviderFallbacks: sameProviderFallback ? [sameProviderFallback] : undefined,
    };
  }

  // Try fallback model
  if (effectiveFallback) {
    const fallbackProvider = detectProvider(effectiveFallback);
    if (fallbackProvider && llmRouter.isProviderConfigured(fallbackProvider)) {
      return {
        provider: fallbackProvider,
        model: effectiveFallback,
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

/**
 * Resolve the model for a delegated agent, respecting the model tier hint.
 * 'fast' uses agent.fastModel (if defined), 'standard' uses agent.model.
 * If sessionId is provided and an engine profile is active, use profile overrides.
 */
export function resolveDelegationModel(
  agent: AgentDefinition,
  modelTier: 'fast' | 'standard' | undefined,
  baseProvider: LLMProviderName,
  sessionId?: string,
): { provider: LLMProviderName; model: string; sameProviderFallbacks?: string[] } {
  const engine = getSessionEngine(sessionId);
  const override = engine ? getEngineProfile(engine)[agent.name] : null;

  const effectiveModel = override?.model ?? agent.model;
  const effectiveFastModel = override?.fastModel ?? agent.fastModel;
  const sameProviderFallback = override?.sameProviderFallback;

  const model = modelTier === 'fast' && effectiveFastModel
    ? effectiveFastModel
    : effectiveModel;
  const provider = detectProvider(model) || baseProvider;
  return {
    provider,
    model,
    sameProviderFallbacks: sameProviderFallback ? [sameProviderFallback] : undefined,
  };
}

function detectProvider(model: string): LLMProviderName | null {
  if (model.startsWith('glm-')) return 'zai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('kimi-')) return 'moonshot';
  return null;
}
