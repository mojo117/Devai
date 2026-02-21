import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { commandDispatcher } from '../workflow/commands/dispatcher.js';
import { ensureStateLoaded, getState, isLoopActive } from '../agents/stateManager.js';
import { pushToInbox } from '../agents/inbox.js';
import type { InboxMessage } from '../agents/types.js';
import {
  getOrCreateExternalSession,
  updateExternalSessionSessionId,
  addPinnedUserfile,
  getPinnedUserfileIds,
  clearPinnedUserfiles,
} from '../db/schedulerQueries.js';
import type { WorkflowCommand } from '../workflow/commands/types.js';
import type { TelegramUpdate } from '../external/telegram.js';
import { isAllowedChat, sendTelegramMessage, extractTelegramMessage, downloadTelegramFile } from '../external/telegram.js';
import { createSession } from '../db/queries.js';
import { transcribeBuffer } from '../services/transcriptionService.js';
import { uploadUserfileFromBuffer, isUploadError } from '../services/userfileService.js';
import { shouldAttachPinnedContext } from '../external/pinnedContextPolicy.js';

function parseYesNoDecision(text: string): boolean | null {
  const normalized = text.trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
  if (!normalized) return null;

  const yes = new Set([
    'y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'continue', 'proceed',
    'ja', 'j', 'klar', 'weiter', 'mach weiter', 'bitte weiter',
  ]);
  const no = new Set([
    'n', 'no', 'nope', 'stop', 'cancel', 'abort',
    'nein', 'nee', 'stopp', 'abbrechen',
  ]);

  if (yes.has(normalized)) return true;
  if (no.has(normalized)) return false;
  return null;
}

