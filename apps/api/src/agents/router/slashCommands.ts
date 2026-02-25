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
} from '../stateManager.js';

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

  return null;
}
