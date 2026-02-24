import type { ToolDefinition } from '../registry.js';

export const contextTools: ToolDefinition[] = [
  {
    name: 'context_listDocuments',
    description: 'List all documents in the context folder. Returns filenames, sizes, and modification dates.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: 'context_readDocument',
    description: 'Read the contents of a document from the context folder. Accepts filename or path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The document filename or path (e.g., "notes.md" or "context/documents/notes.md")',
        },
      },
      required: ['path'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'context_searchDocuments',
    description: 'Search for text across all documents in the context folder. Returns matching lines.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The text to search for (case-insensitive)',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
];
