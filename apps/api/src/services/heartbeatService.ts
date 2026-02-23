import { insertHeartbeatRun, updateHeartbeatRun } from '../db/queries.js'
import type { HeartbeatRunRow } from '../db/queries.js'

const HEARTBEAT_PROMPT = `Heartbeat-Check. Pruefe:

1. Chat-Historie — Gibt es kuerzliche Sessions mit unbeantwortet gebliebenen
   Fragen, abgebrochenen Loops oder Fehlermeldungen?

2. Logs — Pruefe die API-Logs auf wiederkehrende Fehler, Timeouts oder
   auffaellige Muster der letzten 120 Minuten. (ssh_execute: pm2 logs devai-api-dev --lines 100 --nostream)

3. Eigene Memory — Hast du dir etwas gemerkt, worauf du reagieren solltest?
   Offene Erinnerungen, anstehende Aufgaben aus vorherigen Sessions?

Wenn nichts ansteht: Antworte mit "NOOP" — keine Aktion, kein Output.
Wenn etwas ansteht: Handle es oder benachrichtige den User via Telegram.`

function isQuietHours(): boolean {
  const berlinHour = new Date().toLocaleString('en-US', {
    timeZone: 'Europe/Berlin',
    hour: 'numeric',
    hour12: false,
  })
  const hour = parseInt(berlinHour, 10)
  return hour >= 21 || hour < 7
}

export type HeartbeatExecutor = (
  sessionId: string,
  instruction: string,
) => Promise<string>

let executor: HeartbeatExecutor | null = null

export function configureHeartbeat(exec: HeartbeatExecutor): void {
  executor = exec
}

export async function runHeartbeat(): Promise<void> {
  if (isQuietHours()) return
  if (!executor) {
    console.warn('[heartbeat] No executor configured, skipping')
    return
  }

  const startTime = Date.now()
  let runId: string | undefined

  try {
    runId = await insertHeartbeatRun('running')
  } catch {
    console.error('[heartbeat] Failed to create DB record, running anyway')
  }

  const sessionId = `heartbeat-${new Date().toISOString().slice(0, 10)}`

  try {
    const result = await executor(sessionId, HEARTBEAT_PROMPT)
    const durationMs = Date.now() - startTime
    const isNoop = result.trim().toUpperCase() === 'NOOP' || result.trim().length < 10

    const update: Partial<HeartbeatRunRow> = {
      status: isNoop ? 'noop' : 'completed',
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      findings: isNoop ? null : { raw: result },
      actions_taken: isNoop ? null : [{ type: 'agent_response', content: result.slice(0, 500) }],
    }

    if (runId) await updateHeartbeatRun(runId, update)

    console.info(`[heartbeat] ${update.status} in ${durationMs}ms`)
  } catch (err) {
    const durationMs = Date.now() - startTime
    const errorMsg = err instanceof Error ? err.message : String(err)

    if (runId) {
      await updateHeartbeatRun(runId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error: errorMsg,
      })
    }

    console.error(`[heartbeat] Failed in ${durationMs}ms:`, errorMsg)
  }
}
