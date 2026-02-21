/**
 * CAIO - Communications & Administration Officer Agent
 *
 * Role: Handles TaskForge ticket management, email, scheduling, reminders,
 * and notifications. Read-only filesystem access for context gathering.
 * Can delegate research to SCOUT and escalate to CHAPO.
 */

import type { AgentDefinition } from './types.js';
import { CAIO_SYSTEM_PROMPT } from '../prompts/caio.js';
import { registerMetaTools, registerAgentTools } from '../tools/registry.js';

export const CAIO_AGENT: AgentDefinition = {
  name: 'caio',
  role: 'Communications & Administration Officer',
  model: 'glm-4.5-air', // ZAI GLM-4.5-Air - admin tasks don't need heavy models
  fallbackModel: 'claude-sonnet-4-20250514',

  capabilities: {
    readOnly: true,
    canManageScheduler: true,
    canSendNotifications: true,
    canSendEmail: true,
    canManageTaskForge: true,
    canDelegateToScout: true,
    canEscalate: true,
  },

  tools: [
    // Read-only file system (context gathering)
    'fs_readFile',
    'fs_listFiles',
    'fs_glob',
    // TaskForge tools
    'taskforge_list_tasks',
    'taskforge_get_task',
    'taskforge_create_task',
    'taskforge_move_task',
    'taskforge_add_comment',
    'taskforge_search',
    // Scheduler tools
    'scheduler_create',
    'scheduler_list',
    'scheduler_update',
    'scheduler_delete',
    'reminder_create',
    // Notification & Email
    'notify_user',
    'send_email',
    // Telegram document sending
    'telegram_send_document',
    // Web document delivery
    'deliver_document',
    // Workspace memory
    'memory_remember',
    'memory_search',
    'memory_readToday',
    // Exploration (spawn SCOUT for searches)
    'delegateToScout',
    // Escalation
    'escalateToChapo',
  ],

  systemPrompt: CAIO_SYSTEM_PROMPT,
};

// Meta tools specific to CAIO (escalation)
export const CAIO_META_TOOLS = [
  {
    name: 'escalateToChapo',
    description: 'Eskaliere ein Problem an CHAPO. Nutze dies wenn du auf ein Problem stößt das du nicht lösen kannst.',
    parameters: {
      type: 'object',
      properties: {
        issueType: {
          type: 'string',
          enum: ['error', 'clarification', 'blocker'],
          description: 'Art des Problems: error (Fehler), clarification (Unklarheit), blocker (Blockiert)',
        },
        description: {
          type: 'string',
          description: 'Beschreibung des Problems',
        },
        context: {
          type: 'object',
          description: 'Relevanter Kontext (Fehlermeldungen, Status, etc.)',
        },
        suggestedSolutions: {
          type: 'array',
          description: 'Deine Lösungsvorschläge (optional)',
        },
      },
      required: ['issueType', 'description'],
    },
    requiresConfirmation: false,
  },
];

// Register CAIO's meta-tools and agent access in the unified registry
registerMetaTools(CAIO_META_TOOLS, 'caio');
registerAgentTools('caio', CAIO_AGENT.tools);
