import { nanoid } from 'nanoid';
import { getOrCreateState, getState, schedulePersist } from './core.js';
import { ensureActiveTurnId } from './sessionState.js';
import type { AgentName, ObligationOrigin, SessionObligation } from '../types.js';

interface ObligationQueryOptions {
  turnId?: string;
  blockingOnly?: boolean;
}

interface UserRequestObligationOptions {
  turnId?: string;
  origin?: ObligationOrigin;
  blocking?: boolean;
}

interface DelegationObligationOptions {
  turnId?: string;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripBulletPrefix(line: string): string {
  return line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .trim();
}

function splitUserRequestIntoClauses(request: string): string[] {
  const text = request.replace(/\r/g, '').trim();
  if (!text) return [];

  const lines = text
    .split('\n')
    .map(stripBulletPrefix)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);

  if (lines.length > 1) {
    return lines.slice(0, 6);
  }

  const byConjunction = text
    .split(/\s+(?:and|und|then|dann)\s+/i)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= 12);

  if (byConjunction.length > 1) {
    return byConjunction.slice(0, 6);
  }

  const bySentence = text
    .split(/[.;]\s+/)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= 12);

  if (bySentence.length > 1) {
    return bySentence.slice(0, 6);
  }

  return [text];
}

function createObligation(params: {
  type: SessionObligation['type'];
  description: string;
  requiredOutcome?: string;
  sourceAgent: AgentName;
  fingerprint?: string;
  metadata?: Record<string, unknown>;
  turnId: string;
  origin: ObligationOrigin;
  blocking: boolean;
}): SessionObligation {
  return {
    obligationId: nanoid(),
    type: params.type,
    description: params.description,
    requiredOutcome: params.requiredOutcome,
    sourceAgent: params.sourceAgent,
    status: 'open',
    evidence: [],
    fingerprint: params.fingerprint,
    turnId: params.turnId,
    origin: params.origin,
    blocking: params.blocking,
    metadata: params.metadata,
    createdAt: new Date().toISOString(),
  };
}

function mergeEvidence(obligation: SessionObligation, evidence?: string): void {
  if (!evidence) return;
  const value = evidence.trim();
  if (!value) return;
  if (!obligation.evidence.includes(value)) {
    obligation.evidence.push(value);
  }
}

function setObligationStatus(
  obligation: SessionObligation,
  status: SessionObligation['status'],
  evidence?: string,
): void {
  obligation.status = status;
  if (status !== 'open') {
    obligation.resolvedAt = new Date().toISOString();
  } else {
    delete obligation.resolvedAt;
  }
  mergeEvidence(obligation, evidence);
}

export function resetObligations(sessionId: string): void {
  const state = getOrCreateState(sessionId);
  state.obligations = [];
  schedulePersist(sessionId);
}

export function addUserRequestObligations(
  sessionId: string,
  request: string,
  options: UserRequestObligationOptions = {},
): SessionObligation[] {
  const state = getOrCreateState(sessionId);
  const turnId = ensureActiveTurnId(sessionId, options.turnId);
  const origin = options.origin || 'primary';
  const blocking = options.blocking ?? (origin !== 'inbox');
  const clauses = splitUserRequestIntoClauses(request);
  const created: SessionObligation[] = [];
  const seen = new Set<string>();

  for (const clause of clauses) {
    const normalized = normalizeText(clause);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    created.push(createObligation({
      type: 'user_request',
      description: clause,
      requiredOutcome: clause,
      sourceAgent: 'chapo',
      fingerprint: `user_request:${normalized}`,
      turnId,
      origin,
      blocking,
    }));
  }

  if (created.length === 0) {
    created.push(createObligation({
      type: 'user_request',
      description: request.trim() || 'User request',
      requiredOutcome: request.trim() || 'User request',
      sourceAgent: 'chapo',
      fingerprint: `user_request:${normalizeText(request || 'user request')}`,
      turnId,
      origin,
      blocking,
    }));
  }

  state.obligations.push(...created);
  schedulePersist(sessionId);
  return created;
}

