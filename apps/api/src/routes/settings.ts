import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getSetting, setSetting } from '../db/queries.js';

const UpdateSettingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/settings/:key', async (request) => {
    const { key } = request.params as { key: string };
    const value = getSetting(key);

    if (value === null) {
      return { key, value: null };
    }

    return { key, value: JSON.parse(value) };
  });

  app.post('/settings', async (request, reply) => {
    const parseResult = UpdateSettingSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const { key, value } = parseResult.data;
    setSetting(key, JSON.stringify(value));
    return { key, value };
  });
};
