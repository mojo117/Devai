import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { commandDispatcher } from '../workflow/commands/dispatcher.js';
import { ensureStateLoaded, getState } from '../agents/stateManager.js';
import { getOrCreateExternalSession, updateExternalSessionSessionId } from '../db/schedulerQueries.js';
import type { WorkflowCommand } from '../workflow/commands/types.js';
import type { TelegramUpdate } from '../external/telegram.js';
import { isAllowedChat, sendTelegramMessage } from '../external/telegram.js';
import { createSession } from '../db/queries.js';

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

function extractTelegramMessage(update: TelegramUpdate): {
  text: string;
  chatId: string;
  userId: string;
} | null {
  const text = update.message?.text?.trim();
  const chatId = update.message?.chat?.id;
  const userId = update.message?.from?.id;

  if (!text || chatId === undefined || userId === undefined) return null;
  return { text, chatId: String(chatId), userId: String(userId) };
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

        const normalizedCommand = extracted.text.trim().toLowerCase();
        if (normalizedCommand === '/restart' || normalizedCommand === '/reset') {
          const nextSession = await createSession('Telegram Session');
          await updateExternalSessionSessionId(externalSession.id, nextSession.id);
          await sendTelegramMessage(
            extracted.chatId,
            'Neue Konversation gestartet. Wir arbeiten jetzt in einer frischen Session.'
          );
          return;
        }

        await ensureStateLoaded(externalSession.session_id);

        const state = getState(externalSession.session_id);
        const pendingApprovals = state?.pendingApprovals ?? [];
        const pendingQuestions = state?.pendingQuestions ?? [];
        const decision = parseYesNoDecision(extracted.text);

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
            answer: extracted.text,
          };
        } else {
          command = {
            type: 'user_request',
            sessionId: externalSession.session_id,
            requestId: nanoid(),
            message: extracted.text,
          };
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
