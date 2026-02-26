import { nanoid } from 'nanoid';
import { getSupabase } from './index.js';
import { createSession } from './queries.js';

export interface ExternalSessionRow {
  id: string;
  platform: string;
  external_user_id: string;
  external_chat_id: string;
  session_id: string;
  is_default_channel: boolean;
  pinned_userfile_ids: string[];
  created_at: string;
}

export async function getExternalSession(
  platform: string,
  externalUserId: string
): Promise<ExternalSessionRow | null> {
  const { data, error } = await getSupabase()
    .from('external_sessions')
    .select('*')
    .eq('platform', platform)
    .eq('external_user_id', externalUserId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[ExternalSession] Failed to get session:', error);
    return null;
  }

  const rows = (data || []) as ExternalSessionRow[];
  return rows[0] || null;
}

export async function createExternalSession(session: {
  platform: string;
  externalUserId: string;
  externalChatId: string;
  sessionId: string;
  isDefaultChannel?: boolean;
}): Promise<ExternalSessionRow> {
  const id = nanoid();
  const now = new Date().toISOString();

  const row = {
    id,
    platform: session.platform,
    external_user_id: session.externalUserId,
    external_chat_id: session.externalChatId,
    session_id: session.sessionId,
    is_default_channel: session.isDefaultChannel || false,
    pinned_userfile_ids: [],
    created_at: now,
  };

  const { error } = await getSupabase()
    .from('external_sessions')
    .insert(row);

  if (error) {
    console.error('[ExternalSession] Failed to create session:', error);
    throw new Error(`Failed to create external session: ${error.message}`);
  }

  return row;
}

export async function getDefaultNotificationChannel(): Promise<ExternalSessionRow | null> {
  const { data, error } = await getSupabase()
    .from('external_sessions')
    .select('*')
    .eq('is_default_channel', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[ExternalSession] Failed to get default channel:', error);
    return null;
  }

  return data as ExternalSessionRow;
}

export async function getExternalSessionBySessionId(
  sessionId: string
): Promise<ExternalSessionRow | null> {
  const { data, error } = await getSupabase()
    .from('external_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('[ExternalSession] Failed to get session by session_id:', error);
    return null;
  }

  const rows = (data || []) as ExternalSessionRow[];
  return rows[0] || null;
}

export async function getOrCreateExternalSession(
  platform: string,
  externalUserId: string,
  externalChatId: string
): Promise<ExternalSessionRow> {
  const existing = await getExternalSession(platform, externalUserId);
  if (existing) {
    if (existing.external_chat_id !== externalChatId) {
      const { error } = await getSupabase()
        .from('external_sessions')
        .update({ external_chat_id: externalChatId })
        .eq('id', existing.id);
      if (error) {
        console.error('[ExternalSession] Failed to update external_chat_id:', error);
      } else {
        existing.external_chat_id = externalChatId;
      }
    }
    return existing;
  }

  const session = await createSession(`${platform}:${externalUserId}`);
  return createExternalSession({
    platform,
    externalUserId,
    externalChatId,
    sessionId: session.id,
  });
}

export async function updateExternalSessionSessionId(
  id: string,
  sessionId: string
): Promise<void> {
  const { error } = await getSupabase()
    .from('external_sessions')
    .update({ session_id: sessionId })
    .eq('id', id);

  if (error) {
    console.error('[ExternalSession] Failed to update session_id:', error);
    throw new Error(`Failed to update external session binding: ${error.message}`);
  }
}

export async function addPinnedUserfile(externalSessionId: string, fileId: string): Promise<void> {
  const { data, error: fetchError } = await getSupabase()
    .from('external_sessions')
    .select('pinned_userfile_ids')
    .eq('id', externalSessionId)
    .single();

  if (fetchError) {
    console.error('[ExternalSession] Failed to fetch pinned files:', fetchError);
    return;
  }

  const current = (data as { pinned_userfile_ids: string[] })?.pinned_userfile_ids || [];
  if (current.includes(fileId)) return;

  const { error } = await getSupabase()
    .from('external_sessions')
    .update({ pinned_userfile_ids: [...current, fileId] })
    .eq('id', externalSessionId);

  if (error) {
    console.error('[ExternalSession] Failed to add pinned userfile:', error);
  }
}

export async function getPinnedUserfileIds(externalSessionId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from('external_sessions')
    .select('pinned_userfile_ids')
    .eq('id', externalSessionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return [];
    console.error('[ExternalSession] Failed to get pinned files:', error);
    return [];
  }

  return (data as { pinned_userfile_ids: string[] })?.pinned_userfile_ids || [];
}

export async function clearPinnedUserfiles(externalSessionId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('external_sessions')
    .update({ pinned_userfile_ids: [] })
    .eq('id', externalSessionId);

  if (error) {
    console.error('[ExternalSession] Failed to clear pinned files:', error);
  }
}

export async function setDefaultNotificationChannel(id: string): Promise<void> {
  const { error: clearError } = await getSupabase()
    .from('external_sessions')
    .update({ is_default_channel: false })
    .eq('is_default_channel', true);

  if (clearError) {
    console.error('[ExternalSession] Failed to clear default channel:', clearError);
  }

  const { error } = await getSupabase()
    .from('external_sessions')
    .update({ is_default_channel: true })
    .eq('id', id);

  if (error) {
    console.error('[ExternalSession] Failed to set default channel:', error);
    throw new Error(`Failed to set default channel: ${error.message}`);
  }
}
