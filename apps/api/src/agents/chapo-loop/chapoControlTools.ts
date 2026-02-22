import * as stateManager from '../stateManager.js';
import type { AgentName, SessionObligation } from '../types.js';

export type InboxScope = 'all' | 'current_task';
export type InboxResolution = 'done' | 'wont_do' | 'superseded' | 'blocked';
export type PlanStepStatus = 'todo' | 'doing' | 'done' | 'blocked';
export type PreflightIssueType = 'missing_answer' | 'contradiction' | 'unverified_claim' | 'language_mismatch';

const KEYWORD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'then', 'also', 'into', 'about',
  'und', 'oder', 'dann', 'aber', 'eine', 'einen', 'einem', 'einer', 'dies', 'diese',
  'bitte', 'sowie', 'bzw', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine',
  'task', 'tasks', 'request', 'delegation', 'user', 'antwort', 'frage',
]);

const PLAN_STEP_STATUSES = new Set<PlanStepStatus>(['todo', 'doing', 'done', 'blocked']);
const PLAN_STEP_OWNERS = new Set<AgentName>(['chapo', 'devo', 'scout', 'caio']);

export interface InboxOpenItem {
  id: string;
  text: string;
  sourceMessageId: string;
  status: 'open' | 'blocked';
  createdAt: string;
  owner?: AgentName;
  contextType: string;
}

export interface ChapoPlanStep {
  id: string;
  text: string;
  owner: AgentName;
  status: PlanStepStatus;
}

export interface PreflightIssue {
  type: PreflightIssueType;
  detail: string;
}

export interface InboxListResult {
  items: InboxOpenItem[];
  count: number;
  totalOpen: number;
  scope: InboxScope;
  turnId?: string;
}

export interface InboxResolveResult {
  success: boolean;
  id: string;
  newStatus?: string;
  updatedAt?: string;
  error?: string;
}

export interface PlanSetResult {
  success: boolean;
  planId?: string;
  stepsCount?: number;
  updatedAt?: string;
  error?: string;
}

