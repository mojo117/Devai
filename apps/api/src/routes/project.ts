import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { getProjectContext, clearProjectCache } from '../scanner/projectScanner.js';
import { listFiles } from '../tools/fs.js';
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

  // List files under the project root
  app.get('/project/files', async (request, reply) => {
    if (!config.projectRoot) {
      return reply.status(400).send({
        error: 'PROJECT_ROOT is not configured',
      });
    }

    const { path } = request.query as { path?: string };
    const targetPath = path && path.trim().length > 0 ? path.trim() : '.';

    try {
      return await listFiles(targetPath);
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to list files',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};
