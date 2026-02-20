import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createSession, getMessages, listSessions, updateSessionTitle, saveMessage } from '../db/queries.js';

const CreateSessionSchema = z.object({
  title: z.string().optional(),
});

const UpdateSessionSchema = z.object({
  title: z.string(),
});

const SaveMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string(),
  toolEvents: z.array(z.unknown()).optional(),
});

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/sessions', async () => {
    return { sessions: await listSessions() };
  });

  app.post('/sessions', async (request, reply) => {
    const parseResult = CreateSessionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const session = await createSession(parseResult.data.title);
    return { session };
  });

  app.get('/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { messages: await getMessages(id) };
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to fetch messages',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  app.post('/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parseResult = SaveMessageSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid message',
        details: parseResult.error.issues,
      });
    }

    try {
      const { toolEvents, ...message } = parseResult.data;
      await saveMessage(id, message, toolEvents);
      return { success: true };
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to save message',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  app.patch('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parseResult = UpdateSessionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    try {
      await updateSessionTitle(id, parseResult.data.title);
      return { success: true };
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to update session',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};
