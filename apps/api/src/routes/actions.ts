import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getAllActions,
  getPendingActions,
  getAction,
  approveAndExecuteAction,
} from '../actions/manager.js';
import type { ApproveResponse } from '@devai/shared';

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
  app.post('/actions/approve', async (request, reply) => {
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
};
