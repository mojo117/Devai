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
  model: 'glm-5', // ZAI GLM-5 - primary (cost-optimized)
  fallbackModel: 'claude-opus-4-5-20251101', // Fallback to Opus

  capabilities: {
    readOnly: true,
    canDelegateToDevo: true,
    canDelegateToCaio: true,
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
    // Web tools (read-only research)
    'web_search',
    'web_fetch',
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
    // Skill tools (read-only management)
    'skill_list',
    'skill_reload',
    // CHAPO control tools
    'chapo_inbox_list_open',
    'chapo_inbox_resolve',
    'chapo_plan_set',
    'chapo_answer_preflight',
    // Meta-tools for coordination
    'delegateToDevo',
    'delegateToCaio',
    'delegateParallel',
    'delegateToScout',
    'askUser',
    'requestApproval',
    'todoWrite',
    'respondToUser',
  ],

  systemPrompt: CHAPO_SYSTEM_PROMPT,
};

// Tool definitions for CHAPO-specific meta-tools
export const CHAPO_META_TOOLS = [
  {
    name: 'chapo_inbox_list_open',
    description: 'Liste offene User-Verpflichtungen aus der Inbox bzw. aktuellen Aufgabe.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['all', 'current_task'],
          description: 'all = alle offenen Punkte, current_task = nur aktive Turn-Aufgabe.',
        },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Rueckgaben (1-50, default 10).',
        },
      },
    },
    requiresConfirmation: false,
  },
  {
    name: 'chapo_inbox_resolve',
    description: 'Markiere eine offene Verpflichtung als erledigt, blockiert oder bewusst verworfen.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Obligation-ID aus chapo_inbox_list_open.',
        },
        resolution: {
          type: 'string',
          enum: ['done', 'wont_do', 'superseded', 'blocked'],
          description: 'done=satisfied, blocked=failed, wont_do/superseded=waived.',
        },
        note: {
          type: 'string',
          description: 'Kurze Begruendung oder Evidenz (optional).',
        },
      },
      required: ['id', 'resolution'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'chapo_plan_set',
    description: 'Setzt einen kurzen Ausfuehrungsplan mit Schritten, Owner und Status fuer die laufende Aufgabe.',
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
                enum: ['chapo', 'devo', 'scout', 'caio'],
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
    name: 'chapo_answer_preflight',
    description: 'Prueft einen Antwortentwurf auf Coverage, Widersprueche und unbelegte Claims.',
    parameters: {
      type: 'object',
      properties: {
        draft: {
          type: 'string',
          description: 'Antwortentwurf, der geprueft werden soll.',
        },
        mustAddress: {
          type: 'array',
          description: 'Optionale Liste von Punkten, die die Antwort explizit adressieren muss.',
          items: { type: 'string' },
        },
        strict: {
          type: 'boolean',
          description: 'Wenn true, nur ohne Issues als okay markieren.',
        },
      },
      required: ['draft'],
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
    name: 'delegateToDevo',
    description: 'Delegiere Entwicklungs-/DevOps-Aufgaben an DEVO. Entscheide nur die Domäne und das Ziel; DEVO wählt die konkreten Tools.',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          enum: ['development'],
          description: 'Delegationsdomäne für DEVO.',
        },
        objective: {
          type: 'string',
          description: 'Konkretes Ziel der Delegation (ohne Toolnamen).',
        },
        context: {
          type: 'object',
          description: 'Zusätzlicher Kontext (Fakten, Rahmenbedingungen).',
        },
        contextFacts: {
          type: 'array',
          description: 'Optionale Faktenpunkte als Strings.',
          items: { type: 'string' },
        },
        constraints: {
          type: 'array',
          description: 'Einschränkungen/Leitplanken für die Ausführung.',
          items: { type: 'string' },
        },
        expectedOutcome: {
          type: 'string',
          description: 'Erwartetes Ergebnis als Klartext.',
        },
        task: {
          type: 'string',
          description: 'Legacy-Feld: wird als objective interpretiert.',
        },
      },
      required: ['domain', 'objective'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'delegateToCaio',
    description: 'Delegiere Kommunikations-/Admin-Aufgaben an CAIO. Entscheide nur die Domäne und das Ziel; CAIO wählt die konkreten Tools.',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          enum: ['communication'],
          description: 'Delegationsdomäne für CAIO.',
        },
        objective: {
          type: 'string',
          description: 'Konkretes Ziel der Delegation (ohne Toolnamen).',
        },
        context: {
          type: 'object',
          description: 'Zusätzlicher Kontext (Fakten, Rahmenbedingungen).',
        },
        contextFacts: {
          type: 'array',
          description: 'Optionale Faktenpunkte als Strings.',
          items: { type: 'string' },
        },
        constraints: {
          type: 'array',
          description: 'Einschränkungen/Leitplanken für die Ausführung.',
          items: { type: 'string' },
        },
        expectedOutcome: {
          type: 'string',
          description: 'Erwartetes Ergebnis als Klartext.',
        },
        task: {
          type: 'string',
          description: 'Legacy-Feld: wird als objective interpretiert.',
        },
      },
      required: ['domain', 'objective'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'delegateParallel',
    description: 'Führe mehrere unabhängige Delegationen parallel aus (DEVO/CAIO/SCOUT). Nur nutzen, wenn keine harte Datenabhängigkeit zwischen den Teilaufgaben besteht.',
    parameters: {
      type: 'object',
      properties: {
        delegations: {
          type: 'array',
          description: 'Liste der Delegationen',
          items: {
            type: 'object',
            properties: {
              agent: {
                type: 'string',
                enum: ['devo', 'caio', 'scout'],
                description: 'Ziel-Agent',
              },
              domain: {
                type: 'string',
                enum: ['development', 'communication', 'research'],
                description: 'Delegationsdomäne für diesen Teilauftrag.',
              },
              objective: {
                type: 'string',
                description: 'Ziel/Aufgabe für den Ziel-Agenten (ohne Toolnamen).',
              },
              context: {
                type: 'object',
                description: 'Optionaler Zusatzkontext.',
              },
              constraints: {
                type: 'array',
                description: 'Optionale Leitplanken.',
                items: { type: 'string' },
              },
              expectedOutcome: {
                type: 'string',
                description: 'Optionales erwartetes Ergebnis.',
              },
              task: {
                type: 'string',
                description: 'Legacy-Feld: wird als objective interpretiert.',
              },
            },
            required: ['agent', 'domain', 'objective'],
          },
        },
      },
      required: ['delegations'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'delegateToScout',
    description: 'Delegiere Exploration/Recherche an SCOUT. Entscheide Domäne + Ziel, SCOUT wählt die Recherche-Tools.',
    parameters: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          enum: ['research'],
          description: 'Delegationsdomäne für SCOUT.',
        },
        objective: {
          type: 'string',
          description: 'Was soll SCOUT suchen/erforschen?',
        },
        query: {
          type: 'string',
          description: 'Legacy-Feld: wird als objective interpretiert.',
        },
        scope: {
          type: 'string',
          enum: ['codebase', 'web', 'both'],
          description: 'Wo soll gesucht werden? (default: both)',
        },
        context: {
          type: 'object',
          description: 'Zusätzlicher Kontext für die Suche (optional)',
        },
        constraints: {
          type: 'array',
          description: 'Optionale Leitplanken für die Recherche.',
          items: { type: 'string' },
        },
        expectedOutcome: {
          type: 'string',
          description: 'Erwartetes Ergebnis als Klartext.',
        },
      },
      required: ['domain', 'objective'],
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
];

// Register CHAPO's meta-tools and agent access in the unified registry
registerMetaTools(CHAPO_META_TOOLS, 'chapo');
registerAgentTools('chapo', CHAPO_AGENT.tools);
