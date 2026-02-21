import { getToolsForLLM } from '../../tools/registry.js';
import type { DelegationDomain, ScoutScope } from '../types.js';

export type ParallelAgent = 'devo' | 'caio' | 'scout';

export interface ParallelDelegation {
  target: ParallelAgent;
  domain: DelegationDomain;
  objective: string;
  context?: string;
  contextFacts: string[];
  constraints: string[];
  expectedOutcome?: string;
  scope?: ScoutScope;
}

let toolDirectiveRegex: RegExp | null = null;

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

function getToolDirectiveRegex(): RegExp | null {
  if (toolDirectiveRegex) return toolDirectiveRegex;
  const toolNames = getToolsForLLM()
    .map((tool) => tool.name)
    .filter((name) => !name.startsWith('delegate') && name !== 'askUser' && name !== 'requestApproval')
    .sort((a, b) => b.length - a.length);

  if (toolNames.length === 0) return null;

  const escaped = toolNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  toolDirectiveRegex = new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
  return toolDirectiveRegex;
}

export function sanitizeDelegationText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const regex = getToolDirectiveRegex();
  if (!regex) return trimmed;
  return trimmed.replace(regex, 'passendes Tool');
}

function normalizeDelegationContext(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const sanitized = sanitizeDelegationText(value.trim());
    return sanitized.length > 0 ? sanitized : undefined;
  }
  if (value && typeof value === 'object') {
    try {
      return sanitizeDelegationText(JSON.stringify(value, null, 2));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function buildDelegation(target: ParallelAgent, args: Record<string, unknown>): ParallelDelegation {
  const defaultDomain = defaultDomainForAgent(target);
  const domain = normalizeDelegationDomain(args.domain, defaultDomain);
  const objectiveRaw = readFirstString(args, ['objective', 'task', 'query']) || 'Aufgabe ausfuehren';
  const objective = sanitizeDelegationText(objectiveRaw);
  const contextFacts = readStringArray(args.contextFacts).map((item) => sanitizeDelegationText(item));
  const context = normalizeDelegationContext(args.context);
  const constraints = readStringArray(args.constraints).map((item) => sanitizeDelegationText(item));
  const expectedOutcome = readFirstString(args, ['expectedOutcome']) || undefined;
  const scopeRaw = readFirstString(args, ['scope']);
  const scope: ScoutScope | undefined =
    scopeRaw === 'codebase' || scopeRaw === 'web' || scopeRaw === 'both'
      ? scopeRaw
      : undefined;

  return {
    target,
    domain,
    objective,
    context,
    contextFacts,
    constraints,
    expectedOutcome,
    scope,
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
