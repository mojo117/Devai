/**
 * SchedulerService — In-process job scheduler.
 *
 * Loads enabled jobs from Supabase on startup, registers them with croner,
 * and fires commands through the existing execution pipeline.
 *
 * Enhancements:
 * - persistent scheduler execution logs
 * - internal maintenance jobs (cleanup/decay/backup/watchdog)
 * - auto-recovery sweeps for jobs disabled by transient failures
 */
import { createRequire } from 'node:module';
import {
  getEnabledJobs,
  getScheduledJob,
  listScheduledJobs,
  logSchedulerExecution,
  updateScheduledJob,
  type ScheduledJobRow,
  type SchedulerExecutionType,
} from '../db/schedulerQueries.js';

interface CronJob {
  stop(): void;
}

type CronConstructor = new (
  expression: string,
  options: { protect: boolean },
  callback: () => Promise<void>,
) => CronJob;

class DisabledCron implements CronJob {
  constructor(expression: string) {
    console.warn(`[Scheduler] "croner" dependency missing. Cron "${expression}" will not run in this environment.`);
  }

  stop(): void {}
}

function resolveCronConstructor(): CronConstructor {
  try {
    const require = createRequire(import.meta.url);
    const module = require('croner') as { Cron?: CronConstructor; default?: CronConstructor };
    return module.Cron ?? module.default ?? DisabledCron;
  } catch {
    return DisabledCron;
  }
}

const Cron = resolveCronConstructor();

const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_DELAY_MS = 60_000;
const ERROR_RING_BUFFER_SIZE = 20;
const RECOVERY_SCAN_INTERVAL_MS = 10 * 60 * 1000;
const RECOVERY_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_AUTO_RECOVERY_ATTEMPTS = 2;

export interface SchedulerError {
  jobId: string;
  jobName: string;
  error: string;
  timestamp: string;
}

export interface InternalJobDefinition {
  id: string;
  name: string;
  cronExpression: string;
  run: () => Promise<string | void>;
  runOnStart?: boolean;
  notifyOnFailure?: boolean;
}

export interface InternalJobStatus {
  id: string;
  name: string;
  cronExpression: string;
  status: 'active' | 'disabled_by_error';
  lastRunAt: string | null;
  lastResult: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
}

export interface SchedulerHealthSnapshot {
  running: boolean;
  startedAt: string | null;
  activeScheduledJobs: number;
  activeInternalJobs: number;
  recentErrors: SchedulerError[];
  internalJobs: InternalJobStatus[];
  recovery: {
    scanIntervalMs: number;
    cooldownMs: number;
    maxAttempts: number;
    trackedJobs: number;
  };
}

export interface JobExecutor {
  (instruction: string, jobId: string): Promise<string>;
}

export interface NotificationSender {
  (message: string, channel?: string | null): Promise<void>;
}

class SchedulerService {
  private cronJobs = new Map<string, CronJob>();
  private internalCronJobs = new Map<string, CronJob>();
  private internalDefinitions = new Map<string, InternalJobDefinition>();
  private internalStatuses = new Map<string, InternalJobStatus>();
  private recentErrors: SchedulerError[] = [];
  private executor: JobExecutor | null = null;
  private notifier: NotificationSender | null = null;
  private recoveryAttempts = new Map<string, number>();
  private recoveryTimer: NodeJS.Timeout | null = null;
  private recoveryRunning = false;
  private startedAt: string | null = null;
  private running = false;

  /**
   * Wire up the executor and notifier callbacks.
   * Called once during server startup after request processing is ready.
   */
  configure(executor: JobExecutor, notifier: NotificationSender): void {
    this.executor = executor;
    this.notifier = notifier;
  }

  /**
   * Load all enabled DB jobs and start recovery sweeps.
   */
  async start(): Promise<void> {
    if (this.running) return;

    const jobs = await getEnabledJobs();
    console.log(`[Scheduler] Loading ${jobs.length} enabled job(s)`);
    for (const job of jobs) {
      this.registerJob(job);
    }

    this.running = true;
    this.startedAt = new Date().toISOString();
    this.startRecoveryLoop();
  }

