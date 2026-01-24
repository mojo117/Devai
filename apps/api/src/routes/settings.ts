import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getSetting, setSetting } from '../db/queries.js';
import {
  getPermissionPatterns,
  addPermissionPattern,
  removePermissionPattern,
  clearPermissionPatterns,
  formatPattern,
} from '../permissions/checker.js';

const UpdateSettingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/settings/:key', async (request) => {
    const { key } = request.params as { key: string };
    const value = await getSetting(key);

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
    try {
      await setSetting(key, JSON.stringify(value));
      return { key, value };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // ============ Permission Pattern Endpoints ============

  // Get all permission patterns
  app.get('/settings/permissions', async () => {
    const patterns = await getPermissionPatterns();
    return {
      patterns,
      formatted: patterns.map(formatPattern),
    };
  });

  // Add a new permission pattern
  const AddPatternSchema = z.object({
    toolName: z.string().min(1),
    argPattern: z.string().optional(),
    granted: z.boolean().optional().default(true),
    expiresAt: z.string().optional(),
    description: z.string().optional(),
  });

  app.post('/settings/permissions', async (request, reply) => {
    const parseResult = AddPatternSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    try {
      const pattern = await addPermissionPattern(parseResult.data);
      return {
        pattern,
        formatted: formatPattern(pattern),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // Remove a permission pattern
  app.delete('/settings/permissions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const removed = await removePermissionPattern(id);
    if (!removed) {
      return reply.status(404).send({ error: 'Pattern not found' });
    }

    return { success: true, id };
  });

  // Clear all permission patterns
  app.delete('/settings/permissions', async () => {
    await clearPermissionPatterns();
    return { success: true };
  });
};
