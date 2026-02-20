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
    'delegateToCaio',
    'delegateParallel',
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
];

// Register CHAPO's meta-tools and agent access in the unified registry
registerMetaTools(CHAPO_META_TOOLS, 'chapo');
registerAgentTools('chapo', CHAPO_AGENT.tools);
