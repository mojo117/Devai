/**
 * Slash Command Handler — instant commands that bypass the LLM queue.
 */

import { isValidEngine, formatEngineStatus, type EngineName } from '../../llm/engineProfiles.js';
import { setDefaultEngine, setDefaultMode } from '../../db/queries.js';
import {
  ensureStateLoaded,
  setGatheredInfo,
  flushState,
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
    const state = await ensureStateLoaded(sessionId);
    
    if (!arg) {
      const currentEngine = (state.taskContext.gatheredInfo.engineProfile as string) || 'glm';
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

  // /preview, /debug, /list are handled client-side in InputArea.tsx
  // and never reach the backend.

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
    const state = await ensureStateLoaded(sessionId);
    const current: SessionMode = (state.taskContext.gatheredInfo.loopMode as SessionMode) || 'serial';
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