  /**
   * Stop all cron jobs. Called during graceful shutdown.
   */
  stop(): void {
    for (const [id, cron] of this.cronJobs) {
      cron.stop();
      this.cronJobs.delete(id);
    }

    for (const [id, cron] of this.internalCronJobs) {
      cron.stop();
      this.internalCronJobs.delete(id);
    }

    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    this.running = false;
    console.log('[Scheduler] All jobs stopped');
  }

  /**
   * Register a single DB-backed job with croner.
   */
  registerJob(job: ScheduledJobRow): void {
    this.unregisterJob(job.id);

    try {
      const cron = new Cron(
        job.cron_expression,
        { protect: true },
        async () => {
          await this.executeJob(job.id);
        },
      );

      this.cronJobs.set(job.id, cron);
      console.log(`[Scheduler] Registered job "${job.name}" (${job.cron_expression})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Invalid cron expression for "${job.name}": ${message}`);
      void this.logExecution({
        jobId: job.id,
        jobName: job.name,
        executionType: 'scheduled',
        phase: 'failure',
        message: `Invalid cron expression: ${message}`,
      });
    }
  }

  /**
   * Register an internal maintenance/watchdog job.
   */
  registerInternalJob(definition: InternalJobDefinition): void {
    this.unregisterInternalJob(definition.id);

    this.internalDefinitions.set(definition.id, definition);
    this.internalStatuses.set(definition.id, {
      id: definition.id,
      name: definition.name,
      cronExpression: definition.cronExpression,
      status: 'active',
      lastRunAt: null,
      lastResult: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
    });

    try {
      const cron = new Cron(
        definition.cronExpression,
        { protect: true },
        async () => {
          await this.executeInternalJob(definition, false);
        },
      );
      this.internalCronJobs.set(definition.id, cron);
      console.log(`[Scheduler] Registered internal job "${definition.name}" (${definition.cronExpression})`);

      if (definition.runOnStart) {
        void this.executeInternalJob(definition, true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Invalid internal job cron for "${definition.name}": ${message}`);
      void this.logExecution({
        jobId: definition.id,
        jobName: definition.name,
        executionType: 'internal',
        phase: 'failure',
        message: `Invalid cron expression: ${message}`,
      });
    }
  }

  /**
   * Unregister a DB-backed job's cron schedule.
   */
  unregisterJob(jobId: string): void {
    const existing = this.cronJobs.get(jobId);
    if (existing) {
      existing.stop();
      this.cronJobs.delete(jobId);
    }
  }

  /**
   * Unregister an internal job.
   */
  unregisterInternalJob(jobId: string): void {
    const existing = this.internalCronJobs.get(jobId);
    if (existing) {
      existing.stop();
      this.internalCronJobs.delete(jobId);
    }
  }

  /**
   * Execute a DB-backed scheduled job. Handles retries and failure tracking.
   */
  private async executeJob(jobId: string): Promise<void> {
    const job = await getScheduledJob(jobId);
    if (!job || !job.enabled || job.status !== 'active') return;

    if (!this.executor) {
      console.error('[Scheduler] No executor configured — skipping job execution');
      return;
    }

    const now = new Date().toISOString();
    console.log(`[Scheduler] Executing job "${job.name}" (${jobId})`);
    await this.logExecution({
      jobId,
      jobName: job.name,
      executionType: 'scheduled',
      phase: 'start',
      message: 'Execution started',
    });

    try {
      const reminderText = job.instruction.trim();
      const reminderMessage = `Erinnerung: ${reminderText || job.name}`;
      const result = job.one_shot
        ? reminderMessage
        : await this.executor(job.instruction, jobId);
      const outboundMessage = job.one_shot
        ? reminderMessage
        : `[${job.name}] ${result}`;

      await updateScheduledJob(jobId, {
        last_run_at: now,
        last_result: result,
        consecutive_failures: 0,
      });
      this.recoveryAttempts.delete(jobId);

      await this.logExecution({
        jobId,
        jobName: job.name,
        executionType: 'scheduled',
        phase: 'success',
        message: 'Execution completed',
        metadata: {
          oneShot: job.one_shot,
          resultPreview: String(result).slice(0, 500),
        },
      });

      if (job.one_shot) {
        await updateScheduledJob(jobId, { enabled: false });
        this.unregisterJob(jobId);
        console.log(`[Scheduler] One-shot job "${job.name}" completed and disabled`);
      }

      if (this.notifier) {
        await this.notifier(
          outboundMessage,
          job.notification_channel,
        ).catch((err) => {
          console.error(`[Scheduler] Failed to send notification for "${job.name}":`, err);
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.handleJobFailure(job, errorMessage, now);
    }
  }

  /**
   * Execute an internal maintenance/watchdog job.
   */
  private async executeInternalJob(definition: InternalJobDefinition, runOnStart: boolean): Promise<void> {
    const status = this.internalStatuses.get(definition.id);
    if (!status || status.status !== 'active') return;

    const attemptKey = `internal:${definition.id}`;
    const now = new Date().toISOString();
    await this.logExecution({
      jobId: definition.id,
      jobName: definition.name,
      executionType: definition.id === 'system-health-watchdog' ? 'watchdog' : 'internal',
      phase: 'start',
      message: runOnStart ? 'Startup execution started' : 'Execution started',
    });

    try {
      const result = await definition.run();
      status.lastRunAt = now;
      status.lastResult = typeof result === 'string' ? result : 'ok';
      status.consecutiveFailures = 0;
      this.internalStatuses.set(definition.id, status);
      this.recoveryAttempts.delete(attemptKey);

      await this.logExecution({
        jobId: definition.id,
        jobName: definition.name,
        executionType: definition.id === 'system-health-watchdog' ? 'watchdog' : 'internal',
        phase: 'success',
        message: runOnStart ? 'Startup execution succeeded' : 'Execution succeeded',
        metadata: {
          resultPreview: status.lastResult?.slice(0, 500) || '',
        },
      });
      return;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      status.consecutiveFailures += 1;
      status.lastErrorAt = now;
      status.lastResult = `ERROR: ${errorMessage}`;
      this.internalStatuses.set(definition.id, status);

      addSchedulerError(definition.name, errorMessage, definition.id);
      await this.logExecution({
        jobId: definition.id,
        jobName: definition.name,
        executionType: definition.id === 'system-health-watchdog' ? 'watchdog' : 'internal',
        phase: 'failure',
        message: `Execution failed (${status.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errorMessage}`,
      });

      if (status.consecutiveFailures === 1) {
        setTimeout(() => {
          void this.executeInternalJob(definition, false);
        }, RETRY_DELAY_MS);
        return;
      }

      if (status.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        status.status = 'disabled_by_error';
        this.internalStatuses.set(definition.id, status);
        this.unregisterInternalJob(definition.id);

        const disableMsg = `Internal job "${definition.name}" disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Last error: ${errorMessage}`;
        await this.logExecution({
          jobId: definition.id,
          jobName: definition.name,
          executionType: definition.id === 'system-health-watchdog' ? 'watchdog' : 'internal',
          phase: 'disabled',
          message: disableMsg,
        });

        if (this.notifier && (definition.notifyOnFailure ?? true)) {
          await this.notifier(disableMsg).catch((notifyErr) => {
            console.error('[Scheduler] Failed to send internal job disable notification:', notifyErr);
          });
        }
      } else if (this.notifier && (definition.notifyOnFailure ?? true)) {
        await this.notifier(
          `Internal job "${definition.name}" failed (${status.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errorMessage}`,
        ).catch((notifyErr) => {
          console.error('[Scheduler] Failed to send internal job failure notification:', notifyErr);
        });
      }
    }
  }

  /**
   * Handle a DB-backed job execution failure. Retry once, then track failures.
   */
  private async handleJobFailure(
    job: ScheduledJobRow,
    errorMessage: string,
    timestamp: string,
  ): Promise<void> {
    const failures = job.consecutive_failures + 1;
    console.error(`[Scheduler] Job "${job.name}" failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${errorMessage}`);

    addSchedulerError(job.name, errorMessage, job.id);

    await this.logExecution({
      jobId: job.id,
      jobName: job.name,
      executionType: 'scheduled',
      phase: 'failure',
      message: `Execution failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${errorMessage}`,
    });

    if (failures === 1) {
      await updateScheduledJob(job.id, {
        consecutive_failures: failures,
        last_error_at: timestamp,
      });

      setTimeout(() => {
        void this.executeJob(job.id);
      }, RETRY_DELAY_MS);
      return;
    }

    await updateScheduledJob(job.id, {
      consecutive_failures: failures,
      last_run_at: timestamp,
      last_result: `ERROR: ${errorMessage}`,
      last_error_at: timestamp,
    });

    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      await updateScheduledJob(job.id, {
        status: 'disabled_by_error',
        enabled: false,
      });
      this.unregisterJob(job.id);

      const disableMsg = `Job "${job.name}" disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Last error: ${errorMessage}. Auto-recovery will retry in ~${RECOVERY_COOLDOWN_MS / 60000} minutes.`;
      console.warn(`[Scheduler] ${disableMsg}`);

      await this.logExecution({
        jobId: job.id,
        jobName: job.name,
        executionType: 'scheduled',
        phase: 'disabled',
        message: disableMsg,
      });

      if (this.notifier) {
        await this.notifier(disableMsg).catch((notifyErr) => {
          console.error('[Scheduler] Failed to send disable notification:', notifyErr);
        });
      }
    } else if (this.notifier) {
      await this.notifier(
        `Job "${job.name}" failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${errorMessage}`,
      ).catch((notifyErr) => {
        console.error('[Scheduler] Failed to send failure notification:', notifyErr);
      });
    }
  }

  /**
   * Track a scheduler error in a ring buffer for system context injection.
   */
  private pushError(error: SchedulerError): void {
    this.recentErrors.push(error);
    if (this.recentErrors.length > ERROR_RING_BUFFER_SIZE) {
      this.recentErrors.shift();
    }
  }

  recordError(error: SchedulerError): void {
    this.pushError(error);
  }

  /**
   * Get recent scheduler errors for CHAPO context injection.
   */
  getRecentErrors(): ReadonlyArray<SchedulerError> {
    return this.recentErrors;
  }

  /**
   * Get count of active DB-backed cron jobs.
   */
  getActiveJobCount(): number {
    return this.cronJobs.size;
  }

  /**
   * Get count of active internal maintenance/watchdog jobs.
   */
  getActiveInternalJobCount(): number {
    return this.internalCronJobs.size;
  }

  /**
   * Check if a specific DB-backed job is registered.
   */
  isJobRegistered(jobId: string): boolean {
    return this.cronJobs.has(jobId);
  }

  /**
   * Internal job statuses for health endpoint and diagnostics.
   */
  getInternalJobStatuses(): ReadonlyArray<InternalJobStatus> {
    return Array.from(this.internalStatuses.values());
  }

  /**
   * Scheduler runtime health snapshot.
   */
  getHealthSnapshot(): SchedulerHealthSnapshot {
    return {
      running: this.running,
      startedAt: this.startedAt,
      activeScheduledJobs: this.cronJobs.size,
      activeInternalJobs: this.internalCronJobs.size,
      recentErrors: [...this.recentErrors],
      internalJobs: Array.from(this.internalStatuses.values()),
      recovery: {
        scanIntervalMs: RECOVERY_SCAN_INTERVAL_MS,
        cooldownMs: RECOVERY_COOLDOWN_MS,
        maxAttempts: MAX_AUTO_RECOVERY_ATTEMPTS,
        trackedJobs: this.recoveryAttempts.size,
      },
    };
  }

  private startRecoveryLoop(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
    }

    this.recoveryTimer = setInterval(() => {
      void this.runRecoverySweep();
    }, RECOVERY_SCAN_INTERVAL_MS);

    void this.runRecoverySweep();
  }

  private async runRecoverySweep(): Promise<void> {
    if (this.recoveryRunning) return;
    this.recoveryRunning = true;

    try {
      await this.recoverDisabledScheduledJobs();
      await this.recoverDisabledInternalJobs();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Scheduler] Recovery sweep failed:', message);
    } finally {
      this.recoveryRunning = false;
    }
  }

  private async recoverDisabledScheduledJobs(): Promise<void> {
    const jobs = await listScheduledJobs();
    const now = Date.now();

    for (const job of jobs) {
      if (job.status !== 'disabled_by_error' || job.enabled) continue;
      if (!job.last_error_at) continue;

      const ageMs = now - new Date(job.last_error_at).getTime();
      if (ageMs < RECOVERY_COOLDOWN_MS) continue;

      const attempts = this.recoveryAttempts.get(job.id) || 0;
      if (attempts >= MAX_AUTO_RECOVERY_ATTEMPTS) continue;

      await updateScheduledJob(job.id, {
        status: 'active',
        enabled: true,
        consecutive_failures: 0,
      });

      const updated = await getScheduledJob(job.id);
      if (updated && updated.enabled && updated.status === 'active') {
        this.registerJob(updated);
        this.recoveryAttempts.set(job.id, attempts + 1);

        const recoveryMessage = `Auto-recovered job "${updated.name}" (attempt ${attempts + 1}/${MAX_AUTO_RECOVERY_ATTEMPTS}).`;
        await this.logExecution({
          jobId: updated.id,
          jobName: updated.name,
          executionType: 'scheduled',
          phase: 'recovered',
          message: recoveryMessage,
        });

        if (this.notifier) {
          await this.notifier(recoveryMessage, updated.notification_channel).catch((notifyErr) => {
            console.error('[Scheduler] Failed to send auto-recovery notification:', notifyErr);
          });
        }
      }
    }
  }

  private async recoverDisabledInternalJobs(): Promise<void> {
    const now = Date.now();
    const statuses = Array.from(this.internalStatuses.values());

    for (const status of statuses) {
      if (status.status !== 'disabled_by_error') continue;
      if (!status.lastErrorAt) continue;

      const ageMs = now - new Date(status.lastErrorAt).getTime();
      if (ageMs < RECOVERY_COOLDOWN_MS) continue;

      const attemptKey = `internal:${status.id}`;
      const attempts = this.recoveryAttempts.get(attemptKey) || 0;
      if (attempts >= MAX_AUTO_RECOVERY_ATTEMPTS) continue;

      const definition = this.internalDefinitions.get(status.id);
      if (!definition) continue;

      this.recoveryAttempts.set(attemptKey, attempts + 1);
      this.registerInternalJob({ ...definition, runOnStart: false });

      const message = `Auto-recovered internal job "${definition.name}" (attempt ${attempts + 1}/${MAX_AUTO_RECOVERY_ATTEMPTS}).`;
      await this.logExecution({
        jobId: definition.id,
        jobName: definition.name,
        executionType: definition.id === 'system-health-watchdog' ? 'watchdog' : 'internal',
        phase: 'recovered',
        message,
      });

      if (this.notifier && (definition.notifyOnFailure ?? true)) {
        await this.notifier(message).catch((notifyErr) => {
          console.error('[Scheduler] Failed to send internal auto-recovery notification:', notifyErr);
        });
      }
    }
  }

  private async logExecution(payload: {
    jobId?: string | null;
    jobName: string;
    executionType: SchedulerExecutionType;
    phase: 'start' | 'success' | 'failure' | 'disabled' | 'recovered' | 'info';
    message?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await logSchedulerExecution({
        jobId: payload.jobId,
        jobName: payload.jobName,
        executionType: payload.executionType,
        phase: payload.phase,
        message: payload.message,
        metadata: payload.metadata,
      });
    } catch (err) {
      console.error('[Scheduler] Failed to log scheduler execution:', err);
    }
  }
}

/** Singleton */
export const schedulerService = new SchedulerService();

export function addSchedulerError(jobName: string, error: string, jobId: string = 'unknown'): void {
  schedulerService.recordError({
    jobId,
    jobName,
    error,
    timestamp: new Date().toISOString(),
  });
}

export function getSchedulerErrors(): ReadonlyArray<SchedulerError> {
  return schedulerService.getRecentErrors();
}
