/**
 * CHAPO - Task Coordinator Agent
 *
 * Role: Analyzes incoming requests, gathers context, qualifies tasks,
 * and delegates to DEVO or SCOUT. Has read-only access to the codebase.
 */

import type { AgentDefinition } from './types.js';
import { CHAPO_SYSTEM_PROMPT } from '../prompts/chapo.js';
import { registerMetaTools, registerAgentTools } from '../tools/registry.js';

export const CHAPO_AGENT: AgentDefinition = {
  name: 'chapo',
  role: 'Task Coordinator',
  model: 'claude-opus-4-5-20251101', // Claude Opus 4.5 - most capable
  fallbackModel: 'claude-sonnet-4-20250514', // Fallback if Opus unavailable

  capabilities: {
    readOnly: true,
    canDelegateToDevo: true,
    canDelegateToScout: true,
    canAskUser: true,
    canRequestApproval: true,
  },

  tools: [
    // Read-only file system tools
    'fs_listFiles',
    'fs_readFile',
    'fs_glob',
    'fs_grep',
    // Git status (read-only)
    'git_status',
    'git_diff',
    // GitHub (read-only)
    'github_getWorkflowRunStatus',
    // Logs
    'logs_getStagingLogs',
    // Workspace memory
    'memory_remember',
    'memory_search',
    'memory_readToday',
    // Meta-tools for coordination
    'delegateToDevo',
    'delegateToScout',
    'askUser',
    'requestApproval',
  ],

  systemPrompt: CHAPO_SYSTEM_PROMPT,
};

// Tool definitions for CHAPO-specific meta-tools
export const CHAPO_META_TOOLS = [
  {
    name: 'delegateToDevo',
    description: 'Delegiere Code- und DevOps-Arbeit an DEVO (Developer & DevOps Engineer). Nutze dies für: Dateien erstellen/bearbeiten/löschen, Code refactoring, neue Features implementieren, Git operations, npm commands, SSH, PM2, GitHub Actions.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Beschreibung der Aufgabe für DEVO',
        },
        context: {
          type: 'object',
          description: 'Gesammelter Kontext (Server-Info, Git-Status)',
        },
        commands: {
          type: 'array',
          description: 'Vorgeschlagene Befehle (optional)',
        },
        constraints: {
          type: 'array',
          description: 'Einschränkungen oder besondere Anweisungen',
        },
      },
      required: ['task'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'delegateToScout',
    description: 'Delegiere Exploration/Recherche an SCOUT. Nutze dies für: Codebase durchsuchen, Web-Recherche, Dokumentation finden, Muster erkennen.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Was soll SCOUT suchen/erforschen?',
        },
        scope: {
          type: 'string',
          enum: ['codebase', 'web', 'both'],
          description: 'Wo soll gesucht werden? (default: both)',
        },
        context: {
          type: 'string',
          description: 'Zusätzlicher Kontext für die Suche (optional)',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'askUser',
    description: 'Stelle dem User eine Frage bei Unklarheiten. Nutze dies BEVOR du Freigabe einholst.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Die Frage an den User',
        },
        options: {
          type: 'array',
          description: 'Mögliche Antworten (optional)',
        },
        context: {
          type: 'string',
          description: 'Zusätzlicher Kontext für den User',
        },
      },
      required: ['question'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'requestApproval',
    description: 'Fordere Freigabe vom User für einen riskanten Task. Nutze dies bei medium/high Risiko.',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Beschreibung was getan werden soll',
        },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Risiko-Level des Tasks',
        },
        actions: {
          type: 'array',
          description: 'Liste der geplanten Aktionen',
        },
      },
      required: ['description', 'riskLevel'],
    },
    requiresConfirmation: false,
  },
];

// Register CHAPO's meta-tools and agent access in the unified registry
registerMetaTools(CHAPO_META_TOOLS, 'chapo');
registerAgentTools('chapo', CHAPO_AGENT.tools);
