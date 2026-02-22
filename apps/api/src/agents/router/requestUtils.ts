import { getMessages } from '../../db/queries.js';
import * as stateManager from '../stateManager.js';
import { buildConversationHistoryContext } from '../conversationHistory.js';
import type { QualificationResult, TaskType } from '../types.js';
import { isConversationalSmallTalk } from '../intakeClassifier.js';

export function parseYesNo(input: string): boolean | null {
  const raw = input.trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
  if (!raw) return null;

  const yes = new Set([
    'y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'continue', 'proceed', 'go ahead',
    'ja', 'j', 'klar', 'weiter', 'mach weiter', 'bitte weiter',
    // Common typos / near-misses
    'yess', 'yees', 'yas',
    'contine', 'contiune', 'contnue', 'conitnue', 'continoue', 'continu', 'cntinue',
  ]);
  const no = new Set([
    'n', 'no', 'nope', 'stop', 'cancel', 'abort',
    'nein', 'nee', 'stopp', 'abbrechen',
    // Common typos / near-misses
    'cancell', 'abor', 'abrt',
  ]);

  if (yes.has(raw)) return true;
  if (no.has(raw)) return false;
  return null;
}

export function looksLikeContinuePrompt(text: string): boolean {
  const t = (text || '').toLowerCase();
  return t.includes('required more steps than allowed') || t.includes('should i continue?');
}

export function isSmallTalk(text: string): boolean {
  return isConversationalSmallTalk(text);
}

export function extractExplicitRememberNote(text: string): { note: string; promoteToLongTerm: boolean } | null {
  const patterns = [
    /^\s*(?:remember(?:\s+this)?|please\s+remember|note\s+this)\s*[:,-]?\s+(.+)$/i,
    /^\s*(?:merk\s+dir(?:\s+bitte)?|merke\s+dir)\s*[:,-]?\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const note = match[1].trim();
    if (note.length < 3) return null;
    if (note.endsWith('?')) return null;

    const promoteToLongTerm = /\b(always|dauerhaft|langfristig|important|wichtig)\b/i.test(text);
    return { note, promoteToLongTerm };
  }

  return null;
}

export async function loadRecentConversationHistory(sessionId: string): Promise<Array<{ role: string; content: string }>> {
  const messages = await getMessages(sessionId);
  return buildConversationHistoryContext(messages);
}

export function formatConversationHistoryForScout(
  history: Array<{ role: string; content: string }>,
  options?: { maxTurns?: number; maxChars?: number },
): string {
  const maxTurns = options?.maxTurns ?? 6;
  const maxChars = options?.maxChars ?? 2000;

  const summaryEntry = [...history]
    .reverse()
    .find((entry) => entry.role === 'system' && entry.content.trim().length > 0);

  const recentTurns = history
    .filter((entry) => (entry.role === 'user' || entry.role === 'assistant') && entry.content.trim().length > 0)
    .slice(-maxTurns)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.content.trim()}`);

  const parts = [
    summaryEntry ? `SUMMARY: ${summaryEntry.content.trim()}` : '',
    ...recentTurns,
  ].filter((entry) => entry.length > 0);

  if (parts.length === 0) return '';

  const combined = `RECENT CONVERSATION HISTORY:\n${parts.join('\n\n')}`;
  if (combined.length <= maxChars) return combined;
  return `${combined.slice(0, maxChars - 14)}\n...[truncated]`;
}

export function getProjectRootFromState(sessionId: string): string | null {
  const state = stateManager.getState(sessionId);
  const value = state?.taskContext.gatheredInfo.projectRoot;
  return value && value.trim().length > 0 ? value : null;
}

export function buildToolResultContent(result: { success: boolean; result?: unknown; error?: string }): { content: string; isError: boolean } {
  if (result.success) {
    const value = result.result === undefined ? '' : JSON.stringify(result.result);
    return { content: value || 'OK', isError: false };
  }
  const content = result.error ? `Error: ${result.error}` : 'Error: Tool failed without a message.';
  return { content, isError: true };
}

export function buildPlanQualificationForComplexTask(userMessage: string): QualificationResult {
  const lower = userMessage.toLowerCase();
  const looksDevOps = /(deploy|pm2|server|ssh|infra|docker|nginx|k8s|kubernetes)/.test(lower);
  const taskType: TaskType = looksDevOps ? 'devops' : 'mixed';

  return {
    taskType,
    riskLevel: 'high',
    complexity: 'complex',
    targetAgent: looksDevOps ? 'devo' : null,
    requiresApproval: false,
    requiresClarification: false,
    gatheredContext: { relevantFiles: [], fileContents: {} },
    reasoning: 'Complex task routed directly to Plan Mode pre-qualification.',
  };
}
