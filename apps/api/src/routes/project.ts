import { FastifyPluginAsync } from 'fastify';
import { resolve } from 'path';
import { config } from '../config.js';
import { getProjectContext, clearProjectCache } from '../scanner/projectScanner.js';
import { listFiles, readFile, grepFiles } from '../tools/fs.js';
import type { ProjectContext } from '@devai/shared';

// Validate that a path is within allowed roots
function validateProjectPath(path: string): string {
  const normalizedPath = resolve(path);

  for (const root of config.allowedRoots) {
    const absoluteRoot = resolve(root);
    if (normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot) {
      return normalizedPath;
    }
  }

  throw new Error(`Access denied: Path must be within ${config.allowedRoots.join(' or ')}`);
}

export const projectRoutes: FastifyPluginAsync = async (app) => {
  // Get project information
  app.get('/project', async (request, reply) => {
    const { path: projectPath } = request.query as { path?: string };

    if (!projectPath) {
      return reply.status(400).send({
        error: 'Project path is required. Allowed roots: ' + config.allowedRoots.join(', '),
      });
    }

    try {
      const validatedPath = validateProjectPath(projectPath);
      const context = await getProjectContext(validatedPath);
      return {
        projectRoot: validatedPath,
        context,
      };
    } catch (error) {
      const status = error instanceof Error && error.message.includes('Access denied') ? 403 : 500;
      return reply.status(status).send({
        error: 'Failed to scan project',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Refresh project information (clear cache)
  app.post('/project/refresh', async (request, reply) => {
    const { path: projectPath } = request.query as { path?: string };

    if (!projectPath) {
      return reply.status(400).send({
        error: 'Project path is required. Allowed roots: ' + config.allowedRoots.join(', '),
      });
    }

    clearProjectCache();

    try {
      const validatedPath = validateProjectPath(projectPath);
      const context = await getProjectContext(validatedPath);
      return {
        projectRoot: validatedPath,
        context,
        refreshed: true,
      };
    } catch (error) {
      const status = error instanceof Error && error.message.includes('Access denied') ? 403 : 500;
      return reply.status(status).send({
        error: 'Failed to scan project',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // List files under a path (must be within allowed roots)
  app.get('/project/files', async (request, reply) => {
    const { path } = request.query as { path?: string };

    if (!path || path.trim().length === 0) {
      return reply.status(400).send({
        error: 'Path is required. Allowed roots: ' + config.allowedRoots.join(', '),
      });
    }

    try {
      return await listFiles(path.trim());
    } catch (error) {
      const status = error instanceof Error && error.message.includes('Access denied') ? 403 : 400;
      return reply.status(status).send({
        error: 'Failed to list files',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Read file contents (must be within allowed roots)
  app.get('/project/file', async (request, reply) => {
    const { path } = request.query as { path?: string };

    if (!path || path.trim().length === 0) {
      return reply.status(400).send({
        error: 'Path is required. Allowed roots: ' + config.allowedRoots.join(', '),
      });
    }

    try {
      return await readFile(path.trim());
    } catch (error) {
      const status = error instanceof Error && error.message.includes('Access denied') ? 403 : 400;
      return reply.status(status).send({
        error: 'Failed to read file',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Search for text within project files (must be within allowed roots)
  app.get('/project/search', async (request, reply) => {
    const { path, pattern, glob } = request.query as { path?: string; pattern?: string; glob?: string };

    if (!pattern || pattern.trim().length === 0) {
      return reply.status(400).send({
        error: 'Search pattern is required.',
      });
    }

    const searchPath = path && path.trim().length > 0 ? path.trim() : config.allowedRoots[0];

    try {
      return await grepFiles(pattern.trim(), searchPath, glob?.trim() || undefined);
    } catch (error) {
      const status = error instanceof Error && error.message.includes('Access denied') ? 403 : 400;
      return reply.status(status).send({
        error: 'Failed to search files',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};
