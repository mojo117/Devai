// ──────────────────────────────────────────────
// Looper-AI  –  API Route
// POST /api/looper  –  NDJSON streaming
// ──────────────────────────────────────────────

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { LooperEngine } from '../looper/index.js';
import { llmRouter } from '../llm/router.js';
import { config } from '../config.js';
import { createSession, saveMessage, updateSessionTitleIfEmpty, getLooperState, upsertLooperState, deleteLooperState } from '../db/queries.js';
import type { ChatMessage } from '@devai/shared';
import type { LooperStreamEvent } from '@devai/shared';

const LooperRequestSchema = z.object({
  message: z.string().min(1),
  provider: z.enum(['anthropic', 'openai', 'gemini']),
  sessionId: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  config: z.object({
    maxIterations: z.number().int().min(1).max(100).optional(),
    maxConversationTokens: z.number().int().min(1000).optional(),
    maxToolRetries: z.number().int().min(0).max(10).optional(),
    minValidationConfidence: z.number().min(0).max(1).optional(),
    selfValidationEnabled: z.boolean().optional(),
  }).optional(),
});

/**
 * In-memory store for active loop engines keyed by sessionId.
 * Allows continuing a loop when the user responds to a clarification.
 */
const activeEngines = new Map<string, LooperEngine>();

export const looperRoutes: FastifyPluginAsync = async (app) => {

  // ── Main looper endpoint ───────────────────
  app.post('/looper', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'application/x-ndjson');

    const parseResult = LooperRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const { message, provider, sessionId: reqSessionId, config: looperCfg } = parseResult.data;

    if (!llmRouter.isProviderConfigured(provider)) {
      return reply.status(400).send({
        error: `Provider ${provider} is not configured. Set the API key in .env`,
      });
    }

    const sessionId = reqSessionId || (await createSession()).id;

    const sendEvent = (event: LooperStreamEvent) => {
      reply.raw.write(`${JSON.stringify(event)}\n`);
    };

    try {
      // Check if we're continuing an existing loop (clarification flow)
      let engine = activeEngines.get(sessionId);
      let result;

      if (engine) {
        // Continue the existing loop with the user's clarification
        engine.setStreamCallback(sendEvent);
        result = await engine.continueWithClarification(message);
      } else {
        // Try to resume from persisted snapshot (survives API restart)
        const persisted = await getLooperState(sessionId);
        if (persisted && persisted.status === 'waiting_for_user' && persisted.snapshot) {
          try {
            engine = LooperEngine.fromSnapshot(persisted.snapshot as any);
            engine.setStreamCallback(sendEvent);
            result = await engine.continueWithClarification(message);
          } catch (err) {
            app.log.warn({ err }, '[looper] Failed to restore persisted engine snapshot, starting new loop');
            engine = new LooperEngine(provider, looperCfg);
            engine.setStreamCallback(sendEvent);
            result = await engine.run(message, config.projectRoot);
          }
        } else {
          // Start a new loop
          engine = new LooperEngine(provider, looperCfg);
          engine.setStreamCallback(sendEvent);
          result = await engine.run(message, config.projectRoot);
        }
      }

      // If waiting for user, keep the engine alive
      if (result.status === 'waiting_for_user') {
        activeEngines.set(sessionId, engine);
        // Persist snapshot so clarification can resume later.
        await upsertLooperState({
          sessionId,
          provider,
          config: looperCfg || {},
          snapshot: engine.snapshot(),
          status: 'waiting_for_user',
        });
      } else {
        activeEngines.delete(sessionId);
        await deleteLooperState(sessionId);
      }

      // Persist messages
      const userMsg: ChatMessage = {
        id: nanoid(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      };
      saveMessage(sessionId, userMsg);

      const assistantMsg: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: result.answer,
        timestamp: new Date().toISOString(),
      };
      saveMessage(sessionId, assistantMsg);

      const title = message.length > 60 ? `${message.slice(0, 57)}...` : message;
      updateSessionTitleIfEmpty(sessionId, title);

      // Final response event
      sendEvent({
        type: 'answer',
        data: {
          answer: result.answer,
          steps: result.steps,
          sessionId,
          totalIterations: result.totalIterations,
          status: result.status,
        },
        timestamp: new Date().toISOString(),
      });

      reply.raw.end();
      return reply;
    } catch (error) {
      app.log.error(error);
      const errMsg = error instanceof Error ? error.message : 'Unknown error';

      // Even on crash, try to send a useful response
      sendEvent({
        type: 'error',
        data: { message: errMsg, recoverable: false },
        timestamp: new Date().toISOString(),
      });

      reply.raw.end();
      return reply;
    }
  });

  // ── Status endpoint for active loops ───────
  app.get('/looper/status/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const engine = activeEngines.get(sessionId);

    return reply.send({
      sessionId,
      active: !!engine,
      status: engine ? 'waiting_for_user' : 'idle',
    });
  });
};
