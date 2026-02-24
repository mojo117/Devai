import type { DelegationDomain, LoopDelegationStatus, ScoutScope } from '../types.js';

export type ParallelAgent = 'devo' | 'caio' | 'scout';

export type ModelTierHint = 'fast' | 'standard';

export interface ParallelDelegation {
  target: ParallelAgent;
  domain: DelegationDomain;
  objective: string;
  context?: string;
  contextFacts: string[];
  constraints: string[];
  expectedOutcome?: string;
  scope?: ScoutScope;
  modelTier?: ModelTierHint;
}

function defaultDomainForAgent(target: ParallelAgent): DelegationDomain {
  if (target === 'devo') return 'development';
  if (target === 'caio') return 'communication';
  return 'research';
}

function normalizeDelegationDomain(value: unknown, fallback: DelegationDomain): DelegationDomain {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'development' || normalized === 'communication' || normalized === 'research') {
    return normalized;
  }
  return fallback;
}

function readFirstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function normalizeDelegationContext(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      console.warn('[delegationUtils] Context serialization failed:', err instanceof Error ? err.message : err);
      return undefined;
    }
  }
  return undefined;
}

export function buildDelegation(target: ParallelAgent, args: Record<string, unknown>): ParallelDelegation {
  const defaultDomain = defaultDomainForAgent(target);
  const domain = normalizeDelegationDomain(args.domain, defaultDomain);
  const objective = readFirstString(args, ['objective', 'task', 'query']) || 'Execute task';
  const contextFacts = readStringArray(args.contextFacts);
  const context = normalizeDelegationContext(args.context);
  const constraints = readStringArray(args.constraints);
  const expectedOutcome = readFirstString(args, ['expectedOutcome']) || objective;
  const scopeRaw = readFirstString(args, ['scope']);
  const scope: ScoutScope | undefined =
    scopeRaw === 'codebase' || scopeRaw === 'web' || scopeRaw === 'both'
      ? scopeRaw
      : undefined;
  const modelTierRaw = readFirstString(args, ['modelTier']);
  const modelTier: ModelTierHint | undefined =
    modelTierRaw === 'fast' || modelTierRaw === 'standard' ? modelTierRaw : undefined;

  return {
    target,
    domain,
    objective,
    context,
    contextFacts,
    constraints,
    expectedOutcome,
    scope,
    modelTier,
  };
}

export function parseParallelDelegations(raw: unknown): ParallelDelegation[] {
  if (!Array.isArray(raw)) return [];
  const parsed: ParallelDelegation[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const target = candidate.agent;

    if (target !== 'devo' && target !== 'caio' && target !== 'scout') {
      continue;
    }

    parsed.push(buildDelegation(target, candidate));
  }

  return parsed.filter((item) => item.objective.trim().length > 0);
}

export function formatDelegationContext(delegation: ParallelDelegation): string | undefined {
  const lines: string[] = [
    `Domain: ${delegation.domain}`,
    `Objective: ${delegation.objective}`,
  ];
  if (delegation.expectedOutcome) {
    lines.push(`Expected Outcome: ${delegation.expectedOutcome}`);
  }
  if (delegation.contextFacts.length > 0) {
    lines.push(`Context Facts: ${delegation.contextFacts.join('; ')}`);
  }
  if (delegation.constraints.length > 0) {
    lines.push(`Constraints: ${delegation.constraints.join('; ')}`);
  }
  if (delegation.context) {
    lines.push(`Context: ${delegation.context}`);
  }
  lines.push('Waehle die konkreten Tools innerhalb deiner Domaene selbst.');
  return lines.join('\n');
}

export function isDelegationSuccessful(status: LoopDelegationStatus): boolean {
  return status === 'success' || status === 'partial';
}

export function buildScoutDelegationFromArgs(
  args: Record<string, unknown>,
  fallbackObjective: string,
): ParallelDelegation {
  const query = typeof args.query === 'string' && args.query.trim().length > 0
    ? args.query.trim()
    : fallbackObjective;
  const scopeRaw = typeof args.scope === 'string' ? args.scope : '';
  const scope: ScoutScope = scopeRaw === 'codebase' || scopeRaw === 'web' || scopeRaw === 'both'
    ? scopeRaw
    : 'both';
  const context = typeof args.context === 'string' && args.context.trim().length > 0
    ? args.context.trim()
    : undefined;

  return {
    target: 'scout',
    domain: 'research',
    objective: query,
    expectedOutcome: query,
    context,
    contextFacts: [],
    constraints: [],
    scope,
  };
}
