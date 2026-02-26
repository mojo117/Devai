import { getSupabase } from './index.js';

let warnedMissingAgentStatesTable = false;

function isMissingAgentStatesTableError(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error?.code === 'PGRST205' && /agent_states/i.test(error?.message || ''));
}

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
    if (isMissingAgentStatesTableError(error)) {
      if (!warnedMissingAgentStatesTable) {
        warnedMissingAgentStatesTable = true;
        console.warn(
          '[state] Persistence disabled: table "agent_states" is missing in Supabase. Apply DB migration to re-enable state persistence.',
        );
      }
      return null;
    }

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
    if (isMissingAgentStatesTableError(error)) {
      if (!warnedMissingAgentStatesTable) {
        warnedMissingAgentStatesTable = true;
        console.warn(
          '[state] Persistence disabled: table "agent_states" is missing in Supabase. Apply DB migration to re-enable state persistence.',
        );
      }
      return;
    }

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
