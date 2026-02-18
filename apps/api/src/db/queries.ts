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

  const roleOrder: Record<ChatMessage['role'], number> = {
    user: 0,
    assistant: 1,
    system: 2,
  };

  return (data || []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatMessage['role'],
    content: row.content,
    timestamp: row.timestamp,
  })).sort((a, b) => {
    const ta = Date.parse(a.timestamp);
    const tb = Date.parse(b.timestamp);
    if (ta !== tb) return ta - tb;
    const ra = roleOrder[a.role] ?? 99;
    const rb = roleOrder[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
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
    throw new Error(`Failed to save setting: ${error.message}`);
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

// Action persistence types
export interface DbAction {
  id: string;
  session_id: string | null;
  tool_name: string;
  tool_args: Record<string, unknown>;
  description: string;
  status: string;
  preview: Record<string, unknown> | null;
  result: unknown;
  error: string | null;
  created_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  executed_at: string | null;
}

export async function saveAction(action: {
  id: string;
  sessionId?: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  status: string;
  preview?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  executedAt?: string;
}): Promise<void> {
  const { error } = await getSupabase()
    .from('actions')
    .upsert({
      id: action.id,
      session_id: action.sessionId || null,
      tool_name: action.toolName,
      tool_args: action.toolArgs,
      description: action.description,
      status: action.status,
      preview: action.preview || null,
      result: action.result || null,
      error: action.error || null,
      created_at: action.createdAt,
      approved_at: action.approvedAt || null,
      rejected_at: action.rejectedAt || null,
      executed_at: action.executedAt || null,
    }, { onConflict: 'id' });

  if (error) {
    console.error('[Action Save Error]', error);
    throw new Error(`Failed to save action: ${error.message}`);
  }
}

export async function getActionById(id: string): Promise<DbAction | null> {
  const { data, error } = await getSupabase()
    .from('actions')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    console.error('[Action Get Error]', error);
    return null;
  }

  return data as DbAction;
}

export async function getAllActionsFromDb(): Promise<DbAction[]> {
  const { data, error } = await getSupabase()
    .from('actions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[Actions List Error]', error);
    return [];
  }

  return (data || []) as DbAction[];
}

export async function getPendingActionsFromDb(): Promise<DbAction[]> {
  const { data, error } = await getSupabase()
    .from('actions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Pending Actions Error]', error);
    return [];
  }

  return (data || []) as DbAction[];
}

export async function updateActionInDb(
  id: string,
  updates: Partial<{
    status: string;
    result: unknown;
    error: string;
    approvedAt: string;
    rejectedAt: string;
    executedAt: string;
  }>
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.result !== undefined) dbUpdates.result = updates.result;
  if (updates.error !== undefined) dbUpdates.error = updates.error;
  if (updates.approvedAt !== undefined) dbUpdates.approved_at = updates.approvedAt;
  if (updates.rejectedAt !== undefined) dbUpdates.rejected_at = updates.rejectedAt;
  if (updates.executedAt !== undefined) dbUpdates.executed_at = updates.executedAt;

  const { error } = await getSupabase()
    .from('actions')
    .update(dbUpdates)
    .eq('id', id);

  if (error) {
    console.error('[Action Update Error]', error);
    throw new Error(`Failed to update action: ${error.message}`);
  }
}

export async function deleteOldActions(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

  const { data, error } = await getSupabase()
    .from('actions')
    .delete()
    .lt('created_at', cutoff)
    .neq('status', 'pending')
    .select('id');

  if (error) {
    console.error('[Action Cleanup Error]', error);
    return 0;
  }

  return data?.length || 0;
}

/**
 * Get the current trust mode setting
 */
export async function getTrustMode(): Promise<'default' | 'trusted'> {
  const value = await getSetting('trustMode');
  if (value === 'trusted') {
    return 'trusted';
  }
  return 'default';
}

/**
 * Set the trust mode
 */
export async function setTrustMode(mode: 'default' | 'trusted'): Promise<void> {
  await setSetting('trustMode', mode);
}

// ============================================
// Agent State Persistence (multi-agent router)
// ============================================

export interface DbAgentStateRow {
  session_id: string;
  state: unknown;
  updated_at: string;
}

export async function getAgentState(sessionId: string): Promise<DbAgentStateRow | null> {
  const { data, error } = await getSupabase()
    .from('agent_states')
    .select('session_id, state, updated_at')
    .eq('session_id', sessionId)
    .single();

  if (error) {
    // PGRST116 = row not found
    if (error.code === 'PGRST116') return null;
    console.error('Failed to get agent state:', error);
    return null;
  }

  return data as DbAgentStateRow;
}

export async function upsertAgentState(sessionId: string, state: unknown): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from('agent_states')
    .upsert({
      session_id: sessionId,
      state,
      updated_at: now,
    }, { onConflict: 'session_id' });

  if (error) {
    console.error('Failed to upsert agent state:', error);
    // Surface persistence failures to callers so they can retry/backoff instead of silently dropping writes.
    throw new Error(`Failed to upsert agent state: ${error.message}`);
  }
}

export async function deleteAgentState(sessionId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('agent_states')
    .delete()
    .eq('session_id', sessionId);
  if (error) {
    console.error('Failed to delete agent state:', error);
  }
}

// ============================================
// Looper Persistence
// ============================================

export interface DbLooperStateRow {
  session_id: string;
  provider: string;
  config: unknown;
  snapshot: unknown;
  status: string;
  updated_at: string;
}

export async function getLooperState(sessionId: string): Promise<DbLooperStateRow | null> {
  const { data, error } = await getSupabase()
    .from('looper_states')
    .select('session_id, provider, config, snapshot, status, updated_at')
    .eq('session_id', sessionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Failed to get looper state:', error);
    return null;
  }

  return data as DbLooperStateRow;
}

export async function upsertLooperState(input: {
  sessionId: string;
  provider: string;
  config: unknown;
  snapshot: unknown;
  status: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from('looper_states')
    .upsert({
      session_id: input.sessionId,
      provider: input.provider,
      config: input.config,
      snapshot: input.snapshot,
      status: input.status,
      updated_at: now,
    }, { onConflict: 'session_id' });

  if (error) {
    console.error('Failed to upsert looper state:', error);
    // Callers should handle this as a non-fatal error (loop can continue),
    // but we still want a signal so we can retry and avoid silent data loss.
    throw new Error(`Failed to upsert looper state: ${error.message}`);
  }
}

export async function deleteLooperState(sessionId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('looper_states')
    .delete()
    .eq('session_id', sessionId);
  if (error) {
    console.error('Failed to delete looper state:', error);
  }
}
