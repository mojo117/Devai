import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createSession, getMessages, listSessions } from '../db/queries.js';

const CreateSessionSchema = z.object({
  title: z.string().optional(),
});

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/sessions', async () => {
    return { sessions: listSessions() };
  });

  app.post('/sessions', async (request, reply) => {
    const parseResult = CreateSessionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const session = createSession(parseResult.data.title);
    return { session };
  });

  app.get('/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { messages: getMessages(id) };
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to fetch messages',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};
