import { nanoid } from 'nanoid';
import { getSupabase } from './index.js';
import type { ChatMessage } from '@devai/shared';

const DEFAULT_USER_ID = 'local';

export interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
}

export interface StoredMessage extends ChatMessage {
  sessionId: string;
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

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('id, session_id, role, content, timestamp')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: true });

  if (error) {
    console.error('Failed to get messages:', error);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatMessage['role'],
    content: row.content,
    timestamp: row.timestamp,
  }));
}

export async function saveMessage(sessionId: string, message: ChatMessage): Promise<void> {
  const { error } = await getSupabase()
    .from('messages')
    .insert({
      id: message.id,
      session_id: sessionId,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    });

  if (error) {
    console.error('Failed to save message:', error);
  }
}

export async function getSetting(key: string, userId: string = DEFAULT_USER_ID): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .single();

  if (error) {
    return null;
  }

  return data?.value ?? null;
}

export async function setSetting(key: string, value: string, userId: string = DEFAULT_USER_ID): Promise<void> {
  const now = new Date().toISOString();

  const { error } = await getSupabase()
    .from('settings')
    .upsert({
      user_id: userId,
      key,
      value,
      updated_at: now,
    }, {
      onConflict: 'user_id,key',
    });

  if (error) {
    console.error('Failed to save setting:', error);
  }
}

export async function saveAuditLog(
  action: string,
  data: Record<string, unknown>,
  userId: string = DEFAULT_USER_ID
): Promise<void> {
  const id = nanoid();
  const timestamp = new Date().toISOString();

  const { error } = await getSupabase()
    .from('audit_logs')
    .insert({
      id,
      timestamp,
      user_id: userId,
      action,
      data,
    });

  if (error) {
    console.error('[Audit Log Error]', error);
  }
}
