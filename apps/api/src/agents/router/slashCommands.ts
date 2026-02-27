/**
 * Slash Command Handler — instant commands that bypass the LLM queue.
 *
 * These commands execute immediately even when an LLM request is in-flight,
 * so `/engine glm` doesn't wait for a rate-limited provider to finish retrying.
 */

import { isValidEngine, formatEngineStatus, type EngineName } from '../../llm/engineProfiles.js';
import { setDefaultEngine, setDefaultMode } from '../../db/queries.js';
import {
  getState,
  setGatheredInfo,
  flushState,
  getSessionMode,
  setSessionMode,
  abortAllLoops,
  getActiveLoopCount,
} from '../stateManager.js';
import type { SessionMode } from '../stateManager.js';
import { clearInbox } from '../inbox.js';
import { abortLoopInstances } from '../chapo-loop.js';
import { emitChatEvent } from '../../websocket/chatGateway.js';

// Rate limiting for destructive commands: sessionId -> { count, resetAt }
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMIT_MAX = 5; // max commands per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window

function checkRateLimit(sessionId: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(sessionId);

  if (!entry || now > entry.resetAt) {
    // New window
    rateLimitMap.set(sessionId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true };
}

function formatRetryTime(ms: number): string {
  if (ms < 1000) return '1 Sekunde';
  const seconds = Math.ceil(ms / 1000);
  return `${seconds} Sekunde${seconds > 1 ? 'n' : ''}`;
}

/**
 * Try to handle a slash command instantly, without routing through the LLM.
 * Returns a response string if a slash command was recognised, or null otherwise.
 */
export async function tryHandleSlashCommand(
  sessionId: string,
  text: string,
): Promise<string | null> {
  const trimmed = text.trim();

  // /engine [glm|gemini|claude]
  const engineMatch = trimmed.match(/^\/engine(?:\s+(.*))?$/i);
  if (engineMatch) {
    const arg = engineMatch[1]?.trim().toLowerCase();
    if (!arg) {
      const currentEngine = (getState(sessionId)
        ?.taskContext.gatheredInfo.engineProfile as string) || 'glm';
      return formatEngineStatus(currentEngine as EngineName);
    }
    if (isValidEngine(arg)) {
      setGatheredInfo(sessionId, 'engineProfile', arg);
      await flushState(sessionId);
      await setDefaultEngine(arg);
      return `Engine switched to **${arg.toUpperCase()}**.\n\n${formatEngineStatus(arg)}`;
    }
    return `Unknown engine "${arg}". Available: glm, gemini, claude, kimi.\nUsage: /engine <glm|gemini|claude|kimi>`;
  }

  // /preview [on|off]
  const previewMatch = trimmed.match(/^\/preview(?:\s+(on|off))?$/i);
  if (previewMatch) {
    const arg = previewMatch[1]?.toLowerCase();
    if (!arg) return 'Preview: `/preview on` or `/preview off`. This is a client-side UI feature.';
    return `Preview mode **${arg === 'on' ? 'ON' : 'OFF'}**. (Note: This takes effect in the web UI only.)`;
  }

  // /list — show all available slash commands
  if (trimmed === '/list') {
    return [
      '**Slash Commands**\n',
      '`/engine [glm|gemini|claude|kimi]` — LLM Engine wechseln oder Status anzeigen',
      '`/preview [on|off]` — Preview-Panel im Web-UI ein-/ausschalten',
      '`/mode` — Zwischen Serial und Parallel Mode umschalten',
      '`/stop` — Alle laufenden Loops abbrechen',
      '`/list` — Diese Liste anzeigen',
    ].join('\n');
  }

  // /stop — abort all running loops (rate limited)
  if (trimmed === '/stop') {
    const rateLimit = checkRateLimit(sessionId);
    if (!rateLimit.allowed) {
      return `Zu viele /stop Befehle. Bitte warte ${formatRetryTime(rateLimit.retryAfterMs!)}.`;
    }

    const loopCount = getActiveLoopCount(sessionId);
    if (loopCount === 0) {
      return 'Keine aktiven Loops.';
    }
    const abortedTurnIds = await abortAllLoops(sessionId);
    abortLoopInstances(sessionId);
    clearInbox(sessionId);
    return `${abortedTurnIds.length} Loop(s) abgebrochen.`;
  }

  // /mode — toggle between serial and parallel (rate limited to prevent spam)
  if (trimmed === '/mode') {
    const rateLimit = checkRateLimit(sessionId);
    if (!rateLimit.allowed) {
      return `Zu viele /mode Befehle. Bitte warte ${formatRetryTime(rateLimit.retryAfterMs!)}.`;
    }

    const current = getSessionMode(sessionId);
    const next: SessionMode = current === 'serial' ? 'parallel' : 'serial';
    setSessionMode(sessionId, next);
    await flushState(sessionId);
    await setDefaultMode(next);
    emitChatEvent(sessionId, { type: 'mode_changed', mode: next });
    return next === 'parallel'
      ? '**Parallel Mode** — Neue Nachrichten starten sofort einen eigenen Loop.'
      : '**Serial Mode** — Nachrichten werden nacheinander verarbeitet.';
  }

  return null;
}
