import { FastifyPluginAsync } from 'fastify';
import { collectSystemHealthSnapshot } from '../services/systemReliability.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_request, reply) => {
    try {
      const snapshot = await collectSystemHealthSnapshot();
      if (snapshot.status === 'degraded') {
        reply.code(503);
      }
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(503);
      return {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        error: message,
      };
    }
  });
};
