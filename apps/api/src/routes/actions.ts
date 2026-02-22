import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getAllActions,
  getPendingActions,
  getAction,
  approveAndExecuteAction,
  rejectAction,
  createAction,
} from '../actions/manager.js';
import { buildActionPreview } from '../actions/preview.js';
import { nanoid } from 'nanoid';
import type { ApproveResponse, RejectResponse, RetryResponse } from '@devai/shared';
import { parseOrReply400 } from './validation.js';

const ApproveRequestSchema = z.object({
  actionId: z.string(),
});

const BatchApproveRequestSchema = z.object({
  actionIds: z.array(z.string()).min(1).max(50),
});

export const actionRoutes: FastifyPluginAsync = async (app) => {
  // Get all actions
  app.get('/actions', async () => {
    return {
      actions: await getAllActions(),
    };
  });

  // Get only pending actions
  app.get('/actions/pending', async () => {
    return {
      actions: await getPendingActions(),
    };
  });

  // Get single action by ID
  app.get('/actions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const action = await getAction(id);

    if (!action) {
      return reply.status(404).send({ error: 'Action not found' });
    }

    return { action };
  });

  // Approve and execute an action
  app.post('/actions/approve', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = parseOrReply400(reply, ApproveRequestSchema, request.body);
    if (!parsed) return;
    const { actionId } = parsed;

    try {
      const action = await approveAndExecuteAction(actionId);

      const response: ApproveResponse = {
        action,
        result: action.result,
        error: action.error,
      };

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message === 'Action not found') {
        return reply.status(404).send({ error: message });
      }

      return reply.status(400).send({ error: message });
    }
  });

  // Reject an action
  app.post('/actions/reject', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = parseOrReply400(reply, ApproveRequestSchema, request.body);
    if (!parsed) return;
    const { actionId } = parsed;

    try {
      const action = await rejectAction(actionId);

      const response: RejectResponse = {
        action,
      };

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message === 'Action not found') {
        return reply.status(404).send({ error: message });
      }

      return reply.status(400).send({ error: message });
    }
  });

  // Batch approve multiple actions
  app.post('/actions/approve-batch', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = parseOrReply400(reply, BatchApproveRequestSchema, request.body);
    if (!parsed) return;
    const { actionIds } = parsed;
    const results: Array<{ actionId: string; success: boolean; error?: string; result?: unknown }> = [];

    for (const actionId of actionIds) {
      try {
        const action = await approveAndExecuteAction(actionId);
        results.push({
          actionId,
          success: action.status === 'done',
          error: action.error,
          result: action.result,
        });
      } catch (error) {
        results.push({
          actionId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { results };
  });

  // Batch reject multiple actions
  app.post('/actions/reject-batch', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = parseOrReply400(reply, BatchApproveRequestSchema, request.body);
    if (!parsed) return;
    const { actionIds } = parsed;
    const results: Array<{ actionId: string; success: boolean; error?: string }> = [];

    for (const actionId of actionIds) {
      try {
        await rejectAction(actionId);
        results.push({
          actionId,
          success: true,
        });
      } catch (error) {
        results.push({
          actionId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { results };
  });

  // Retry a failed action (creates a new pending action)
  app.post('/actions/retry', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = parseOrReply400(reply, ApproveRequestSchema, request.body);
    if (!parsed) return;
    const { actionId } = parsed;
    const action = await getAction(actionId);

    if (!action) {
      return reply.status(404).send({ error: 'Action not found' });
    }

    if (action.status !== 'failed') {
      return reply.status(400).send({ error: `Action is not failed (current status: ${action.status})` });
    }

    const preview = await buildActionPreview(action.toolName, action.toolArgs);
    const retryAction = await createAction({
      id: nanoid(),
      toolName: action.toolName,
      toolArgs: action.toolArgs,
      description: `Retry: ${action.description}`,
      preview,
    });

    const response: RetryResponse = {
      action: retryAction,
      originalActionId: action.id,
    };

    return response;
  });
};