export const externalRoutes: FastifyPluginAsync = async (app) => {
  app.post('/telegram/webhook', async (request, reply) => {
    const update = request.body as TelegramUpdate;

    // Respond to Telegram immediately; processing continues in the background.
    reply.status(200).send({ ok: true });

    const extracted = extractTelegramMessage(update);
    if (!extracted) return;

    if (!isAllowedChat(extracted.chatId)) {
      console.warn('[Telegram] Rejected message from unauthorized chat:', extracted.chatId);
      return;
    }

    void (async () => {
      try {
        const externalSession = await getOrCreateExternalSession('telegram', extracted.userId, extracted.chatId);

        // Determine the text content (text or caption)
        const messageText = extracted.text || extracted.caption || '';

        const normalizedCommand = messageText.trim().toLowerCase();
        if (normalizedCommand === '/restart' || normalizedCommand === '/reset') {
          const nextSession = await createSession('Telegram Session');
          await updateExternalSessionSessionId(externalSession.id, nextSession.id);
          await clearPinnedUserfiles(externalSession.id);
          await sendTelegramMessage(
            extracted.chatId,
            'Neue Konversation gestartet. Wir arbeiten jetzt in einer frischen Session ohne alte Datei-Kontexte.'
          );
          return;
        }

        // --- Voice message: transcribe and process as text ---
        if (extracted.voice) {
          const { buffer } = await downloadTelegramFile(extracted.voice.file_id);
          const text = await transcribeBuffer(buffer, 'voice.ogg');

          if (!text.trim()) {
            await sendTelegramMessage(extracted.chatId, 'Konnte keine Sprache erkennen.');
            return;
          }

          await sendTelegramMessage(extracted.chatId, `🎤 ${text}`);

          await commandDispatcher.dispatch({
            type: 'user_request',
            sessionId: externalSession.session_id,
            requestId: nanoid(),
            message: text,
            metadata: { platform: 'telegram' },
            pinnedUserfileIds: await getPinnedUserfileIds(externalSession.id),
          } as WorkflowCommand, { joinSession: () => {} });
          return;
        }

        // --- Document upload ---
        if (extracted.document) {
          const { buffer } = await downloadTelegramFile(extracted.document.file_id);
          const filename = extracted.document.file_name || `document_${Date.now()}`;
          const mimeType = extracted.document.mime_type || 'application/octet-stream';

          const result = await uploadUserfileFromBuffer(buffer, filename, mimeType);
          if (isUploadError(result)) {
            await sendTelegramMessage(extracted.chatId, `Upload fehlgeschlagen: ${result.error}`);
            return;
          }

          await addPinnedUserfile(externalSession.id, result.file.id);

          if (extracted.caption) {
            await sendTelegramMessage(extracted.chatId, `📎 ${filename} hochgeladen`);
            await commandDispatcher.dispatch({
              type: 'user_request',
              sessionId: externalSession.session_id,
              requestId: nanoid(),
              message: extracted.caption,
              metadata: { platform: 'telegram' },
              pinnedUserfileIds: await getPinnedUserfileIds(externalSession.id),
            } as WorkflowCommand, { joinSession: () => {} });
          } else {
            await sendTelegramMessage(extracted.chatId, `📎 ${filename} hochgeladen und gepinnt`);
          }
          return;
        }

        // --- Photo upload ---
        if (extracted.photo && extracted.photo.length > 0) {
          const largest = extracted.photo[extracted.photo.length - 1];
          const { buffer } = await downloadTelegramFile(largest.file_id);
          const filename = `photo_${Date.now()}.jpg`;

          const result = await uploadUserfileFromBuffer(buffer, filename, 'image/jpeg');
          if (isUploadError(result)) {
            await sendTelegramMessage(extracted.chatId, `Upload fehlgeschlagen: ${result.error}`);
            return;
          }

          await addPinnedUserfile(externalSession.id, result.file.id);

          if (extracted.caption) {
            await sendTelegramMessage(extracted.chatId, `📷 Foto hochgeladen`);
            await commandDispatcher.dispatch({
              type: 'user_request',
              sessionId: externalSession.session_id,
              requestId: nanoid(),
              message: extracted.caption,
              metadata: { platform: 'telegram' },
              pinnedUserfileIds: await getPinnedUserfileIds(externalSession.id),
            } as WorkflowCommand, { joinSession: () => {} });
          } else {
            await sendTelegramMessage(extracted.chatId, `📷 Foto hochgeladen und gepinnt`);
          }
          return;
        }

        // --- Text message (existing flow) ---
        if (!messageText) return;

        await ensureStateLoaded(externalSession.session_id);

        const state = getState(externalSession.session_id);
        const pendingApprovals = state?.pendingApprovals ?? [];
        const pendingQuestions = state?.pendingQuestions ?? [];
        const decision = parseYesNoDecision(messageText);

        let command: WorkflowCommand;
        if (decision !== null && pendingApprovals.length > 0) {
          const latestApproval = pendingApprovals[pendingApprovals.length - 1];
          command = {
            type: 'user_approval_decided',
            sessionId: externalSession.session_id,
            requestId: nanoid(),
            approvalId: latestApproval.approvalId,
            approved: decision,
          };
        } else if (state?.currentPhase === 'waiting_user' && pendingQuestions.length > 0) {
          const latestQuestion = pendingQuestions[pendingQuestions.length - 1];
          command = {
            type: 'user_question_answered',
            sessionId: externalSession.session_id,
            requestId: nanoid(),
            questionId: latestQuestion.questionId,
            answer: messageText,
          };
        } else {
          // Multi-message: if loop is running, queue and acknowledge via Telegram
          if (isLoopActive(externalSession.session_id)) {
            const inboxMsg: InboxMessage = {
              id: nanoid(),
              content: messageText,
              receivedAt: new Date(),
              acknowledged: false,
              source: 'telegram' as const,
            };
            pushToInbox(externalSession.session_id, inboxMsg);
            await sendTelegramMessage(
              extracted.chatId,
              'Nachricht erhalten — ich kuemmere mich darum, sobald ich mit dem aktuellen Task fertig bin.',
            );
            return;
          }

          const pinnedUserfileIds = shouldAttachPinnedContext(messageText)
            ? await getPinnedUserfileIds(externalSession.id)
            : [];
          command = {
            type: 'user_request',
            sessionId: externalSession.session_id,
            requestId: nanoid(),
            message: messageText,
            metadata: { platform: 'telegram' },
            pinnedUserfileIds,
          } as WorkflowCommand;
        }

        await commandDispatcher.dispatch(command, {
          joinSession: () => {},
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('[Telegram] Error processing message:', errMsg);
        await sendTelegramMessage(extracted.chatId, `Fehler: ${errMsg}`);
      }
    })();
  });
};
