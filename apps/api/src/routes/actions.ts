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

const ApproveRequestSchema = z.object({
  actionId: z.string(),
});

export const actionRoutes: FastifyPluginAsync = async (app) => {
  // Get all actions
  app.get('/actions', async () => {
    return {
      actions: getAllActions(),
    };
  });

  // Get only pending actions
  app.get('/actions/pending', async () => {
    return {
      actions: getPendingActions(),
    };
  });

  // Get single action by ID
  app.get('/actions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const action = getAction(id);

    if (!action) {
      return reply.status(404).send({ error: 'Action not found' });
    }

    return { action };
  });

  // Approve and execute an action
  app.post('/actions/approve', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parseResult = ApproveRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const { actionId } = parseResult.data;

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
    const parseResult = ApproveRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const { actionId } = parseResult.data;

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

  // Retry a failed action (creates a new pending action)
  app.post('/actions/retry', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parseResult = ApproveRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const { actionId } = parseResult.data;
    const action = getAction(actionId);

    if (!action) {
      return reply.status(404).send({ error: 'Action not found' });
    }

    if (action.status !== 'failed') {
      return reply.status(400).send({ error: `Action is not failed (current status: ${action.status})` });
    }

    const preview = await buildActionPreview(action.toolName, action.toolArgs);
    const retryAction = createAction({
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
