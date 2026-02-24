/**
 * Engine Profiles — switchable model configurations for all agents.
 *
 * Usage: /engine <glm|gemini|claude> from Telegram or web chat.
 * Stored per-session in gatheredInfo.engineProfile.
 */

import type { AgentName } from '../agents/types.js';

export type EngineName = 'glm' | 'gemini' | 'claude';

export interface AgentModelOverride {
  model: string;
  fastModel?: string;
  fallbackModel?: string;
}

export type EngineProfile = Partial<Record<AgentName, AgentModelOverride>>;

/**
 * Engine profile definitions.
 *
 * All profiles keep glm-4.7-flash (FREE) for SCOUT and DEVO fast tasks.
 * CAIO uses glm-4.7 across all profiles (upgraded for better time reasoning).
 */
export const ENGINE_PROFILES: Record<EngineName, EngineProfile> = {
  glm: {
    chapo: { model: 'glm-5', fallbackModel: 'claude-opus-4-5-20251101' },
    devo: { model: 'glm-5', fastModel: 'glm-4.7-flash', fallbackModel: 'claude-sonnet-4-20250514' },
    scout: { model: 'glm-4.7-flash', fallbackModel: 'claude-sonnet-4-20250514' },
    caio: { model: 'glm-4.7', fallbackModel: 'claude-sonnet-4-20250514' },
  },
  gemini: {
    chapo: { model: 'gemini-3.1-pro-preview', fallbackModel: 'glm-5' },
    devo: { model: 'gemini-3.1-pro-preview', fastModel: 'glm-4.7-flash', fallbackModel: 'glm-5' },
    scout: { model: 'glm-4.7-flash', fallbackModel: 'gemini-3.1-pro-preview' },
    caio: { model: 'glm-4.7', fallbackModel: 'gemini-3.1-pro-preview' },
  },
  claude: {
    chapo: { model: 'claude-opus-4-5-20251101', fallbackModel: 'glm-5' },
    devo: { model: 'claude-sonnet-4-20250514', fastModel: 'glm-4.7-flash', fallbackModel: 'glm-5' },
    scout: { model: 'glm-4.7-flash', fallbackModel: 'claude-sonnet-4-20250514' },
    caio: { model: 'glm-4.7', fallbackModel: 'claude-sonnet-4-20250514' },
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
  return [
    `Engine: ${engine.toUpperCase()}`,
    `  CHAPO: ${p.chapo?.model} (fallback: ${p.chapo?.fallbackModel})`,
    `  DEVO:  ${p.devo?.model} / fast: ${p.devo?.fastModel ?? 'none'} (fallback: ${p.devo?.fallbackModel})`,
    `  SCOUT: ${p.scout?.model} (fallback: ${p.scout?.fallbackModel})`,
  ].join('\n');
}
