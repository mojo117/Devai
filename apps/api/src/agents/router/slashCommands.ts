/**
 * Slash Command Handler — instant commands that bypass the LLM queue.
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

export async function tryHandleSlashCommand(
  sessionId: string,
  text: string,
): Promise<string | null> {
  const trimmed = text.trim();

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

  const previewMatch = trimmed.match(/^\/preview(?:\s+(on|off))?$/i);
  if (previewMatch) {
    const arg = previewMatch[1]?.toLowerCase();
    if (!arg) return 'Preview: `/preview on` or `/preview off`. This is a client-side UI feature.';
    return `Preview mode **${arg === 'on' ? 'ON' : 'OFF'}**. (Note: This takes effect in the web UI only.)`;
  }

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

  if (trimmed === '/stop') {
    const loopCount = getActiveLoopCount(sessionId);
    if (loopCount === 0) {
      return 'Keine aktiven Loops.';
    }
    const abortedTurnIds = await abortAllLoops(sessionId);
    abortLoopInstances(sessionId);
    clearInbox(sessionId);
    return `${abortedTurnIds.length} Loop(s) abgebrochen.`;
  }

  if (trimmed === '/mode') {
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
