/**
 * External Output Projection - sends workflow outputs to external platforms.
 *
 * Current platform: Telegram.
 */

import type { Projection } from '../events/bus.js';
import type { WorkflowEventEnvelope } from '../events/envelope.js';
import {
  WF_COMPLETED,
  GATE_QUESTION_QUEUED,
  GATE_APPROVAL_QUEUED,
} from '../events/catalog.js';
import { getExternalSessionBySessionId } from '../../db/schedulerQueries.js';
import { sendTelegramMessage } from '../../external/telegram.js';

export class ExternalOutputProjection implements Projection {
  name = 'external-output';

  async handle(event: WorkflowEventEnvelope): Promise<void> {
    if (
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
      if (event.eventType === WF_COMPLETED) {
        const answer = typeof payload.answer === 'string' ? payload.answer : '';
        if (!answer.trim()) return;
        await sendTelegramMessage(chatId, answer);
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
