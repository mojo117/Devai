import { FastifyPluginAsync } from 'fastify';
import { resolve } from 'path';
import { config } from '../config.js';
import { getProjectContext, clearProjectCache } from '../scanner/projectScanner.js';
import { listFiles, readFile, grepFiles, globFiles } from '../tools/fs.js';
import fg from 'fast-glob';
import * as minimatchPkg from 'minimatch';
import type { ProjectContext } from '@devai/shared';

const minimatch = ((minimatchPkg as unknown as { minimatch?: unknown; default?: unknown }).minimatch
  ?? (minimatchPkg as unknown as { default?: unknown }).default) as (
  path: string,
  pattern: string,
) => boolean;

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
    const { path, ignore } = request.query as { path?: string; ignore?: string };

    if (!path || path.trim().length === 0) {
      return reply.status(400).send({
        error: 'Path is required. Allowed roots: ' + config.allowedRoots.join(', '),
      });
    }

    try {
      const result = await listFiles(path.trim());
      const ignorePatterns = parseIgnore(ignore);
      if (ignorePatterns.length === 0) return result;
      const filtered = result.files.filter((entry) => {
        const baseName = entry.name;
        const relativePath = path.trim() === '.' ? entry.name : `${path.trim()}/${entry.name}`;
        if (ignorePatterns.some(p => minimatch(baseName, p))) return false;
        if (ignorePatterns.some(p => minimatch(relativePath, p))) return false;
        if (entry.type === 'directory') {
          if (ignorePatterns.some(p => minimatch(`${baseName}/**`, p))) return false;
          if (ignorePatterns.some(p => minimatch(`${relativePath}/**`, p))) return false;
        }
        return true;
      });
      return { ...result, files: filtered };
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
    const { path, pattern, glob, ignore } = request.query as { path?: string; pattern?: string; glob?: string; ignore?: string };

    if (!pattern || pattern.trim().length === 0) {
      return reply.status(400).send({
        error: 'Search pattern is required.',
      });
    }

    const searchPath = path && path.trim().length > 0 ? path.trim() : config.allowedRoots[0];

    try {
      return await grepFiles(pattern.trim(), searchPath, glob?.trim() || undefined, parseIgnore(ignore));
    } catch (error) {
      const status = error instanceof Error && error.message.includes('Access denied') ? 403 : 400;
      return reply.status(status).send({
        error: 'Failed to search files',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Find files matching a glob pattern (must be within allowed roots)
  app.get('/project/glob', async (request, reply) => {
    const { path, pattern, ignore } = request.query as { path?: string; pattern?: string; ignore?: string };

    if (!pattern || pattern.trim().length === 0) {
      return reply.status(400).send({
        error: 'Glob pattern is required.',
      });
    }

    const basePath = path && path.trim().length > 0 ? path.trim() : undefined;

    try {
      return await globFiles(pattern.trim(), basePath, parseIgnore(ignore));
    } catch (error) {
      const status = error instanceof Error && error.message.includes('Access denied') ? 403 : 400;
      return reply.status(status).send({
        error: 'Failed to glob files',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};

function parseIgnore(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
