import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  readDailyMemory,
  rememberNote,
  searchWorkspaceMemory,
} from '../memory/workspaceMemory.js';

const RememberSchema = z.object({
  content: z.string().min(1).max(4000),
  promoteToLongTerm: z.boolean().optional().default(false),
  sessionId: z.string().optional(),
  source: z.string().optional(),
});

const SearchQuerySchema = z.object({
  query: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
  includeLongTerm: z.coerce.boolean().optional().default(true),
});

const DailyParamsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const memoryRoutes: FastifyPluginAsync = async (app) => {
  app.post('/memory/remember', async (request, reply) => {
    const parsed = RememberSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parsed.error.issues,
      });
    }

    try {
      const result = await rememberNote(parsed.data.content, {
        promoteToLongTerm: parsed.data.promoteToLongTerm,
        sessionId: parsed.data.sessionId,
        source: parsed.data.source || 'api.memory.remember',
      });

      return {
        saved: true,
        daily: {
          date: result.daily.date,
          filePath: result.daily.filePath,
        },
        longTerm: result.longTerm
          ? {
            filePath: result.longTerm.filePath,
          }
          : null,
      };
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to save memory',
      });
    }
  });

  app.get('/memory/search', async (request, reply) => {
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid query',
        details: parsed.error.issues,
      });
    }

    try {
      const result = await searchWorkspaceMemory(parsed.data.query, {
        limit: parsed.data.limit,
        includeLongTerm: parsed.data.includeLongTerm,
      });

      return {
        query: result.query,
        count: result.hits.length,
        hits: result.hits,
      };
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to search memory',
      });
    }
  });

  app.get('/memory/daily/:date', async (request, reply) => {
    const parsed = DailyParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid date',
        details: parsed.error.issues,
      });
    }

    try {
      const result = await readDailyMemory(parsed.data.date);
      return {
        date: result.date,
        filePath: result.filePath,
        content: result.content,
      };
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Failed to read memory',
      });
    }
  });
};
