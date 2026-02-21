import { getMessages } from '../../db/queries.js';
import * as stateManager from '../stateManager.js';
import { buildConversationHistoryContext } from '../conversationHistory.js';
import type { QualificationResult, TaskType } from '../types.js';

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

function normalizeQuickText(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/g, '');
}

export function isSmallTalk(text: string): boolean {
  const t = normalizeQuickText(text);
  if (!t) return false;
  const greetings = new Set([
    'hi', 'hello', 'hey', 'yo', 'sup',
    'hallo', 'moin', 'servus',
    'ey', 'was geht', "what's up", 'whats up', 'wie gehts', "wie geht's",
  ]);
  return greetings.has(t);
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

export function getProjectRootFromState(sessionId: string): string | null {
  const state = stateManager.getState(sessionId);
  const value = state?.taskContext.gatheredInfo['projectRoot'];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
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
