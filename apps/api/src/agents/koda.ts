/**
 * KODA - Senior Developer Agent
 *
 * Role: Handles all code-related tasks including writing, editing,
 * and deleting files. Can escalate problems back to CHAPO.
 */

import type { AgentDefinition } from './types.js';
import { KODA_SYSTEM_PROMPT } from '../prompts/koda.js';

export const KODA_AGENT: AgentDefinition = {
  name: 'koda',
  role: 'Senior Developer',
  model: 'claude-sonnet-4-20250514',

  capabilities: {
    canWriteFiles: true,
    canEditFiles: true,
    canDeleteFiles: true,
    canCreateDirectories: true,
    canDelegateToScout: true,
    canEscalate: true,
  },

  tools: [
    // Write tools
    'fs_writeFile',
    'fs_edit',
    'fs_mkdir',
    'fs_move',
    'fs_delete',
    // Read tools (for context)
    'fs_listFiles',
    'fs_readFile',
    'fs_glob',
    'fs_grep',
    // Workspace memory
    'memory_remember',
    'memory_search',
    'memory_readToday',
    // Exploration (spawn SCOUT for searches)
    'delegateToScout',
    // Escalation
    'escalateToChapo',
  ],

  systemPrompt: KODA_SYSTEM_PROMPT,
};

// Tool definition for KODA-specific escalation tool
export const KODA_META_TOOLS = [
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
          description: 'Relevanter Kontext (Dateipfade, Fehlermeldungen, etc.)',
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
