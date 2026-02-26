import { nanoid } from 'nanoid';
import { getSupabase } from './index.js';

const DEFAULT_USER_ID = 'local';

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
