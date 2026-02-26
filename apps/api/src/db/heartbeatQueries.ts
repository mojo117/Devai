import { getSupabase } from './index.js';

export interface HeartbeatRunRow {
  id: string
  started_at: string
  completed_at: string | null
  status: 'running' | 'completed' | 'failed' | 'noop'
  findings: Record<string, unknown> | null
  actions_taken: Array<Record<string, unknown>> | null
  tokens_used: number | null
  model: string | null
  error: string | null
  duration_ms: number | null
}

export async function insertHeartbeatRun(
  status: 'running',
): Promise<string> {
  const { data, error } = await getSupabase()
    .from('heartbeat_runs')
    .insert({ status })
    .select('id')
    .single()

  if (error) {
    console.error('[db] Failed to insert heartbeat run:', error)
    throw error
  }

  return data.id as string
}

export async function updateHeartbeatRun(
  id: string,
  update: Partial<Omit<HeartbeatRunRow, 'id' | 'started_at'>>,
): Promise<void> {
  const { error } = await getSupabase()
    .from('heartbeat_runs')
    .update(update)
    .eq('id', id)

  if (error) {
    console.error('[db] Failed to update heartbeat run:', error)
  }
}
