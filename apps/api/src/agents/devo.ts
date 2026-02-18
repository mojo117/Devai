/**
 * DEVO - DevOps Engineer Agent
 *
 * Role: Handles all DevOps tasks including git operations, npm commands,
 * SSH, PM2 management, and GitHub Actions. Can escalate problems back to CHAPO.
 */

import type { AgentDefinition } from './types.js';
import { DEVO_SYSTEM_PROMPT } from '../prompts/devo.js';

export const DEVO_AGENT: AgentDefinition = {
  name: 'devo',
  role: 'DevOps Engineer',
  model: 'claude-sonnet-4-20250514',

  capabilities: {
    canExecuteBash: true,
    canSSH: true,
    canGitCommit: true,
    canGitPush: true,
    canTriggerWorkflows: true,
    canManagePM2: true,
    canDelegateToScout: true,
    canEscalate: true,
  },

  tools: [
    // DevOps tools
    'bash_execute',
    'ssh_execute',
    // Git tools
    'git_status',
    'git_diff',
    'git_commit',
    'git_push',
    'git_pull',
    // GitHub tools
    'github_triggerWorkflow',
    'github_getWorkflowRunStatus',
    // PM2 tools
    'pm2_status',
    'pm2_restart',
    'pm2_logs',
    // NPM tools
    'npm_install',
    'npm_run',
    // Read tools (for context)
    'fs_listFiles',
    'fs_readFile',
    // Logs
    'logs_getStagingLogs',
    // Workspace memory
    'memory_remember',
    'memory_search',
    'memory_readToday',
    // Exploration (spawn SCOUT for searches)
    'delegateToScout',
    // Escalation
    'escalateToChapo',
  ],

  systemPrompt: DEVO_SYSTEM_PROMPT,
};

// Tool definitions for DEVO-specific tools
export const DEVO_META_TOOLS = [
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
          description: 'Relevanter Kontext (Befehle, Fehlermeldungen, Logs)',
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
