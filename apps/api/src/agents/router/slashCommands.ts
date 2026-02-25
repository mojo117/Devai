/**
 * Slash Command Handler — instant commands that bypass the LLM queue.
 *
 * These commands execute immediately even when an LLM request is in-flight,
 * so `/engine glm` doesn't wait for a rate-limited provider to finish retrying.
 */

import { isValidEngine, formatEngineStatus, type EngineName } from '../../llm/engineProfiles.js';
import { setDefaultEngine } from '../../db/queries.js';
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
    return `Unknown engine "${arg}". Available: glm, gemini, claude.\nUsage: /engine <glm|gemini|claude>`;
  }

  // /preview [on|off]
  const previewMatch = trimmed.match(/^\/preview(?:\s+(on|off))?$/i);
  if (previewMatch) {
    const arg = previewMatch[1]?.toLowerCase();
    if (!arg) return 'Preview: `/preview on` or `/preview off`. This is a client-side UI feature.';
    return `Preview mode **${arg === 'on' ? 'ON' : 'OFF'}**. (Note: This takes effect in the web UI only.)`;
  }

  // /mode [serial|parallel]
  const modeMatch = trimmed.match(/^\/mode(?:\s+(.*))?$/i);
  if (modeMatch) {
    const arg = modeMatch[1]?.trim().toLowerCase();
    if (!arg) {
      const current = getSessionMode(sessionId);
      return `Current mode: **${current}**.\nUsage: \`/mode serial\` or \`/mode parallel\``;
    }
    if (arg === 'serial' || arg === 'parallel') {
      setSessionMode(sessionId, arg as SessionMode);
      await flushState(sessionId);
      return arg === 'parallel'
        ? '**Parallel Mode** aktiviert. Neue Nachrichten starten sofort einen eigenen Loop.'
        : '**Serial Mode** aktiviert. Nachrichten werden nacheinander verarbeitet.';
    }
    return `Unknown mode "${arg}". Available: serial, parallel.\nUsage: \`/mode <serial|parallel>\``;
  }

  // /stop — abort all running loops
  if (trimmed === '/stop') {
    const loopCount = getActiveLoopCount(sessionId);
    if (loopCount === 0) {
      return 'Keine aktiven Loops.';
    }
    const abortedTurnIds = abortAllLoops(sessionId);
    abortLoopInstances(sessionId);
    clearInbox(sessionId);
    return `${abortedTurnIds.length} Loop(s) abgebrochen.`;
  }

  return null;
}
