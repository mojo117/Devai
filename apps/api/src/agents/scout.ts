/**
 * SCOUT - Exploration Specialist Agent
 *
 * Role: Handles codebase exploration and web search tasks.
 * Returns structured JSON summaries without modifying files.
 * Can be spawned by CHAPO or DEVO for research tasks.
 */

import type { AgentDefinition } from './types.js';
import { SCOUT_SYSTEM_PROMPT } from '../prompts/scout.js';
import { registerMetaTools, registerAgentTools } from '../tools/registry.js';

export const SCOUT_AGENT: AgentDefinition = {
  name: 'scout',
  role: 'Exploration Specialist',
  model: 'glm-4.7-flash', // ZAI GLM-4.7 Flash - FREE
  fallbackModel: 'claude-sonnet-4-20250514',

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
    // Read-only context documents
    'context_searchDocuments',
    'git_status',
    'git_diff',
    // GitHub (read-only)
    'github_getWorkflowRunStatus',
    // Workspace memory
    'memory_remember',
    'memory_search',
    'memory_readToday',
    // Web tools
    'web_search',
    'web_fetch',
    'scout_search_fast',
    'scout_search_deep',
    'scout_site_map',
    'scout_crawl_focused',
    'scout_extract_schema',
    'scout_research_bundle',
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

// Register SCOUT's meta-tools and agent access in the unified registry
registerMetaTools(SCOUT_META_TOOLS, 'scout');
registerAgentTools('scout', SCOUT_AGENT.tools);
