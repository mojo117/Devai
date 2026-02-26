import { nanoid } from 'nanoid';
import { getSupabase } from './index.js';

const DEFAULT_USER_ID = 'local';

export interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
}

export function getDefaultUserId(): string {
  return DEFAULT_USER_ID;
}

export async function listSessions(userId: string = DEFAULT_USER_ID): Promise<SessionSummary[]> {
  const { data, error } = await getSupabase()
    .from('sessions')
    .select('id, title, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to list sessions:', error);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
  }));
}

export async function createSession(title?: string, userId: string = DEFAULT_USER_ID): Promise<SessionSummary> {
  const id = nanoid();
  const now = new Date().toISOString();

  const { error } = await getSupabase()
    .from('sessions')
    .insert({
      id,
      user_id: userId,
      title: title || null,
      created_at: now,
    });

  if (error) {
    console.error('Failed to create session:', error);
  }

  return { id, title: title || null, createdAt: now };
}

export async function ensureSessionExists(
  sessionId: string,
  title?: string,
  userId: string = DEFAULT_USER_ID,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from('sessions')
    .upsert({
      id: sessionId,
      user_id: userId,
      title: title || null,
      created_at: now,
    }, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });

  if (error) {
    console.error('Failed to ensure session exists:', error);
  }
}

export async function getSessionTitle(sessionId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('sessions')
    .select('title')
    .eq('id', sessionId)
    .single();

  if (error) {
    return null;
  }

  return data?.title ?? null;
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const { error } = await getSupabase()
    .from('sessions')
    .update({ title })
    .eq('id', sessionId);

  if (error) {
    console.error('Failed to update session title:', error);
  }
}

export async function updateSessionTitleIfEmpty(sessionId: string, title: string): Promise<void> {
  const existing = await getSessionTitle(sessionId);
  if (existing) return;
  await updateSessionTitle(sessionId, title);
}

export async function getRecentFailedSessions(
  sinceMinutes: number,
): Promise<Array<{ session_id: string; title: string; updated_at: string }>> {
  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString()

  const { data, error } = await getSupabase()
    .from('sessions')
    .select('id, title, updated_at')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[db] Failed to query recent sessions:', error)
    return []
  }

  return (data || []).map((row) => ({
    session_id: row.id as string,
    title: (row.title || 'Untitled') as string,
    updated_at: row.updated_at as string,
  }))
}
