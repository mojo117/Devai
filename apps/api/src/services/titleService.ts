/**
 * Auto Session Title Generation
 *
 * Uses the LLM router to generate short ChatGPT-style titles
 * for chat sessions based on conversation content.
 * Rate-limited to once per 30s per session. Fire-and-forget safe.
 */

import { llmRouter } from '../llm/router.js';
import { getMessages } from '../db/messageQueries.js';
import { updateSessionTitleIfEmpty } from '../db/sessionQueries.js';
import { emitChatEvent } from '../websocket/chatGateway.js';
import type { LLMProvider } from '../llm/types.js';

const TITLE_PROMPT = `Summarize this conversation in 3-8 words as a short title.
Rules:
- Reply with ONLY the title, nothing else
- No quotes, no punctuation at the end
- Use the conversation's language
- Be specific, not generic`;

/** Dedup: sessionId -> timestamp of last title generation */
const lastGenerated = new Map<string, number>();
const DEDUP_INTERVAL_MS = 30_000;

/**
 * Generate an AI-powered session title from recent messages.
 * Rate-limited to once per 30s per session. Fire-and-forget safe.
 */
export async function generateSessionTitle(
  sessionId: string,
  provider: LLMProvider = 'zai',
): Promise<void> {
  // Rate limit: 30s between regenerations per session
  if (lastGenerated.has(sessionId) && Date.now() - lastGenerated.get(sessionId)! < DEDUP_INTERVAL_MS) return;
  lastGenerated.set(sessionId, Date.now());

  const allMessages = await getMessages(sessionId);
  // Need at least one user + one assistant message
  const textMessages = allMessages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
    .slice(0, 6); // First 6 messages max for title context

  if (textMessages.length < 2) return;

  const transcript = textMessages
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join('\n');

  try {
    const response = await llmRouter.generateWithFallback(provider, {
      model: 'glm-4.7-flash',
      messages: [{ role: 'user', content: transcript }],
      systemPrompt: TITLE_PROMPT,
      maxTokens: 50,
    });

    const title = response.content
      .trim()
      .replace(/\[gMASK\]|\[sMASK\]|\[CLS\]|\[SEP\]|\[PAD\]/gi, '') // strip GLM special tokens
      .replace(/^["']|["']$/g, '')  // strip wrapping quotes
      .replace(/[.!?]+$/, '')       // strip trailing punctuation
      .trim()
      .slice(0, 80);               // safety limit

    if (title.length >= 3) {
      await updateSessionTitleIfEmpty(sessionId, title);

      // Emit WS event so the frontend updates the session list live
      emitChatEvent(sessionId, {
        type: 'session_title_updated',
        sessionId,
        title,
      });

      console.log(`[titleService] Generated title for ${sessionId}: "${title}"`);
    }
  } catch (err) {
    console.warn('[titleService] Title generation failed:', err instanceof Error ? err.message : String(err));

    // FALLBACK: Generate title from first user message on any error
    try {
      const fallbackTitle = generateFallbackTitle(textMessages);
      if (fallbackTitle) {
        await updateSessionTitleIfEmpty(sessionId, fallbackTitle);
        emitChatEvent(sessionId, {
          type: 'session_title_updated',
          sessionId,
          title: fallbackTitle,
        });
        console.log(`[titleService] Fallback title for ${sessionId}: "${fallbackTitle}"`);
      }
    } catch (fallbackErr) {
      console.error('[titleService] Fallback title generation also failed:', fallbackErr);
    }
  }
}

/** Generate a fallback title from the first user message */
function generateFallbackTitle(messages: Array<{ role: string; content: string }>): string | null {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (!firstUserMessage?.content) return null;

  // Clean up the content
  let fallback = firstUserMessage.content
    .replace(/\[gMASK\]|\[sMASK\]|\[CLS\]|\[SEP\]|\[PAD\]/gi, '')
    .replace(/\n/g, ' ')
    .trim();

  // Truncate to ~50 chars at word boundary
  if (fallback.length > 50) {
    const truncated = fallback.slice(0, 50);
    const lastSpace = truncated.lastIndexOf(' ');
    fallback = lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated;
    fallback = fallback + '...';
  }

  return fallback || null;
}

/** Cleanup stale dedup entries (call periodically or on session delete) */
export function clearTitleDedup(sessionId: string): void {
  lastGenerated.delete(sessionId);
}
