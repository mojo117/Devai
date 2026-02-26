/**
 * Engine Profiles — switchable model configurations.
 *
 * Usage: /engine <glm|gemini|claude> from Telegram or web chat.
 * Stored per-session in gatheredInfo.engineProfile.
 */

import type { AgentName } from '../agents/types.js';

export type EngineName = 'glm' | 'gemini' | 'claude' | 'kimi';

export interface AgentModelOverride {
  model: string;
  fastModel?: string;
  fallbackModel?: string;
  /** Try this model on the same provider before falling back cross-provider. */
  sameProviderFallback?: string;
}

export type EngineProfile = Partial<Record<AgentName, AgentModelOverride>>;

/**
 * Engine profile definitions.
 *
 * Single-agent mode: all profiles configure CHAPO only.
 */
export const ENGINE_PROFILES: Record<EngineName, EngineProfile> = {
  glm: {
    chapo: { model: 'glm-5', fastModel: 'glm-4.7-flash', fallbackModel: 'claude-opus-4-5-20251101', sameProviderFallback: 'glm-4.7' },
  },
  gemini: {
    chapo: { model: 'gemini-3.1-pro-preview', fastModel: 'glm-4.7-flash', fallbackModel: 'glm-5' },
  },
  claude: {
    chapo: { model: 'claude-opus-4-5-20251101', fastModel: 'glm-4.7-flash', fallbackModel: 'glm-5' },
  },
  kimi: {
    chapo: { model: 'kimi-k2.5', fastModel: 'glm-4.7-flash', fallbackModel: 'glm-5', sameProviderFallback: 'glm-4.7' },
  },
};

export const ENGINE_NAMES = Object.keys(ENGINE_PROFILES) as EngineName[];

export function isValidEngine(name: string): name is EngineName {
  return ENGINE_NAMES.includes(name as EngineName);
}

export function getEngineProfile(name: EngineName): EngineProfile {
  return ENGINE_PROFILES[name];
}

/** Build a human-readable summary of the engine profile */
export function formatEngineStatus(engine: EngineName): string {
  const p = ENGINE_PROFILES[engine];
  const fb = (o?: AgentModelOverride) => {
    const parts: string[] = [];
    if (o?.sameProviderFallback) parts.push(o.sameProviderFallback);
    if (o?.fallbackModel) parts.push(o.fallbackModel);
    return parts.length ? parts.join(' → ') : 'none';
  };
  return [
    `Engine: ${engine.toUpperCase()}`,
    `  CHAPO: ${p.chapo?.model} / fast: ${p.chapo?.fastModel ?? 'none'} (fallback: ${fb(p.chapo)})`,
  ].join('\n');
}
