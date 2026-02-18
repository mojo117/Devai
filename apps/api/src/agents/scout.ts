/**
 * SCOUT - Exploration Specialist Agent
 *
 * Role: Handles codebase exploration and web search tasks.
 * Returns structured JSON summaries without modifying files.
 * Can be spawned by CHAPO, KODA, or DEVO for research tasks.
 */

import type { AgentDefinition } from './types.js';
import { SCOUT_SYSTEM_PROMPT } from '../prompts/scout.js';

export const SCOUT_AGENT: AgentDefinition = {
  name: 'scout',
  role: 'Exploration Specialist',
  model: 'claude-sonnet-4-20250514',
  fallbackModel: 'claude-3-5-haiku-20241022',

  capabilities: {
    readOnly: true,
    canEscalate: true,
  },

  tools: [
    // Read-only codebase tools
    'fs_listFiles',
    'fs_readFile',
    'fs_glob',
    'fs_grep',
    'git_status',
    'git_diff',
    // Workspace memory
    'memory_remember',
    'memory_search',
    'memory_readToday',
    // Web tools
    'web_search',
    'web_fetch',
    // Escalation
    'escalateToChapo',
  ],

  systemPrompt: SCOUT_SYSTEM_PROMPT,
};

// Meta tools specific to SCOUT (escalation)
export const SCOUT_META_TOOLS = [
  {
    name: 'escalateToChapo',
    description: 'Eskaliere an CHAPO wenn die Aufgabe Änderungen erfordert oder du blockiert bist.',
    parameters: {
      type: 'object',
      properties: {
        issueType: {
          type: 'string',
          enum: ['error', 'clarification', 'blocker'],
          description: 'Art des Problems',
        },
        description: {
          type: 'string',
          description: 'Beschreibung des Problems oder der Erkenntnis',
        },
        context: {
          type: 'object',
          description: 'Gefundene Informationen und Kontext',
        },
        suggestedSolutions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Empfohlene nächste Schritte',
        },
      },
      required: ['issueType', 'description'],
    },
    requiresConfirmation: false,
  },
];
