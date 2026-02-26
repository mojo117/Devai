import type { ToolDefinition } from '../registry.js';

export const memoryTools: ToolDefinition[] = [
  {
    name: 'memory_remember',
    description: 'Save an important note to workspace daily memory. Use for explicit remember requests.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The note to persist',
        },
      },
      required: ['content'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'memory_search',
    description: 'Search persisted workspace memory (daily files).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text to search in memory',
        },
        limit: {
          type: 'number',
          description: 'Max number of results (1-50)',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'memory_readToday',
    description: "Read today's daily memory file.",
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
];
