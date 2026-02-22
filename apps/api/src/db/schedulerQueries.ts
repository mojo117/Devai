import { nanoid } from 'nanoid';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getSupabase } from './index.js';
import { createSession } from './queries.js';

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

export type SchedulerExecutionType = 'scheduled' | 'internal' | 'watchdog';
export type SchedulerExecutionPhase = 'start' | 'success' | 'failure' | 'disabled' | 'recovered' | 'info';

export interface SchedulerExecutionLogRow {
  id: string;
  job_id: string | null;
  job_name: string;
  execution_type: SchedulerExecutionType;
  phase: SchedulerExecutionPhase;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const SCHEDULER_FALLBACK_LOG_PATH = resolve(process.cwd(), '../../var/scheduler-events-fallback.jsonl');

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

export async function logSchedulerExecution(entry: {
  jobId?: string | null;
  jobName: string;
  executionType?: SchedulerExecutionType;
  phase: SchedulerExecutionPhase;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<boolean> {
  const row = {
    id: nanoid(),
    job_id: entry.jobId ?? null,
    job_name: entry.jobName,
    execution_type: entry.executionType || 'scheduled',
    phase: entry.phase,
    message: entry.message ?? null,
    metadata: entry.metadata ?? null,
    created_at: new Date().toISOString(),
  };

  const { error } = await getSupabase()
    .from('scheduler_execution_logs')
    .insert(row);

  if (error) {
    console.error('[Scheduler] Failed to persist execution log:', error);
    await appendSchedulerFallbackLog(row, error.message);
    return false;
  }

  return true;
}

export async function getRecentSchedulerExecutionLogs(limit: number = 50): Promise<SchedulerExecutionLogRow[]> {
  const { data, error } = await getSupabase()
    .from('scheduler_execution_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Scheduler] Failed to fetch scheduler execution logs:', error);
    return [];
  }

  return (data || []) as SchedulerExecutionLogRow[];
}

export async function getLatestSchedulerFailure(): Promise<SchedulerExecutionLogRow | null> {
  const { data, error } = await getSupabase()
    .from('scheduler_execution_logs')
    .select('*')
    .in('phase', ['failure', 'disabled'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[Scheduler] Failed to fetch latest scheduler failure:', error);
    return null;
  }

  const rows = (data || []) as SchedulerExecutionLogRow[];
  return rows[0] || null;
}

export async function getLatestHealthWatchdogEvent(): Promise<SchedulerExecutionLogRow | null> {
  const { data, error } = await getSupabase()
    .from('scheduler_execution_logs')
    .select('*')
    .eq('job_name', 'system-health-watchdog')
    .in('phase', ['success', 'failure'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[Scheduler] Failed to fetch latest health watchdog event:', error);
    return null;
  }

  const rows = (data || []) as SchedulerExecutionLogRow[];
  return rows[0] || null;
}

async function appendSchedulerFallbackLog(
  row: Record<string, unknown>,
  insertError: string,
): Promise<void> {
  try {
    await appendFile(
      SCHEDULER_FALLBACK_LOG_PATH,
      `${JSON.stringify({
        ...row,
        fallback_reason: insertError,
        fallback_logged_at: new Date().toISOString(),
      })}\n`,
      'utf8',
    );
  } catch (fallbackError) {
    console.error('[Scheduler] Failed to write fallback scheduler log:', fallbackError);
  }
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

// ============================================
// Pinned Userfiles (External Sessions)
// ============================================

export async function addPinnedUserfile(externalSessionId: string, fileId: string): Promise<void> {
  // Use raw SQL via rpc to append to array without race conditions
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
