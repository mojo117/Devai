/**
 * Scheduler Tools — DEVO tools for managing cron jobs, reminders, and notifications.
 */
import {
  createScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
  deleteScheduledJob,
  getScheduledJob,
} from '../db/schedulerQueries.js';
import { schedulerService } from '../scheduler/schedulerService.js';
import type { ToolExecutionResult } from './executor.js';

export async function schedulerCreate(
  name: string,
  cronExpression: string,
  instruction: string,
  notificationChannel?: string,
): Promise<ToolExecutionResult> {
  try {
    const job = await createScheduledJob({
      name,
      cronExpression,
      instruction,
      notificationChannel,
    });

    // Register with in-process scheduler
    schedulerService.registerJob(job);

    return {
      success: true,
      result: {
        id: job.id,
        name: job.name,
        cronExpression: job.cron_expression,
        instruction: job.instruction,
        message: `Created scheduled job "${name}" with schedule ${cronExpression}`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create scheduled job: ${message}` };
  }
}

export async function schedulerList(): Promise<ToolExecutionResult> {
  try {
    const jobs = await listScheduledJobs();
    const summary = jobs.map((j) => ({
      id: j.id,
      name: j.name,
      cronExpression: j.cron_expression,
      instruction: j.instruction.substring(0, 100) + (j.instruction.length > 100 ? '...' : ''),
      enabled: j.enabled,
      status: j.status,
      oneShot: j.one_shot,
      lastRunAt: j.last_run_at,
      lastResult: j.last_result ? j.last_result.substring(0, 200) : null,
      consecutiveFailures: j.consecutive_failures,
    }));

    return {
      success: true,
      result: {
        count: jobs.length,
        jobs: summary,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to list scheduled jobs: ${message}` };
  }
}

export async function schedulerUpdate(
  id: string,
  updates: {
    name?: string;
    cronExpression?: string;
    instruction?: string;
    notificationChannel?: string | null;
    enabled?: boolean;
  },
): Promise<ToolExecutionResult> {
  try {
    const existing = await getScheduledJob(id);
    if (!existing) {
      return { success: false, error: `Scheduled job "${id}" not found` };
    }

    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.cronExpression !== undefined) dbUpdates.cron_expression = updates.cronExpression;
    if (updates.instruction !== undefined) dbUpdates.instruction = updates.instruction;
    if (updates.notificationChannel !== undefined) dbUpdates.notification_channel = updates.notificationChannel;
    if (updates.enabled !== undefined) {
      dbUpdates.enabled = updates.enabled;
      // Re-enable: reset failure state
      if (updates.enabled && existing.status === 'disabled_by_error') {
        dbUpdates.status = 'active';
        dbUpdates.consecutive_failures = 0;
      }
    }

    await updateScheduledJob(id, dbUpdates);

    // Re-register or unregister based on enabled state
    const updatedJob = await getScheduledJob(id);
    if (updatedJob) {
      if (updatedJob.enabled && updatedJob.status === 'active') {
        schedulerService.registerJob(updatedJob);
      } else {
        schedulerService.unregisterJob(id);
      }
    }

    return {
      success: true,
      result: { message: `Updated scheduled job "${existing.name}"`, id },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to update scheduled job: ${message}` };
  }
}

export async function schedulerDelete(id: string): Promise<ToolExecutionResult> {
  try {
    const existing = await getScheduledJob(id);
    if (!existing) {
      return { success: false, error: `Scheduled job "${id}" not found` };
    }

    schedulerService.unregisterJob(id);
    const deleted = await deleteScheduledJob(id);

    if (!deleted) {
      return { success: false, error: `Failed to delete scheduled job "${id}"` };
    }

    return {
      success: true,
      result: { message: `Deleted scheduled job "${existing.name}"`, id },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to delete scheduled job: ${message}` };
  }
}

export async function reminderCreate(
  message: string,
  datetime: string,
): Promise<ToolExecutionResult> {
  try {
    // Convert datetime to cron expression for a one-shot trigger
    const date = new Date(datetime);
    if (isNaN(date.getTime())) {
      return { success: false, error: `Invalid datetime: ${datetime}` };
    }

    if (date.getTime() <= Date.now()) {
      return { success: false, error: 'Reminder datetime must be in the future' };
    }

    // Cron: minute hour day month *
    const cronExpression = `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;

    const job = await createScheduledJob({
      name: `Reminder: ${message.substring(0, 50)}`,
      cronExpression,
      instruction: message,
      oneShot: true,
    });

    schedulerService.registerJob(job);

    return {
      success: true,
      result: {
        id: job.id,
        message: `Reminder set for ${date.toISOString()}: "${message}"`,
        scheduledFor: date.toISOString(),
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create reminder: ${errMsg}` };
  }
}

export async function notifyUser(
  message: string,
  _channel?: string,
): Promise<ToolExecutionResult> {
  // The actual sending is handled by the notifier callback in schedulerService.
  // This tool is a simple wrapper that DEVO can call.
  try {
    // For now, we log and return success. The actual notification sending
    // will be wired up when Telegram/external messaging is implemented (Phases 5-7).
    console.log(`[notify_user] ${message} (channel: ${_channel || 'default'})`);

    return {
      success: true,
      result: {
        message: 'Notification queued',
        content: message,
        channel: _channel || 'default',
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to send notification: ${errMsg}` };
  }
}
