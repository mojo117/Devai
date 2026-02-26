/**
 * History Tools — search and browse past conversation history.
 *
 * Uses ILIKE text search on the Supabase `messages` table with a
 * PostgREST foreign-key join to `sessions` for titles.
 */

import { getSupabase } from '../db/index.js';

// ── Interfaces ──

export interface HistorySearchParams {
  query: string;
  limit?: number;
  role?: 'user' | 'assistant' | 'system';
  sessionId?: string;
}

interface HistorySearchHit {
  sessionId: string;
  sessionTitle: string | null;
  messageId: string;
  role: string;
  timestamp: string;
  snippet: string;
}

export interface HistorySearchResult {
  query: string;
  count: number;
  hits: HistorySearchHit[];
  truncated: boolean;
}

export interface SessionListResult {
  count: number;
  sessions: Array<{
    id: string;
    title: string | null;
    createdAt: string;
  }>;
}

// ── Constants ──

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SNIPPET_RADIUS = 150;

// ── Helpers ──

function extractSnippet(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerContent.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return content.length > SNIPPET_RADIUS * 2
      ? content.slice(0, SNIPPET_RADIUS * 2) + '...'
      : content;
  }

  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(content.length, matchIndex + query.length + SNIPPET_RADIUS);

  let snippet = content.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

// ── history_search ──

export async function historySearch(params: HistorySearchParams): Promise<HistorySearchResult> {
  const { query, limit: rawLimit, role, sessionId } = params;

  if (!query || query.trim().length === 0) {
    throw new Error('Search query must not be empty');
  }

  const limit = Math.min(Math.max(1, rawLimit ?? DEFAULT_LIMIT), MAX_LIMIT);

  let supaQuery = getSupabase()
    .from('messages')
    .select('id, session_id, role, content, timestamp, sessions!inner(title)')
    .ilike('content', `%${query}%`)
    .order('timestamp', { ascending: false })
    .limit(limit + 1);

  if (role) {
    supaQuery = supaQuery.eq('role', role);
  }

  if (sessionId) {
    supaQuery = supaQuery.eq('session_id', sessionId);
  }

  const { data, error } = await supaQuery;

  if (error) {
    console.error('[history_search] Query failed:', error);
    throw new Error(`History search failed: ${error.message}`);
  }

  const rows = data || [];
  const truncated = rows.length > limit;
  const resultRows = truncated ? rows.slice(0, limit) : rows;

  const hits: HistorySearchHit[] = resultRows.map((row: Record<string, unknown>) => {
    const sessions = row.sessions as { title: string | null } | null;
    return {
      sessionId: row.session_id as string,
      sessionTitle: sessions?.title ?? null,
      messageId: row.id as string,
      role: row.role as string,
      timestamp: row.timestamp as string,
      snippet: extractSnippet(row.content as string, query),
    };
  });

  return { query, count: hits.length, hits, truncated };
}

// ── history_listSessions ──

export async function historyListSessions(params?: {
  limit?: number;
}): Promise<SessionListResult> {
  const limit = Math.min(Math.max(1, params?.limit ?? 30), 100);

  const { data, error } = await getSupabase()
    .from('sessions')
    .select('id, title, created_at')
    .eq('user_id', 'local')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[history_listSessions] Query failed:', error);
    throw new Error(`Failed to list sessions: ${error.message}`);
  }

  return {
    count: (data || []).length,
    sessions: (data || []).map((s: Record<string, unknown>) => ({
      id: s.id as string,
      title: s.title as string | null,
      createdAt: s.created_at as string,
    })),
  };
}
