import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { actionRoutes } from './routes/actions.js';
import { projectRoutes } from './routes/project.js';
import { skillsRoutes } from './routes/skills.js';
import { sessionsRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import { memoryRoutes } from './routes/memory.js';
import { externalRoutes } from './routes/external.js';
import { SessionLogger } from './audit/sessionLogger.js';
import { userfilesRoutes } from './routes/userfiles.js';
import { transcribeRoutes } from './routes/transcribe.js';
import { authMiddleware, registerAuthRoutes } from './routes/auth.js';
import { initDb, getSupabase } from './db/index.js';
import { websocketRoutes } from './websocket/routes.js';
import { mcpManager } from './mcp/index.js';
import { registerMcpTools } from './tools/registry.js';
import { registerProjections } from './workflow/projections/index.js';
import { getExpiredUserfiles, deleteExpiredUserfiles } from './db/userfileQueries.js';
import { schedulerService } from './scheduler/schedulerService.js';
import { processRequest } from './agents/router.js';
import { sendTelegramMessage } from './external/telegram.js';
import { getDefaultNotificationChannel } from './db/schedulerQueries.js';

await initDb();

// Register workflow event projections (state → stream → external-output → markdown → audit)
registerProjections();

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
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
});

// Security headers (CSP handled by Caddy + frontend meta tag)
await app.register(helmet, {
  contentSecurityPolicy: false,
});

// Global rate limiting (per IP)
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: '1 minute',
});

// Register WebSocket support
await app.register(fastifyWebsocket);

// Register multipart support for file uploads (10MB limit)
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

// Register cookie parsing (needed for httpOnly auth cookies)
await app.register(cookie);

// Global error handler — sanitize unexpected errors
app.setErrorHandler((error: { statusCode?: number; message: string }, _request, reply) => {
  const statusCode = error.statusCode ?? 500;
  if (statusCode >= 500) {
    app.log.error(error);
    reply.status(statusCode).send({ error: 'Internal server error' });
  } else {
    reply.status(statusCode).send({ error: error.message });
  }
});

// Register auth routes
await registerAuthRoutes(app);

// Protect API routes except health/auth
app.addHook('preHandler', async (request, reply) => {
  const url = request.url || '';
  if (!url.startsWith('/api')) return;
  if (
    url.startsWith('/api/health') ||
    url.startsWith('/api/auth') ||
    url.startsWith('/api/ws') ||
    url.startsWith('/api/telegram')
  ) return;
  await authMiddleware(request, reply);
});

// Register routes
await app.register(healthRoutes, { prefix: '/api' });
await app.register(actionRoutes, { prefix: '/api' });
await app.register(projectRoutes, { prefix: '/api' });
await app.register(skillsRoutes, { prefix: '/api' });
await app.register(sessionsRoutes, { prefix: '/api' });
await app.register(settingsRoutes, { prefix: '/api' });
await app.register(memoryRoutes, { prefix: '/api' });
await app.register(externalRoutes, { prefix: '/api' });
await app.register(websocketRoutes, { prefix: '/api' });
await app.register(userfilesRoutes, { prefix: '/api' });
await app.register(transcribeRoutes, { prefix: '/api' });

// Start server
const start = async () => {
  try {
    SessionLogger.cleanup();
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

    // Initialize scheduler (loads jobs from DB, registers cron schedules)
    schedulerService.configure(
      async (instruction: string, jobId: string) => {
        const sessionId = `scheduler-${jobId}-${Date.now()}`;
        const result = await processRequest(
          sessionId,
          instruction,
          [],
          null,
          () => {},
        );
        return result;
      },
      async (message: string, targetChannel?: string | null) => {
        let chatId = targetChannel ? String(targetChannel) : '';
        if (!chatId) {
          const defaultChannel = await getDefaultNotificationChannel();
          chatId = defaultChannel?.external_chat_id || '';
        }

        if (!chatId) {
          console.warn('[Scheduler] No Telegram target channel configured; skipping notification.');
          return;
        }

        await sendTelegramMessage(chatId, message);
      },
    );
    await schedulerService.start();

    // 30-day userfile cleanup: run on startup + every 24h
    const cleanupExpiredUserfiles = async () => {
      try {
        const expired = await getExpiredUserfiles();
        if (expired.length === 0) return;

        // Remove from Supabase Storage
        const paths = expired.map((f) => f.storage_path);
        const { error: storageError } = await getSupabase()
          .storage
          .from('userfiles')
          .remove(paths);
        if (storageError) {
          console.error('[Cleanup] Storage delete error:', storageError);
        }

        // Remove DB rows
        await deleteExpiredUserfiles(expired.map((f) => f.id));
        console.log(`[Cleanup] Removed ${expired.length} expired userfile(s)`);
      } catch (err) {
        console.error('[Cleanup] Userfile cleanup failed:', err);
      }
    };

    // Run immediately then every 24h
    cleanupExpiredUserfiles();
    setInterval(cleanupExpiredUserfiles, 24 * 60 * 60 * 1000);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down...');
  schedulerService.stop();
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
