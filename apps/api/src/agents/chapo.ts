/**
 * CHAPO - AI Assistant Agent
 *
 * Single agent that handles all tasks directly: development, research,
 * communication, and administration. No delegation, no sub-agents.
 */

import type { AgentDefinition } from './types.js';
import { CHAPO_SYSTEM_PROMPT } from '../prompts/chapo.js';
import { registerMetaTools, registerAgentTools } from '../tools/registry.js';

export const CHAPO_AGENT: AgentDefinition = {
  name: 'chapo',
  role: 'AI Assistant',
  model: 'glm-5', // ZAI GLM-5 - primary (cost-optimized)
  fallbackModel: 'claude-opus-4-5-20251101', // Fallback to Opus

  capabilities: {
    canWriteFiles: true,
    canEditFiles: true,
    canDeleteFiles: true,
    canCreateDirectories: true,
    canExecuteBash: true,
    canSSH: true,
    canGitCommit: true,
    canGitPush: true,
    canTriggerWorkflows: true,
    canManagePM2: true,
    canManageScheduler: true,
    canSendNotifications: true,
    canSendEmail: true,
    canManageTaskForge: true,
    canAskUser: true,
    canRequestApproval: true,
  },

  tools: [
    // -- Filesystem --
    'fs_listFiles', 'fs_readFile', 'fs_writeFile', 'fs_edit',
    'fs_mkdir', 'fs_move', 'fs_delete', 'fs_glob', 'fs_grep',

    // -- Git & GitHub --
    'git_status', 'git_diff', 'git_commit', 'git_push', 'git_pull', 'git_add',
    'github_triggerWorkflow', 'github_createPR', 'github_getWorkflowRunStatus',

    // -- DevOps --
    'bash_execute', 'ssh_execute',
    'devo_exec_session_start', 'devo_exec_session_write', 'devo_exec_session_poll',
    'pm2_status', 'pm2_restart', 'pm2_stop', 'pm2_start', 'pm2_logs',
    'pm2_reloadAll', 'pm2_save',
    'npm_install', 'npm_run',

    // -- Web & Research --
    'web_search', 'web_fetch',
    'scout_search_fast', 'scout_search_deep', 'scout_site_map',
    'scout_crawl_focused', 'scout_extract_schema', 'scout_research_bundle',

    // -- Context --
    'context_listDocuments', 'context_readDocument', 'context_searchDocuments',

    // -- Communication & Admin --
    'taskforge_list_tasks', 'taskforge_get_task', 'taskforge_create_task',
    'taskforge_move_task', 'taskforge_add_comment', 'taskforge_search',
    'scheduler_create', 'scheduler_list', 'scheduler_update', 'scheduler_delete',
    'reminder_create', 'notify_user', 'send_email',
    'telegram_send_document', 'deliver_document',

    // -- Memory --
    'memory_remember', 'memory_search', 'memory_readToday',

    // -- History --
    'history_search', 'history_listSessions',

    // -- Logs --
    'logs_getStagingLogs',

    // -- Skills --
    'skill_create', 'skill_update', 'skill_delete', 'skill_reload', 'skill_list',

    // -- Session & Control --
    'askUser', 'respondToUser', 'requestApproval',
    'chapo_plan_set', 'show_in_preview', 'search_files', 'todoWrite',
  ],

  systemPrompt: CHAPO_SYSTEM_PROMPT,
};

// Tool definitions for CHAPO-specific meta-tools
export const CHAPO_META_TOOLS = [
  {
    name: 'chapo_plan_set',
    description: 'Setzt einen kurzen Ausfuehrungsplan mit Schritten und Status fuer die laufende Aufgabe.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Plan-Titel.',
        },
        steps: {
          type: 'array',
          description: 'Plan-Schritte (genau 1 Schritt darf status=doing haben).',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Stabile Schritt-ID (z.B. s1).',
              },
              text: {
                type: 'string',
                description: 'Kurze Aktionsbeschreibung.',
              },
              owner: {
                type: 'string',
                enum: ['chapo'],
                description: 'Zustaendiger Agent.',
              },
              status: {
                type: 'string',
                enum: ['todo', 'doing', 'done', 'blocked'],
                description: 'Aktueller Schrittstatus.',
              },
            },
            required: ['id', 'text', 'owner', 'status'],
          },
        },
      },
      required: ['title', 'steps'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'todoWrite',
    description: 'Schreibe oder aktualisiere deine persoenliche Todo-Liste. Sende immer die KOMPLETTE Liste — sie wird jedes Mal ueberschrieben.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Die komplette Todo-Liste.',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'Was zu tun ist.',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Aktueller Status.',
              },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'askUser',
    description: 'Stelle dem User eine Frage bei Unklarheiten. Nutze dies BEVOR du Freigabe einholst. Mit blocking=false kannst du eine Frage stellen und gleichzeitig an anderen Aufgaben weiterarbeiten.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Die Frage an den User',
        },
        blocking: {
          type: 'boolean',
          description: 'Wenn false, laueft die Loop weiter waehrend auf Antwort gewartet wird. Antwort kommt via Inbox. Default: true.',
          default: true,
        },
        options: {
          type: 'array',
          description: 'Mögliche Antworten (optional)',
          items: { type: 'string' },
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
          items: { type: 'object' },
        },
      },
      required: ['description', 'riskLevel'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'respondToUser',
    description: 'Sende eine Zwischenantwort an den User waehrend du an weiteren Aufgaben arbeitest. Nutze dies wenn du eine Aufgabe abgeschlossen hast aber noch andere Aufgaben bearbeiten musst.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Der Antworttext fuer den User.',
        },
        inReplyTo: {
          type: 'string',
          description: 'Optional: Zitat oder Referenz auf welche User-Nachricht sich diese Antwort bezieht.',
        },
      },
      required: ['message'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'show_in_preview',
    description: 'Zeigt eine hochgeladene Datei (PDF, Bild) in der Preview-Leiste an. Nutze dies wenn der User eine angehängte Datei in der Preview sehen will. Benötigt die userfileId aus den angehängten Dateien (z.B. "uf_abc123" oder die Nanoid aus der Datei-Kopfzeile).',
    parameters: {
      type: 'object',
      properties: {
        userfileId: {
          type: 'string',
          description: 'Die ID der hochgeladenen Datei.',
        },
      },
      required: ['userfileId'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'search_files',
    description: 'Sucht in den hochgeladenen Dateien des Users. Ohne query werden die letzten 20 Dateien angezeigt. Mit query wird nach Dateinamen gesucht. Nutze dies wenn du eine userfileId brauchst aber sie nicht im Kontext findest.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional: Suchbegriff für den Dateinamen (z.B. ".md", "screenshot", "report").',
        },
      },
      required: [],
    },
    requiresConfirmation: false,
  },
];

// Register CHAPO's meta-tools and agent access in the unified registry
registerMetaTools(CHAPO_META_TOOLS, 'chapo');
registerAgentTools('chapo', CHAPO_AGENT.tools);
