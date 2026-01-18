import { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const providers = {
      anthropic: !!config.anthropicApiKey,
      openai: !!config.openaiApiKey,
      gemini: !!config.geminiApiKey,
    };

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
      providers,
      projectRoot: config.projectRoot || null,
      allowedRoots: [
        ...(config.projectRoot ? [config.projectRoot] : []),
        ...config.allowedRoots,
      ],
    };
  });
};
