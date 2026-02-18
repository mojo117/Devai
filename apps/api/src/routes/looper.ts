// ──────────────────────────────────────────────
// Looper-AI  –  API Route
// POST /api/looper  –  NDJSON streaming
// ──────────────────────────────────────────────

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { resolve } from 'node:path';
import { LooperEngine } from '../looper/index.js';
import {
  LOOPER_CORE_SYSTEM_PROMPT,
  DECISION_SYSTEM_PROMPT,
  VALIDATION_SYSTEM_PROMPT,
  DEV_SYSTEM_PROMPT,
  SEARCH_SYSTEM_PROMPT,
  DOC_SYSTEM_PROMPT,
  CMD_SYSTEM_PROMPT,
} from '../prompts/index.js';
import { llmRouter } from '../llm/router.js';
import { config } from '../config.js';
import { createSession, saveMessage, updateSessionTitleIfEmpty, getLooperState, upsertLooperState, deleteLooperState } from '../db/queries.js';
import type { ChatMessage } from '@devai/shared';
import type { LooperStreamEvent } from '@devai/shared';

const LooperRequestSchema = z.object({
  message: z.string().min(1),
  provider: z.enum(['anthropic', 'openai', 'gemini']),
  sessionId: z.string().optional(),
  projectRoot: z.string().optional(),
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
  app.get('/looper/prompts', async () => {
    return {
      runtime: 'looper',
      prompts: [
        { id: 'looper.core', title: 'Looper Core', prompt: LOOPER_CORE_SYSTEM_PROMPT },
        { id: 'looper.decision', title: 'Decision Engine', prompt: DECISION_SYSTEM_PROMPT },
        { id: 'looper.validation', title: 'Self Validation', prompt: VALIDATION_SYSTEM_PROMPT },
        { id: 'looper.agent.developer', title: 'Developer Agent', prompt: DEV_SYSTEM_PROMPT },
        { id: 'looper.agent.searcher', title: 'Searcher Agent', prompt: SEARCH_SYSTEM_PROMPT },
        { id: 'looper.agent.document_manager', title: 'Document Manager Agent', prompt: DOC_SYSTEM_PROMPT },
        { id: 'looper.agent.commander', title: 'Commander Agent', prompt: CMD_SYSTEM_PROMPT },
      ],
    };
  });

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

    const { message, provider, sessionId: reqSessionId, projectRoot, config: looperCfg } = parseResult.data;

    if (!llmRouter.isProviderConfigured(provider)) {
      return reply.status(400).send({
        error: `Provider ${provider} is not configured. Set the API key in .env`,
      });
    }

    const sessionId = reqSessionId || (await createSession()).id;

    // Validate project root against allowed paths
    let validatedProjectRoot: string | null = null;
    if (projectRoot) {
      try {
        const normalizedPath = resolve(projectRoot);
        const isAllowed = config.allowedRoots.some((root) => {
          const absoluteRoot = resolve(root);
          return normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot;
        });
        if (isAllowed) {
          validatedProjectRoot = normalizedPath;
        }
      } catch {
        // ignore invalid path
      }
    }

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
            result = await engine.run(message, validatedProjectRoot || config.allowedRoots[0]);
          }
        } else {
          // Start a new loop
          engine = new LooperEngine(provider, looperCfg);
          engine.setStreamCallback(sendEvent);
          result = await engine.run(message, validatedProjectRoot || config.allowedRoots[0]);
        }
      }

      // If waiting for user, keep the engine alive
      if (result.status === 'waiting_for_user') {
        activeEngines.set(sessionId, engine);
        // Persist snapshot so clarification can resume later.
        try {
          await upsertLooperState({
            sessionId,
            provider,
            config: looperCfg || {},
            snapshot: engine.snapshot(),
            status: 'waiting_for_user',
          });
        } catch (err) {
          // Non-fatal: loop can keep running in-memory, but a restart would lose the snapshot.
          app.log.warn({ err, sessionId }, '[looper] Failed to persist engine snapshot');
        }
      } else {
        activeEngines.delete(sessionId);
        await deleteLooperState(sessionId);
      }

      // Persist messages
      const startedAt = Date.now();
      const userMsg: ChatMessage = {
        id: nanoid(),
        role: 'user',
        content: message,
        timestamp: new Date(startedAt).toISOString(),
      };

      const assistantMsg: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: result.answer,
        timestamp: new Date(startedAt + 1).toISOString(),
      };

      const title = message.length > 60 ? `${message.slice(0, 57)}...` : message;
      // Save in order to avoid same-timestamp ordering flips in history reloads.
      await saveMessage(sessionId, userMsg);
      await saveMessage(sessionId, assistantMsg);
      await updateSessionTitleIfEmpty(sessionId, title);

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
