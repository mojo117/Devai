import type { ToolDefinition } from '../registry.js';

export const historyTools: ToolDefinition[] = [
  {
    name: 'history_search',
    description: 'Search past conversation messages across all sessions. Returns matching snippets with session title, role, and timestamp.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text to search for in message content (case-insensitive)',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (1-50, default: 20)',
        },
        role: {
          type: 'string',
          description: 'Filter by message role: user, assistant, system',
        },
        sessionId: {
          type: 'string',
          description: 'Limit search to a specific session ID (optional)',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'history_listSessions',
    description: 'List recent conversation sessions with titles and creation dates. Useful for browsing past conversations before searching.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max sessions to return (1-100, default: 30)',
        },
      },
    },
    requiresConfirmation: false,
  },
];
