import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { getProjectContext, clearProjectCache } from '../scanner/projectScanner.js';
import type { ProjectContext } from '@devai/shared';

export const projectRoutes: FastifyPluginAsync = async (app) => {
  // Get project information
  app.get('/project', async (request, reply) => {
    if (!config.projectRoot) {
      return reply.status(400).send({
        error: 'PROJECT_ROOT is not configured',
      });
    }

    try {
      const context = await getProjectContext(config.projectRoot);
      return {
        projectRoot: config.projectRoot,
        context,
      };
    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to scan project',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Refresh project information (clear cache)
  app.post('/project/refresh', async (request, reply) => {
    if (!config.projectRoot) {
      return reply.status(400).send({
        error: 'PROJECT_ROOT is not configured',
      });
    }

    clearProjectCache();

    try {
      const context = await getProjectContext(config.projectRoot);
      return {
        projectRoot: config.projectRoot,
        context,
        refreshed: true,
      };
    } catch (error) {
      return reply.status(500).send({
        error: 'Failed to scan project',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};