export interface AnswerPreflightResult {
  ok: boolean;
  issues: PreflightIssue[];
  score: number;
  checkedItems: string[];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeWhitespace(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function extractKeywords(source: string): string[] {
  return source
    .toLowerCase()
    .split(/[^a-z0-9aeiouy]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !KEYWORD_STOPWORDS.has(token))
    .slice(0, 8);
}

function textLooksAddressed(target: string, draftLower: string): boolean {
  const keywords = extractKeywords(target);
  if (keywords.length === 0) return false;

  const matched = keywords.filter((keyword) => draftLower.includes(keyword)).length;
  if (keywords.length <= 2) {
    return matched >= 1;
  }
  return matched >= Math.max(2, Math.ceil(keywords.length * 0.4));
}

function detectLanguage(text: string): 'de' | 'en' | 'unknown' {
  const normalized = ` ${text.toLowerCase()} `;
  const deScore =
    (/\b(und|oder|nicht|bitte|heute|wie|was|danke|ich|du|wir)\b/.test(normalized) ? 1 : 0) +
    (/[aeiou]ber|sch|ung\b|keit\b/.test(normalized) ? 1 : 0) +
    (/[aeiou]ss|oe|ae|ue/.test(normalized) ? 1 : 0);
  const enScore =
    (/\b(and|or|not|please|today|how|what|thanks|i|you|we)\b/.test(normalized) ? 1 : 0) +
    (/\b(the|this|that|with|from|about|into)\b/.test(normalized) ? 1 : 0);

  if (deScore === enScore) return 'unknown';
  return deScore > enScore ? 'de' : 'en';
}

function hasCompletionContradiction(draftLower: string): boolean {
  const positive = /\b(done|completed|implemented|fixed|sent|created|moved|erledigt|abgeschlossen|umgesetzt|behoben|gesendet|erstellt|verschoben)\b/.test(draftLower);
  const negative = /\b(not done|not completed|did not|didn't|unable|failed|could not|cannot|konnte nicht|nicht erledigt|nicht abgeschlossen|nicht umgesetzt|nicht gesendet|fehlgeschlagen)\b/.test(draftLower);
  return positive && negative;
}

function hasExternalActionClaim(draftLower: string): boolean {
  return /\b(email|e-mail|mail|ticket|task|scheduler|reminder|notification|benachrichtigung|deploy|pm2|restart|gesendet|erstellt|verschoben)\b/.test(draftLower);
}

function hasEvidenceHint(draftLower: string): boolean {
  return /\b(id|status|run id|action id|task id|approval id|pending approval|fehlgeschlagen|tool result|evidence|beleg)\b/.test(draftLower);
}

function buildInboxItem(obligation: SessionObligation): InboxOpenItem {
  const metadata = obligation.metadata && typeof obligation.metadata === 'object'
    ? obligation.metadata
    : undefined;
  const sourceMessageId = typeof metadata?.messageId === 'string' ? metadata.messageId : '';

  return {
    id: obligation.obligationId,
    text: obligation.requiredOutcome || obligation.description,
    sourceMessageId,
    status: obligation.status === 'failed' ? 'blocked' : 'open',
    createdAt: obligation.createdAt,
    owner: obligation.sourceAgent,
    contextType: obligation.origin || 'primary',
  };
}

export function listOpenInboxItems(
  sessionId: string,
  args: { scope?: InboxScope; limit?: number } = {},
): InboxListResult {
  const scope: InboxScope = args.scope === 'current_task' ? 'current_task' : 'all';
  const limit = clamp(args.limit ?? 10, 1, 50);
  const turnId = scope === 'current_task' ? stateManager.getActiveTurnId(sessionId) || undefined : undefined;
  const unresolved = stateManager.getUnresolvedObligations(sessionId, turnId ? { turnId } : undefined);

  const relevant = unresolved.filter((obligation) =>
    obligation.type === 'user_request' || obligation.origin === 'inbox',
  );
  const items = relevant.slice(0, limit).map(buildInboxItem);

  return {
    items,
    count: items.length,
    totalOpen: relevant.length,
    scope,
    ...(turnId ? { turnId } : {}),
  };
}

export function resolveInboxItem(
  sessionId: string,
  args: { id: string; resolution: InboxResolution; note?: string },
): InboxResolveResult {
  const id = String(args.id || '').trim();
  if (!id) {
    return { success: false, id: '', error: 'Missing required field: id' };
  }

  const resolution = args.resolution;
  if (!resolution) {
    return { success: false, id, error: 'Missing required field: resolution' };
  }

  const obligation = stateManager.getObligations(sessionId).find((item) => item.obligationId === id);
  if (!obligation) {
    return { success: false, id, error: `Unknown obligation id: ${id}` };
  }

  const evidenceNote = [
    `Resolved via chapo_inbox_resolve: ${resolution}`,
    args.note ? args.note.trim() : '',
  ].filter(Boolean).join(' | ');

  let updated: SessionObligation | undefined;
  if (resolution === 'done') {
    updated = stateManager.satisfyObligation(sessionId, id, evidenceNote);
  } else if (resolution === 'blocked') {
    updated = stateManager.failObligation(sessionId, id, evidenceNote);
  } else {
    updated = stateManager.waiveObligation(sessionId, id, evidenceNote);
  }

  if (!updated) {
    return { success: false, id, error: `Failed to update obligation ${id}` };
  }

  return {
    success: true,
    id,
    newStatus: updated.status,
    updatedAt: updated.resolvedAt || new Date().toISOString(),
  };
}

export function setChapoPlan(
  sessionId: string,
  args: { title: string; steps: ChapoPlanStep[] },
): PlanSetResult {
  const title = String(args.title || '').trim();
  const stepsInput = Array.isArray(args.steps) ? args.steps : [];

  if (!title) {
    return { success: false, error: 'title is required' };
  }
  if (stepsInput.length === 0) {
    return { success: false, error: 'steps must contain at least one step' };
  }

  const stepIdSet = new Set<string>();
  let doingCount = 0;

  const steps: ChapoPlanStep[] = [];
  for (const raw of stepsInput) {
    const id = String(raw?.id || '').trim();
    const text = String(raw?.text || '').trim();
    const owner = String(raw?.owner || '').trim() as AgentName;
    const status = String(raw?.status || '').trim() as PlanStepStatus;

    if (!id || !text) {
      return { success: false, error: 'Each step requires non-empty id and text' };
    }
    if (stepIdSet.has(id)) {
      return { success: false, error: `Duplicate step id: ${id}` };
    }
    if (!PLAN_STEP_OWNERS.has(owner)) {
      return { success: false, error: `Invalid step owner: ${owner}` };
    }
    if (!PLAN_STEP_STATUSES.has(status)) {
      return { success: false, error: `Invalid step status: ${status}` };
    }

    if (status === 'doing') doingCount += 1;
    stepIdSet.add(id);
    steps.push({ id, text, owner, status });
  }

  if (doingCount > 1) {
    return { success: false, error: 'Only one step may be in status "doing"' };
  }

  const now = new Date().toISOString();
  const existing = stateManager.getState(sessionId)?.taskContext?.gatheredInfo?.chapoPlan;
  const previousVersion = (
    existing
    && typeof existing === 'object'
    && typeof (existing as { version?: unknown }).version === 'number'
  )
    ? ((existing as { version: number }).version)
    : 0;
  const nextVersion = previousVersion + 1;
  const planId = `chapo-plan-${Date.now()}`;

  stateManager.setGatheredInfo(sessionId, 'chapoPlan', {
    planId,
    version: nextVersion,
    title,
    steps,
    updatedAt: now,
  });

  return {
    success: true,
    planId,
    stepsCount: steps.length,
    updatedAt: now,
  };
}

export function preflightAnswer(
  sessionId: string,
  args: { draft: string; mustAddress?: string[]; strict?: boolean },
): AnswerPreflightResult {
  const draft = String(args.draft || '').trim();
  const strict = args.strict === true;
  const issues: PreflightIssue[] = [];

  if (!draft) {
    issues.push({ type: 'missing_answer', detail: 'Draft is empty.' });
    return {
      ok: false,
      issues,
      score: 0,
      checkedItems: [],
    };
  }

  const draftLower = draft.toLowerCase();
  const checks = new Set<string>();
  const mustAddress = Array.isArray(args.mustAddress)
    ? args.mustAddress.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  for (const item of mustAddress.slice(0, 10)) {
    checks.add(item);
  }

  if (checks.size === 0) {
    const turnId = stateManager.getActiveTurnId(sessionId) || undefined;
    const unresolved = stateManager.getUnresolvedObligations(
      sessionId,
      turnId ? { turnId, blockingOnly: true } : { blockingOnly: true },
    );
    for (const obligation of unresolved.slice(0, 10)) {
      const text = (obligation.requiredOutcome || obligation.description || '').trim();
      if (text) checks.add(text);
    }
  }

  const checkedItems = Array.from(checks);
  for (const target of checkedItems) {
    if (!textLooksAddressed(target, draftLower)) {
      issues.push({
        type: 'missing_answer',
        detail: `Draft does not clearly address: ${target}`,
      });
    }
  }

  if (hasCompletionContradiction(draftLower)) {
    issues.push({
      type: 'contradiction',
      detail: 'Draft contains both success and failure completion signals.',
    });
  }

  if (hasExternalActionClaim(draftLower) && !hasEvidenceHint(draftLower)) {
    issues.push({
      type: 'unverified_claim',
      detail: 'Draft claims external actions but does not mention concrete evidence (id/status/result).',
    });
  }

  const originalRequest = String(stateManager.getState(sessionId)?.taskContext?.originalRequest || '');
  const requestLanguage = detectLanguage(originalRequest);
  const draftLanguage = detectLanguage(draft);
  if (requestLanguage !== 'unknown' && draftLanguage !== 'unknown' && requestLanguage !== draftLanguage) {
    issues.push({
      type: 'language_mismatch',
      detail: `Draft language (${draftLanguage}) does not match request language (${requestLanguage}).`,
    });
  }

  const missingCount = issues.filter((issue) => issue.type === 'missing_answer').length;
  const contradictionCount = issues.filter((issue) => issue.type === 'contradiction').length;
  const unverifiedCount = issues.filter((issue) => issue.type === 'unverified_claim').length;
  const languageCount = issues.filter((issue) => issue.type === 'language_mismatch').length;

  const score = Math.max(
    0,
    Math.min(
      1,
      1 - (missingCount * 0.18) - (contradictionCount * 0.35) - (unverifiedCount * 0.2) - (languageCount * 0.1),
    ),
  );
  const ok = strict ? issues.length === 0 : (score >= 0.75 && contradictionCount === 0);

  return {
    ok,
    issues,
    score,
    checkedItems,
  };
}
