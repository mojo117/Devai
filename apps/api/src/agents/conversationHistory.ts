/**
 * Conversation history shaping utilities.
 *
 * We keep a recent verbatim window and prepend a compact system summary for
 * older turns so the model can retain long-session context without loading
 * every message token-by-token.
 */

export interface HistoryMessage {
  role: string;
  content: string;
  timestamp?: string;
}

export interface ConversationContextOptions {
  recentLimit?: number;
  summaryMaxItems?: number;
  summaryItemMaxChars?: number;
}

const DEFAULT_RECENT_LIMIT = 30;
const DEFAULT_SUMMARY_MAX_ITEMS = 12;
const DEFAULT_SUMMARY_ITEM_MAX_CHARS = 180;

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}

function sampleEvenly<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items;
  const result: T[] = [];
  const step = (items.length - 1) / (maxItems - 1);
  for (let i = 0; i < maxItems; i++) {
    const idx = Math.round(i * step);
    result.push(items[idx]);
  }
  return result;
}

function buildOlderHistorySummary(
  older: HistoryMessage[],
  summaryMaxItems: number,
  summaryItemMaxChars: number
): string | null {
  const relevant = older.filter((m) => (m.role === 'user' || m.role === 'assistant') && normalizeContent(m.content).length > 0);
  if (relevant.length === 0) return null;

  const sampled = sampleEvenly(relevant, Math.max(2, summaryMaxItems));
  const firstTs = relevant[0]?.timestamp;
  const lastTs = relevant[relevant.length - 1]?.timestamp;
  const range = firstTs && lastTs ? ` Zeitraum: ${firstTs} bis ${lastTs}.` : '';

  const lines: string[] = [
    `Kontext-Zusammenfassung frueherer Unterhaltung (${relevant.length} Nachrichten).${range}`,
    'Nutze diese Punkte als Hintergrund und priorisiere die neueren Nachrichten darunter.',
  ];

  for (const msg of sampled) {
    const normalized = normalizeContent(msg.content);
    if (!normalized) continue;
    const prefix = msg.role === 'user' ? 'USER' : 'ASSISTANT';
    lines.push(`- ${prefix}: ${truncate(normalized, summaryItemMaxChars)}`);
  }

  return lines.join('\n');
}

/**
 * Build LLM-ready conversation history:
 * - Keep recent messages verbatim.
 * - Add one system summary of older turns when history exceeds recent window.
 */
export function buildConversationHistoryContext(
  messages: HistoryMessage[],
  options?: ConversationContextOptions
): Array<{ role: string; content: string }> {
  const recentLimit = Math.max(1, options?.recentLimit ?? DEFAULT_RECENT_LIMIT);
  const summaryMaxItems = Math.max(2, options?.summaryMaxItems ?? DEFAULT_SUMMARY_MAX_ITEMS);
  const summaryItemMaxChars = Math.max(60, options?.summaryItemMaxChars ?? DEFAULT_SUMMARY_ITEM_MAX_CHARS);

  const cleaned = messages
    .map((m) => ({
      role: m.role,
      content: normalizeContent(m.content || ''),
      timestamp: m.timestamp,
    }))
    .filter((m) => (m.role === 'user' || m.role === 'assistant' || m.role === 'system') && m.content.length > 0);

  if (cleaned.length <= recentLimit) {
    return cleaned.map((m) => ({ role: m.role, content: m.content }));
  }

  const older = cleaned.slice(0, -recentLimit);
  const recent = cleaned.slice(-recentLimit).map((m) => ({ role: m.role, content: m.content }));
  const summary = buildOlderHistorySummary(older, summaryMaxItems, summaryItemMaxChars);

  if (!summary) return recent;
  return [{ role: 'system', content: summary }, ...recent];
}

