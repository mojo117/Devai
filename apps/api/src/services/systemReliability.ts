import { getLatestHealthWatchdogEvent, getLatestSchedulerFailure } from '../db/schedulerQueries.js';
import { config } from '../config.js';
import { getSupabase, getSupabaseHealthStatus, pingSupabase } from '../db/index.js';
import { getExpiredUserfiles, deleteExpiredUserfiles } from '../db/userfileQueries.js';
import { llmRouter } from '../llm/router.js';
import { isPerplexityConfigured } from '../llm/perplexity.js';
import { runDecay } from '../memory/memoryStore.js';
import { runRecentTopicDecay } from '../memory/recentFocus.js';
import { renderMemoryMd } from '../memory/renderMemoryMd.js';
import { mcpManager } from '../mcp/index.js';
import { schedulerService } from '../scheduler/schedulerService.js';

export interface SystemHealthSnapshot {
  status: 'ok' | 'degraded';
  timestamp: string;
  environment: string;
  apis: {
    anthropic: boolean;
    openai: boolean;
    gemini: boolean;
    zai: boolean;
    perplexity: boolean;
  };
  llm: {
    configuredProviders: string[];
  };
  process: {
    pid: number;
    uptimeSeconds: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    };
  };
  dependencies: {
    supabase: {
      ok: boolean;
      checkedAt: string;
      latencyMs: number | null;
      error: string | null;
      storageOk: boolean | null;
      storageError: string | null;
      runtime: ReturnType<typeof getSupabaseHealthStatus>;
    };
    scheduler: ReturnType<typeof schedulerService.getHealthSnapshot>;
    mcp: ReturnType<typeof mcpManager.getStatus>;
  };
  latestEvents: {
    schedulerFailureAt: string | null;
    schedulerFailure: string | null;
    watchdogAt: string | null;
    watchdogPhase: string | null;
  };
  projectRoot: string;
  allowedRoots: string[];
}

export async function collectSystemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  const timestamp = new Date().toISOString();
  const configuredProviders = llmRouter.getConfiguredProviders();
  const scheduler = schedulerService.getHealthSnapshot();
  const mcp = mcpManager.getStatus();
  const supabase = await pingSupabase({ includeStorage: true, timeoutMs: 2500 });
  const supabaseRuntime = getSupabaseHealthStatus();
  const latestSchedulerFailure = await getLatestSchedulerFailure();
  const latestWatchdogEvent = await getLatestHealthWatchdogEvent();

  const degraded =
    !supabase.ok ||
    configuredProviders.length === 0 ||
    !scheduler.running;

  const projectRoot = config.allowedRoots[0] || '/opt/Klyde/projects/DeviSpace';
  const memory = process.memoryUsage();

  return {
    status: degraded ? 'degraded' : 'ok',
    timestamp,
    environment: config.nodeEnv,
    apis: {
      anthropic: !!config.anthropicApiKey,
      openai: !!config.openaiApiKey,
      gemini: !!config.geminiApiKey,
      zai: !!config.zaiApiKey,
      perplexity: isPerplexityConfigured(),
    },
    llm: {
      configuredProviders,
    },
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
    },
    dependencies: {
      supabase: {
        ok: supabase.ok,
        checkedAt: supabase.checkedAt,
        latencyMs: supabase.latencyMs,
        error: supabase.error,
        storageOk: supabase.storageOk,
        storageError: supabase.storageError,
        runtime: supabaseRuntime,
      },
      scheduler,
      mcp,
    },
    latestEvents: {
      schedulerFailureAt: latestSchedulerFailure?.created_at || null,
      schedulerFailure: latestSchedulerFailure?.message || null,
      watchdogAt: latestWatchdogEvent?.created_at || null,
      watchdogPhase: latestWatchdogEvent?.phase || null,
    },
    projectRoot,
    allowedRoots: [...config.allowedRoots],
  };
}

export async function cleanupExpiredUserfilesJob(): Promise<string> {
  const expired = await getExpiredUserfiles();
  if (expired.length === 0) {
    return 'No expired userfiles';
  }

  const paths = expired.map((f) => f.storage_path);
  const { error: storageError } = await getSupabase()
    .storage
    .from('userfiles')
    .remove(paths);

  if (storageError) {
    throw new Error(`Storage delete failed: ${storageError.message}`);
  }

  await deleteExpiredUserfiles(expired.map((f) => f.id));
  return `Removed ${expired.length} expired userfile(s)`;
}

export async function memoryDecayJob(): Promise<string> {
  const result = await runDecay();
  // Re-render memory.md — strength changes affect ordering/inclusion
  await renderMemoryMd();
  return `Memory decay: ${result.decayed} decayed, ${result.pruned} pruned`;
}

export async function recentTopicDecayJob(): Promise<string> {
  const result = await runRecentTopicDecay();
  return `Recent topic decay: ${result.decayed} decayed, ${result.pruned} pruned`;
}

export function formatHealthAlert(snapshot: SystemHealthSnapshot): string {
  const lines = [
    `System health is ${snapshot.status.toUpperCase()} at ${snapshot.timestamp}`,
    `Supabase: ${snapshot.dependencies.supabase.ok ? 'ok' : `down (${snapshot.dependencies.supabase.error || 'unknown'})`}`,
    `Scheduler: ${snapshot.dependencies.scheduler.running ? 'running' : 'stopped'} (scheduled=${snapshot.dependencies.scheduler.activeScheduledJobs}, internal=${snapshot.dependencies.scheduler.activeInternalJobs})`,
    `LLM providers: ${snapshot.llm.configuredProviders.length > 0 ? snapshot.llm.configuredProviders.join(', ') : 'none configured'}`,
  ];
  return lines.join('\n');
}
