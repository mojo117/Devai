import type { ToolDefinition } from '../registry.js';

export const schedulerTools: ToolDefinition[] = [
  {
    name: 'scheduler_create',
    description: 'Create a scheduled job (cron). Runs an instruction on a recurring schedule. Cron times are in UTC (e.g. "0 7 * * *" = 8am Berlin in winter/CET).',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable job name (e.g. "Morning PM2 health check")',
        },
        cronExpression: {
          type: 'string',
          description: 'Cron schedule expression (e.g. "0 8 * * *" for daily at 8am, "*/30 * * * *" for every 30 min)',
        },
        instruction: {
          type: 'string',
          description: 'Natural language instruction for what to do when the job fires (executed by CHAPO)',
        },
        notificationChannel: {
          type: 'string',
          description: 'Optional notification channel override (default: use global setting)',
        },
      },
      required: ['name', 'cronExpression', 'instruction'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'scheduler_list',
    description: 'List all scheduled jobs with their status, schedule, and last run info.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: 'scheduler_update',
    description: 'Update a scheduled job (change name, schedule, instruction, or enable/disable).',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The job ID to update',
        },
        name: {
          type: 'string',
          description: 'New job name',
        },
        cronExpression: {
          type: 'string',
          description: 'New cron schedule expression',
        },
        instruction: {
          type: 'string',
          description: 'New instruction',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the job',
        },
      },
      required: ['id'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'scheduler_delete',
    description: 'Delete a scheduled job permanently.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The job ID to delete',
        },
      },
      required: ['id'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'reminder_create',
    description: 'Create a one-time reminder. Fires at the specified datetime and auto-deletes.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The reminder message to send',
        },
        datetime: {
          type: 'string',
          description: 'ISO 8601 datetime in UTC with Z suffix (e.g. "2026-02-20T09:00:00Z"). Convert from Berlin time by subtracting the timezone offset.',
        },
        notificationChannel: {
          type: 'string',
          description: 'Optional channel override (Telegram chat ID). If omitted, default notification channel is used.',
        },
      },
      required: ['message', 'datetime'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'notify_user',
    description: 'Send a notification to the user on their default notification channel (Telegram, etc.).',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The notification message to send',
        },
        channel: {
          type: 'string',
          description: 'Optional: specific channel to use instead of default',
        },
      },
      required: ['message'],
    },
    requiresConfirmation: false,
  },
];
