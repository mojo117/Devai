import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { mcpManager } from '../mcp/index.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const providers = {
      anthropic: !!config.anthropicApiKey,
      openai: !!config.openaiApiKey,
      gemini: !!config.geminiApiKey,
    };

    // Default project root - always use the canonical Klyde path
    // The fs tools will handle path mapping if running on Baso
    const projectRoot = '/opt/Klyde/projects';

    // Get MCP server status
    const mcp = mcpManager.getStatus();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
      providers,
      mcp,
      projectRoot,
      allowedRoots: [...config.allowedRoots],
    };
  });
};
