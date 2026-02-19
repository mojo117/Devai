import { nanoid } from 'nanoid';
import { getSupabase } from './index.js';

// ============================================
// Scheduled Jobs
// ============================================

export interface ScheduledJobRow {
  id: string;
  name: string;
  cron_expression: string;
  instruction: string;
  notification_channel: string | null;
  enabled: boolean;
  one_shot: boolean;
  status: 'active' | 'disabled_by_error' | 'paused';
  consecutive_failures: number;
  last_run_at: string | null;
  last_result: string | null;
  last_error_at: string | null;
  created_at: string;
}

export async function listScheduledJobs(): Promise<ScheduledJobRow[]> {
  const { data, error } = await getSupabase()
    .from('scheduled_jobs')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Scheduler] Failed to list jobs:', error);
    return [];
  }

  return (data || []) as ScheduledJobRow[];
}

export async function getEnabledJobs(): Promise<ScheduledJobRow[]> {
  const { data, error } = await getSupabase()
    .from('scheduled_jobs')
    .select('*')
    .eq('enabled', true)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Scheduler] Failed to get enabled jobs:', error);
    return [];
  }

  return (data || []) as ScheduledJobRow[];
}

export async function getScheduledJob(id: string): Promise<ScheduledJobRow | null> {
  const { data, error } = await getSupabase()
    .from('scheduled_jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[Scheduler] Failed to get job:', error);
    return null;
  }

  return data as ScheduledJobRow;
}

export async function createScheduledJob(job: {
  name: string;
  cronExpression: string;
  instruction: string;
  notificationChannel?: string;
  oneShot?: boolean;
}): Promise<ScheduledJobRow> {
  const id = nanoid();
  const now = new Date().toISOString();

  const row = {
    id,
    name: job.name,
    cron_expression: job.cronExpression,
    instruction: job.instruction,
    notification_channel: job.notificationChannel || null,
    enabled: true,
    one_shot: job.oneShot || false,
    status: 'active' as const,
    consecutive_failures: 0,
    last_run_at: null,
    last_result: null,
    last_error_at: null,
    created_at: now,
  };

  const { error } = await getSupabase()
    .from('scheduled_jobs')
    .insert(row);

  if (error) {
    console.error('[Scheduler] Failed to create job:', error);
    throw new Error(`Failed to create scheduled job: ${error.message}`);
  }

  return row;
}

export async function updateScheduledJob(
  id: string,
  updates: Partial<{
    name: string;
    cron_expression: string;
    instruction: string;
    notification_channel: string | null;
    enabled: boolean;
    one_shot: boolean;
    status: 'active' | 'disabled_by_error' | 'paused';
    consecutive_failures: number;
    last_run_at: string;
    last_result: string;
    last_error_at: string;
  }>
): Promise<void> {
  const { error } = await getSupabase()
    .from('scheduled_jobs')
    .update(updates)
    .eq('id', id);

  if (error) {
    console.error('[Scheduler] Failed to update job:', error);
    throw new Error(`Failed to update scheduled job: ${error.message}`);
  }
}

export async function deleteScheduledJob(id: string): Promise<boolean> {
  const { error } = await getSupabase()
    .from('scheduled_jobs')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[Scheduler] Failed to delete job:', error);
    return false;
  }

  return true;
}

// ============================================
// External Sessions (Telegram, etc.)
// ============================================

export interface ExternalSessionRow {
  id: string;
  platform: string;
  external_user_id: string;
  external_chat_id: string;
  session_id: string;
  is_default_channel: boolean;
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
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[ExternalSession] Failed to get session:', error);
    return null;
  }

  return data as ExternalSessionRow;
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

export async function setDefaultNotificationChannel(id: string): Promise<void> {
  // Clear existing defaults
  const { error: clearError } = await getSupabase()
    .from('external_sessions')
    .update({ is_default_channel: false })
    .eq('is_default_channel', true);

  if (clearError) {
    console.error('[ExternalSession] Failed to clear default channel:', clearError);
  }

  // Set new default
  const { error } = await getSupabase()
    .from('external_sessions')
    .update({ is_default_channel: true })
    .eq('id', id);

  if (error) {
    console.error('[ExternalSession] Failed to set default channel:', error);
    throw new Error(`Failed to set default channel: ${error.message}`);
  }
}
