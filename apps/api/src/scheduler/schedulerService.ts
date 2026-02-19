/**
 * SchedulerService — In-process job scheduler.
 *
 * Loads enabled jobs from Supabase on startup, registers them with croner,
 * and fires commands through the existing CommandDispatcher pipeline.
 * Handles retries, auto-disable after 3 consecutive failures, and
 * notification on errors.
 */
import { Cron } from 'croner';
import {
  getEnabledJobs,
  getScheduledJob,
  updateScheduledJob,
  type ScheduledJobRow,
} from '../db/schedulerQueries.js';

const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_DELAY_MS = 60_000;
const ERROR_RING_BUFFER_SIZE = 20;

export interface SchedulerError {
  jobId: string;
  jobName: string;
  error: string;
  timestamp: string;
}

export interface JobExecutor {
  (instruction: string, jobId: string): Promise<string>;
}

export interface NotificationSender {
  (message: string, channel?: string | null): Promise<void>;
}

class SchedulerService {
  private cronJobs = new Map<string, Cron>();
  private recentErrors: SchedulerError[] = [];
  private executor: JobExecutor | null = null;
  private notifier: NotificationSender | null = null;

  /**
   * Wire up the executor and notifier callbacks.
   * Called once during server startup after CommandDispatcher is ready.
   */
  configure(executor: JobExecutor, notifier: NotificationSender): void {
    this.executor = executor;
    this.notifier = notifier;
  }

  /**
   * Load all enabled jobs from DB and register cron schedules.
   */
  async start(): Promise<void> {
    const jobs = await getEnabledJobs();
    console.log(`[Scheduler] Loading ${jobs.length} enabled job(s)`);

    for (const job of jobs) {
      this.registerJob(job);
    }
  }

  /**
   * Stop all cron jobs. Called during graceful shutdown.
   */
  stop(): void {
    for (const [id, cron] of this.cronJobs) {
      cron.stop();
      this.cronJobs.delete(id);
    }
    console.log('[Scheduler] All jobs stopped');
  }

  /**
   * Register a single job with croner.
   */
  registerJob(job: ScheduledJobRow): void {
    // Stop existing cron if re-registering
    this.unregisterJob(job.id);

    try {
      const cron = new Cron(job.cron_expression, async () => {
        await this.executeJob(job.id);
      });

      this.cronJobs.set(job.id, cron);
      console.log(`[Scheduler] Registered job "${job.name}" (${job.cron_expression})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Invalid cron expression for "${job.name}": ${message}`);
    }
  }

  /**
   * Unregister a job's cron schedule.
   */
  unregisterJob(jobId: string): void {
    const existing = this.cronJobs.get(jobId);
    if (existing) {
      existing.stop();
      this.cronJobs.delete(jobId);
    }
  }

  /**
   * Execute a scheduled job. Handles retries and failure tracking.
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

    try {
      const result = await this.executor(job.instruction, jobId);

      // Success — reset failure counter
      await updateScheduledJob(jobId, {
        last_run_at: now,
        last_result: result,
        consecutive_failures: 0,
      });

      // One-shot: disable after successful execution
      if (job.one_shot) {
        await updateScheduledJob(jobId, { enabled: false });
        this.unregisterJob(jobId);
        console.log(`[Scheduler] One-shot job "${job.name}" completed and disabled`);
      }

      // Send result to notification channel if configured
      if (this.notifier && job.notification_channel) {
        await this.notifier(
          `[${job.name}] ${result}`,
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
   * Handle a job execution failure. Retry once, then track consecutive failures.
   */
  private async handleJobFailure(
    job: ScheduledJobRow,
    errorMessage: string,
    timestamp: string,
  ): Promise<void> {
    const failures = job.consecutive_failures + 1;
    console.error(`[Scheduler] Job "${job.name}" failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${errorMessage}`);

    // Track error in ring buffer
    this.pushError({
      jobId: job.id,
      jobName: job.name,
      error: errorMessage,
      timestamp,
    });

    // Retry once after delay
    if (failures === 1) {
      console.log(`[Scheduler] Retrying "${job.name}" in ${RETRY_DELAY_MS / 1000}s...`);
      await updateScheduledJob(job.id, {
        consecutive_failures: failures,
        last_error_at: timestamp,
      });

      setTimeout(async () => {
        await this.executeJob(job.id);
      }, RETRY_DELAY_MS);
      return;
    }

    // Update failure count
    await updateScheduledJob(job.id, {
      consecutive_failures: failures,
      last_run_at: timestamp,
      last_result: `ERROR: ${errorMessage}`,
      last_error_at: timestamp,
    });

    // Auto-disable after max consecutive failures
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      await updateScheduledJob(job.id, {
        status: 'disabled_by_error',
        enabled: false,
      });
      this.unregisterJob(job.id);

      const disableMsg = `Job "${job.name}" disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Last error: ${errorMessage}. Re-enable when ready.`;
      console.warn(`[Scheduler] ${disableMsg}`);

      // Always notify on auto-disable
      if (this.notifier) {
        await this.notifier(disableMsg).catch((notifyErr) => {
          console.error('[Scheduler] Failed to send disable notification:', notifyErr);
        });
      }
    } else {
      // Notify on individual failure
      if (this.notifier) {
        await this.notifier(
          `Job "${job.name}" failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${errorMessage}`,
        ).catch((notifyErr) => {
          console.error('[Scheduler] Failed to send failure notification:', notifyErr);
        });
      }
    }
  }

  /**
   * Push an error to the ring buffer (keeps last N errors).
   */
  private pushError(error: SchedulerError): void {
    this.recentErrors.push(error);
    if (this.recentErrors.length > ERROR_RING_BUFFER_SIZE) {
      this.recentErrors.shift();
    }
  }

  /**
   * Get recent scheduler errors for CHAPO context injection.
   */
  getRecentErrors(): ReadonlyArray<SchedulerError> {
    return this.recentErrors;
  }

  /**
   * Get count of active cron jobs.
   */
  getActiveJobCount(): number {
    return this.cronJobs.size;
  }

  /**
   * Check if a specific job is registered.
   */
  isJobRegistered(jobId: string): boolean {
    return this.cronJobs.has(jobId);
  }
}

/** Singleton */
export const schedulerService = new SchedulerService();
