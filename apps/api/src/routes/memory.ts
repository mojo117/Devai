import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  readDailyMemory,
  rememberNote,
  searchWorkspaceMemory,
} from '../memory/workspaceMemory.js';
import { parseOrReply400 } from './validation.js';

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
    const parsed = parseOrReply400(reply, RememberSchema, request.body);
    if (!parsed) return;

    try {
      const result = await rememberNote(parsed.content, {
        promoteToLongTerm: parsed.promoteToLongTerm,
        sessionId: parsed.sessionId,
        source: parsed.source || 'api.memory.remember',
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
    const parsed = parseOrReply400(reply, SearchQuerySchema, request.query, 'Invalid query');
    if (!parsed) return;

    try {
      const result = await searchWorkspaceMemory(parsed.query, {
        limit: parsed.limit,
        includeLongTerm: parsed.includeLongTerm,
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
    const parsed = parseOrReply400(reply, DailyParamsSchema, request.params, 'Invalid date');
    if (!parsed) return;

    try {
      const result = await readDailyMemory(parsed.date);
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
