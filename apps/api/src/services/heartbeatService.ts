import { insertHeartbeatRun, updateHeartbeatRun } from '../db/queries.js'
import type { HeartbeatRunRow } from '../db/queries.js'
import { sendTelegramMessage } from '../external/telegram.js'
import { getState } from '../agents/stateManager.js'
import { config } from '../config.js'

const HEARTBEAT_PROMPT = `Heartbeat-Check. Pruefe Systemzustand:

1. Chat-Historie — Gibt es kuerzliche Sessions mit unbeantwortet gebliebenen
   Fragen, abgebrochenen Loops oder Fehlermeldungen?

2. Logs — Pruefe die API-Logs auf wiederkehrende Fehler, Timeouts oder
   auffaellige Muster der letzten 120 Minuten. Verwende pm2_logs oder logs_getStagingLogs.

3. Eigene Memory — Hast du dir etwas gemerkt, worauf du reagieren solltest?
   Offene Erinnerungen, anstehende Aufgaben aus vorherigen Sessions?

4. Scheduler — Pruefe auf fehlgeschlagene oder problematische geplante Jobs.

Wenn nichts ansteht: Antworte mit "NOOP" — keine Aktion, kein Output.
Wenn etwas ansteht: Fasse die Findings zusammen. Ergreife KEINE eigenstaendigen Massnahmen — der User entscheidet was passiert. Deine Aufgabe ist nur: beobachten, analysieren, berichten.`

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
  } catch (err) {
    console.error('[heartbeat] Failed to create DB record, running anyway:', err instanceof Error ? err.message : err)
  }

  const sessionId = `heartbeat-${new Date().toISOString().slice(0, 10)}`

  try {
    const result = await executor(sessionId, HEARTBEAT_PROMPT)
    const durationMs = Date.now() - startTime
    const isNoop = result.trim().toUpperCase() === 'NOOP' || result.trim().length < 10

    // Read token usage and model from session state (set by ChapoLoop)
    const state = getState(sessionId)
    const tokensUsed = typeof state?.taskContext.gatheredInfo.lastRunTokens === 'number'
      ? state.taskContext.gatheredInfo.lastRunTokens
      : null
    const modelSelection = state?.taskContext.gatheredInfo.modelSelection as
      { provider?: string; model?: string } | undefined
    const modelUsed = modelSelection
      ? `${modelSelection.provider}/${modelSelection.model}`
      : null

    const update: Partial<HeartbeatRunRow> = {
      status: isNoop ? 'noop' : 'completed',
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      tokens_used: tokensUsed,
      model: modelUsed,
      findings: isNoop ? null : { raw: result },
      actions_taken: isNoop ? null : [{ type: 'agent_response', content: result.slice(0, 2000) }],
    }

    if (!isNoop) {
      const chatId = config.telegramAllowedChatId?.split(/[,\s;]+/)[0]?.trim()
      if (chatId) {
        const message = `🔍 *Heartbeat Report*\n\n${result.slice(0, 3500)}`
        await sendTelegramMessage(chatId, message).catch((err) =>
          console.error('[heartbeat] Telegram notification failed:', err)
        )
      } else {
        console.warn('[heartbeat] Findings detected but no Telegram chat ID configured')
      }
    }

    if (runId) await updateHeartbeatRun(runId, update)

    console.info(`[heartbeat] ${update.status} in ${durationMs}ms, tokens=${tokensUsed ?? 'unknown'}, model=${modelUsed ?? 'unknown'}`)
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
