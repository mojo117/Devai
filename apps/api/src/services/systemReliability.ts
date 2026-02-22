import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { getLatestHealthWatchdogEvent, getLatestSchedulerFailure } from '../db/schedulerQueries.js';
import { getSupabase, getSupabaseHealthStatus, pingSupabase } from '../db/index.js';
import { getExpiredUserfiles, deleteExpiredUserfiles } from '../db/userfileQueries.js';
import { llmRouter } from '../llm/router.js';
import { isPerplexityConfigured } from '../llm/perplexity.js';
import { runDecay } from '../memory/memoryStore.js';
import { runRecentTopicDecay } from '../memory/recentFocus.js';
import { mcpManager } from '../mcp/index.js';
import { schedulerService } from '../scheduler/schedulerService.js';

const DEFAULT_BACKUP_RETENTION = 14;

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
  return `Memory decay: ${result.decayed} decayed, ${result.pruned} pruned`;
}

export async function recentTopicDecayJob(): Promise<string> {
  const result = await runRecentTopicDecay();
  return `Recent topic decay: ${result.decayed} decayed, ${result.pruned} pruned`;
}

export async function backupLocalDbJob(keepLast: number = DEFAULT_BACKUP_RETENTION): Promise<string> {
  const sourcePath = config.dbPath;
  const dbStats = await stat(sourcePath);
  if (!dbStats.isFile()) {
    throw new Error(`DB path is not a file: ${sourcePath}`);
  }

  const backupDir = resolve(dirname(sourcePath), 'backups');
  await mkdir(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${basename(sourcePath, '.db')}-${timestamp}.db`;
  const destination = join(backupDir, filename);
  await copyFile(sourcePath, destination);

  await pruneOldBackups(backupDir, basename(sourcePath, '.db'), keepLast);
  return `Created DB backup: ${destination}`;
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

async function pruneOldBackups(
  backupDir: string,
  filePrefix: string,
  keepLast: number,
): Promise<void> {
  const files = await readdir(backupDir);
  const candidates: Array<{ name: string; mtimeMs: number }> = [];

  for (const name of files) {
    if (!name.startsWith(`${filePrefix}-`) || !name.endsWith('.db')) continue;
    const fullPath = join(backupDir, name);
    const info = await stat(fullPath);
    candidates.push({ name, mtimeMs: info.mtimeMs });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const toRemove = candidates.slice(Math.max(keepLast, 0));

  for (const file of toRemove) {
    await rm(join(backupDir, file.name), { force: true });
  }
}
