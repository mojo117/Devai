/**
 * External Output Projection - sends workflow outputs to external platforms.
 *
 * Current platform: Telegram.
 */

import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import { isIP } from 'node:net';
import {
  WF_COMPLETED,
  WF_TURN_STARTED,
  AGENT_THINKING,
  TOOL_CALL_STARTED,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_QUEUED,
} from '../events/catalog.js';
import { getExternalSessionBySessionId } from '../../db/schedulerQueries.js';
import { sendTelegramMessage, sendTelegramChatAction, sendTelegramDocument } from '../../external/telegram.js';

const TELEGRAM_MAX_DOC_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_URLS_PER_ANSWER = 3;
const ALLOWED_IMAGE_HOST_PATTERNS = [
  /^oaidalleapiprod[a-z0-9-]*\.blob\.core\.windows\.net$/i,
  /^images\.openai\.com$/i,
  /^files\.openaiusercontent\.com$/i,
];

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  return Array.from(new Set(matches.map((url) => url.replace(/[.,;:!?]+$/g, ''))));
}

function looksLikeImageUrl(url: string): boolean {
  if (/\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(url)) return true;
  if (/[?&](?:rsct|response-content-type)=image%2F/i.test(url)) return true;
  if (/[?&](?:rsct|response-content-type)=image\//i.test(url)) return true;
  return /oaidalleapiprod/i.test(url) || /img-[a-z0-9]+/i.test(url);
}

function isPrivateOrLocalIp(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) {
    const octets = hostname.split('.').map((part) => Number.parseInt(part, 10));
    if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
      return true;
    }
    if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    return false;
  }
  if (version === 6) {
    const normalized = hostname.toLowerCase();
    return (
      normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb')
    );
  }
  return false;
}

function isAllowedImageHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (isPrivateOrLocalIp(normalized)) return false;
  return ALLOWED_IMAGE_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeAndValidateImageUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    if (!isAllowedImageHost(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').filter(Boolean).pop();
    if (name && name.includes('.')) {
      return decodeURIComponent(name);
    }
  } catch {
    // ignore
  }
  return `image_${Date.now()}.png`;
}

async function sendImageDocumentsFromAnswer(chatId: string, answer: string): Promise<number> {
  const urls = Array.from(new Set(
    extractUrls(answer)
      .filter((url) => looksLikeImageUrl(url))
      .map((url) => normalizeAndValidateImageUrl(url))
      .filter((url): url is string => Boolean(url))
  ));
  if (urls.length === 0) return 0;

  let sent = 0;
  for (const url of urls.slice(0, MAX_IMAGE_URLS_PER_ANSWER)) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        redirect: 'manual',
      });
      if (!res.ok) continue;

      const contentLengthRaw = res.headers.get('content-length');
      const contentLength = contentLengthRaw ? Number.parseInt(contentLengthRaw, 10) : Number.NaN;
      if (Number.isFinite(contentLength) && contentLength > TELEGRAM_MAX_DOC_BYTES) continue;

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType && !contentType.startsWith('image/')) continue;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0 || buffer.length > TELEGRAM_MAX_DOC_BYTES) continue;

      const filename = filenameFromUrl(url);
      await sendTelegramDocument(chatId, buffer, filename);
      sent++;
    } catch (error) {
      console.warn('[ExternalOutputProjection] Failed to send image URL as Telegram document', {
        chatId,
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return sent;
}

export class ExternalOutputProjection implements Projection {
  name = 'external-output';
  private readonly typingCooldownMs = 3500;
  private readonly lastTypingByChat = new Map<string, number>();

  private shouldSendTyping(chatId: string): boolean {
    const now = Date.now();
    const last = this.lastTypingByChat.get(chatId) || 0;
    if (now - last < this.typingCooldownMs) {
      return false;
    }
    this.lastTypingByChat.set(chatId, now);
    return true;
  }

  async handle(event: WorkflowEventEnvelope): Promise<void> {
    if (
      event.eventType !== WF_TURN_STARTED &&
      event.eventType !== AGENT_THINKING &&
      event.eventType !== TOOL_CALL_STARTED &&
      event.eventType !== WF_COMPLETED &&
      event.eventType !== GATE_QUESTION_QUEUED &&
      event.eventType !== GATE_APPROVAL_QUEUED
    ) {
      return;
    }

    const externalSession = await getExternalSessionBySessionId(event.sessionId);
    if (!externalSession) return;
    if (externalSession.platform !== 'telegram') return;

    const chatId = externalSession.external_chat_id;
    const payload = event.payload as Record<string, unknown>;

    try {
      if (
        event.eventType === WF_TURN_STARTED ||
        event.eventType === AGENT_THINKING ||
        event.eventType === TOOL_CALL_STARTED
      ) {
        if (!this.shouldSendTyping(String(chatId))) return;
        await sendTelegramChatAction(chatId, 'typing');
        return;
      }

      if (event.eventType === WF_COMPLETED) {
        const answer = typeof payload.answer === 'string' ? payload.answer : '';
        if (!answer.trim()) return;
        await sendTelegramMessage(chatId, answer);
        await sendImageDocumentsFromAnswer(String(chatId), answer);
        return;
      }

      if (event.eventType === GATE_QUESTION_QUEUED) {
        const directQuestion = typeof payload.question === 'string' ? payload.question : '';
        const nestedQuestion = payload.question && typeof payload.question === 'object'
          ? (payload.question as Record<string, unknown>).question
          : undefined;
        const question = directQuestion || (typeof nestedQuestion === 'string' ? nestedQuestion : 'Bitte gib mehr Details an.');
        await sendTelegramMessage(chatId, `Frage: ${question}`);
        return;
      }

      const directDescription = typeof payload.description === 'string' ? payload.description : '';
      const nestedDescription = payload.request && typeof payload.request === 'object'
        ? (payload.request as Record<string, unknown>).description
        : undefined;
      const description = directDescription || (typeof nestedDescription === 'string' ? nestedDescription : 'Freigabe erforderlich.');
      await sendTelegramMessage(
        chatId,
        `Genehmigung erforderlich:\n${description}\n\nAntworte mit \"ja\" oder \"nein\".`
      );
    } catch (error) {
      console.error('[ExternalOutputProjection] Failed to send external message:', error);
    }
  }
}
