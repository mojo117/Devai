import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { chatRoutes } from './routes/chat.js';
import { actionRoutes } from './routes/actions.js';
import { projectRoutes } from './routes/project.js';
import { skillsRoutes } from './routes/skills.js';
import { sessionsRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import { looperRoutes } from './routes/looper.js';
import { authMiddleware, registerAuthRoutes } from './routes/auth.js';
import { initDb } from './db/index.js';
import { websocketRoutes } from './websocket/routes.js';
import { mcpManager } from './mcp/index.js';
import { registerMcpTools } from './tools/registry.js';

await initDb();

const app = Fastify({
  logger: {
    level: config.nodeEnv === 'development' ? 'info' : 'warn',
  },
});

const corsOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3008',
  'http://127.0.0.1:3008',
  'http://localhost:8090',
  'http://127.0.0.1:8090',
].filter(Boolean);

// Register CORS for frontend
await app.register(cors, {
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

// Global rate limiting (per IP)
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: '1 minute',
});

// Register WebSocket support
await app.register(fastifyWebsocket);

// Register auth routes
await registerAuthRoutes(app);

// Protect API routes except health/auth
app.addHook('preHandler', async (request, reply) => {
  const url = request.url || '';
  if (!url.startsWith('/api')) return;
  if (url.startsWith('/api/health') || url.startsWith('/api/auth') || url.startsWith('/api/ws')) return;
  await authMiddleware(request, reply);
});

// Register routes
await app.register(healthRoutes, { prefix: '/api' });
await app.register(chatRoutes, { prefix: '/api' });
await app.register(actionRoutes, { prefix: '/api' });
await app.register(projectRoutes, { prefix: '/api' });
await app.register(skillsRoutes, { prefix: '/api' });
await app.register(sessionsRoutes, { prefix: '/api' });
await app.register(settingsRoutes, { prefix: '/api' });
await app.register(looperRoutes, { prefix: '/api' });
await app.register(websocketRoutes, { prefix: '/api' });

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

    // Initialize MCP servers asynchronously so the API starts quickly even if MCP servers are slow.
    // This avoids long startup delays (e.g. Serena scanning large project trees).
    const mcpInitPromise = (async () => {
      try {
        await mcpManager.initialize();
        const mcpTools = mcpManager.getToolDefinitions();
        if (mcpTools.length > 0) {
          registerMcpTools(mcpTools);
        }
        console.log(`MCP tools: ${mcpTools.length > 0 ? mcpTools.map((t) => t.name).join(', ') : 'None'}`);
      } catch (err) {
        app.log.error({ err }, 'Failed to initialize MCP (continuing without MCP tools)');
      }
    })();

    // Ensure shutdown waits for init to settle before trying to tear down MCP.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (app as any).mcpInitPromise = mcpInitPromise;
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  const mcpInitPromise = (app as any).mcpInitPromise as Promise<void> | undefined;
  if (mcpInitPromise) {
    try { await mcpInitPromise; } catch { /* ignore */ }
  }
  await mcpManager.shutdown();
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
