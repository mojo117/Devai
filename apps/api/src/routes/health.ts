import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

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

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
      providers,
      projectRoot,
      allowedRoots: [...config.allowedRoots],
    };
  });
};