export function addOrReuseDelegationObligation(
  sessionId: string,
  params: {
    target: AgentName;
    domain?: string;
    objective: string;
    expectedOutcome?: string;
  },
  options: DelegationObligationOptions = {},
): SessionObligation {
  const state = getOrCreateState(sessionId);
  const turnId = ensureActiveTurnId(sessionId, options.turnId);
  const objective = params.objective.trim() || 'Delegation objective';
  const expectedOutcome = params.expectedOutcome?.trim() || objective;
  const fingerprint = `delegation:${params.target}:${normalizeText(objective)}:${normalizeText(expectedOutcome)}`;

  const existing = state.obligations.find((obligation) =>
    obligation.type === 'delegation' &&
    obligation.turnId === turnId &&
    obligation.fingerprint === fingerprint &&
    (obligation.status === 'open' || obligation.status === 'failed')
  );

  if (existing) {
    setObligationStatus(existing, 'open', 'Delegation retried');
    schedulePersist(sessionId);
    return existing;
  }

  const obligation = createObligation({
    type: 'delegation',
    description: `Delegation to ${params.target.toUpperCase()}: ${objective}`,
    requiredOutcome: expectedOutcome,
    sourceAgent: 'chapo',
    fingerprint,
    turnId,
    origin: 'delegation',
    blocking: true,
    metadata: {
      target: params.target,
      domain: params.domain || '',
      objective,
      expectedOutcome,
    },
  });

  state.obligations.push(obligation);
  schedulePersist(sessionId);
  return obligation;
}

function getObligationForUpdate(sessionId: string, obligationId: string): SessionObligation | undefined {
  const state = getState(sessionId);
  return state?.obligations.find((obligation) => obligation.obligationId === obligationId);
}

export function satisfyObligation(sessionId: string, obligationId: string, evidence?: string): SessionObligation | undefined {
  const obligation = getObligationForUpdate(sessionId, obligationId);
  if (!obligation) return undefined;
  setObligationStatus(obligation, 'satisfied', evidence);
  schedulePersist(sessionId);
  return obligation;
}

export function failObligation(sessionId: string, obligationId: string, evidence?: string): SessionObligation | undefined {
  const obligation = getObligationForUpdate(sessionId, obligationId);
  if (!obligation) return undefined;
  setObligationStatus(obligation, 'failed', evidence);
  schedulePersist(sessionId);
  return obligation;
}

export function waiveObligation(sessionId: string, obligationId: string, evidence?: string): SessionObligation | undefined {
  const obligation = getObligationForUpdate(sessionId, obligationId);
  if (!obligation) return undefined;
  setObligationStatus(obligation, 'waived', evidence);
  schedulePersist(sessionId);
  return obligation;
}

export function getObligations(sessionId: string): SessionObligation[] {
  const state = getState(sessionId);
  return state?.obligations ?? [];
}

export function getUnresolvedObligations(
  sessionId: string,
  options: ObligationQueryOptions = {},
): SessionObligation[] {
  return getObligations(sessionId).filter((obligation) => {
    const unresolved = obligation.status === 'open' || obligation.status === 'failed';
    if (!unresolved) return false;

    if (options.turnId) {
      if (!obligation.turnId) return false;
      if (obligation.turnId !== options.turnId) return false;
    }

    if (options.blockingOnly) {
      if (!obligation.blocking) return false;
    }

    return true;
  });
}

export function getUnresolvedObligationsForTurn(
  sessionId: string,
  turnId: string,
  options: { blockingOnly?: boolean } = {},
): SessionObligation[] {
  return getUnresolvedObligations(sessionId, { turnId, blockingOnly: options.blockingOnly });
}

export function waiveObligationsExceptTurn(
  sessionId: string,
  turnId: string,
  evidence: string = 'Waived: superseded by a newer user turn.',
): number {
  const state = getState(sessionId);
  if (!state) return 0;

  let waivedCount = 0;
  for (const obligation of state.obligations) {
    const unresolved = obligation.status === 'open' || obligation.status === 'failed';
    if (!unresolved) continue;
    if (!obligation.turnId || obligation.turnId !== turnId) {
      setObligationStatus(obligation, 'waived', evidence);
      waivedCount += 1;
    }
  }

  if (waivedCount > 0) {
    schedulePersist(sessionId);
  }
  return waivedCount;
}

export function summarizeUnresolvedObligations(
  sessionId: string,
  maxItems: number = 4,
  options: ObligationQueryOptions = {},
): string {
  const unresolved = getUnresolvedObligations(sessionId, options);
  if (unresolved.length === 0) return 'Keine offenen Verpflichtungen.';

  const lines = unresolved.slice(0, maxItems).map((obligation) => {
    const status = obligation.status === 'failed' ? 'FAILED' : 'OPEN';
    const required = obligation.requiredOutcome?.trim();
    return `- [${status}] ${required || obligation.description}`;
  });
  if (unresolved.length > maxItems) {
    lines.push(`- ... +${unresolved.length - maxItems} weitere`);
  }
  return lines.join('\n');
}
