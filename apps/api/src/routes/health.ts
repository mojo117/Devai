import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { mcpManager } from '../mcp/index.js';
import { isPerplexityConfigured } from '../llm/perplexity.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const apis = {
      anthropic: !!config.anthropicApiKey,
      openai: !!config.openaiApiKey,
      gemini: !!config.geminiApiKey,
      perplexity: isPerplexityConfigured(),
    };

    // Default project root (canonical). Runtime mounts are handled by the fs tools/scanner.
    const projectRoot = config.allowedRoots[0] || '/opt/Klyde/projects/DeviSpace';

    // Get MCP server status
    const mcp = mcpManager.getStatus();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
      apis,
      mcp,
      projectRoot,
      allowedRoots: [...config.allowedRoots],
    };
  });
};
