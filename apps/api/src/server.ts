import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { chatRoutes } from './routes/chat.js';
import { actionRoutes } from './routes/actions.js';
import { projectRoutes } from './routes/project.js';
import { skillsRoutes } from './routes/skills.js';
import { sessionsRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import { initDb } from './db/index.js';

await initDb();

const app = Fastify({
  logger: {
    level: config.nodeEnv === 'development' ? 'info' : 'warn',
  },
});

// Register CORS for frontend
await app.register(cors, {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

// Register routes
await app.register(healthRoutes, { prefix: '/api' });
await app.register(chatRoutes, { prefix: '/api' });
await app.register(actionRoutes, { prefix: '/api' });
await app.register(projectRoutes, { prefix: '/api' });
await app.register(skillsRoutes, { prefix: '/api' });
await app.register(sessionsRoutes, { prefix: '/api' });
await app.register(settingsRoutes, { prefix: '/api' });

// Start server
const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`DevAI API running on http://localhost:${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);

    // Log configured providers
    const providers = [];
    if (config.anthropicApiKey) providers.push('Anthropic');
    if (config.openaiApiKey) providers.push('OpenAI');
    if (config.geminiApiKey) providers.push('Gemini');
    console.log(`Configured LLM providers: ${providers.length > 0 ? providers.join(', ') : 'None'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
