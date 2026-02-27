import type { ToolDefinition } from '../registry.js';

export const supabaseTools: ToolDefinition[] = [
  {
    name: 'supabase_list_functions',
    description: 'List all Supabase Edge Functions in the project. Returns function names, versions, and deployment status.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: 'supabase_get_function',
    description: 'Get details of a specific Supabase Edge Function including its code, version, and metadata.',
    parameters: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'Name of the edge function to retrieve',
        },
      },
      required: ['functionName'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'supabase_deploy_function',
    description: 'Deploy or update a Supabase Edge Function. Creates a new function or updates an existing one. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'Name for the edge function (lowercase, alphanumeric, hyphens allowed)',
        },
        files: {
          type: 'array',
          description: 'Array of files to deploy. Each file needs a name and content.',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'File name (e.g., "index.ts" or "utils/helper.ts")',
              },
              content: {
                type: 'string',
                description: 'File content (TypeScript/JavaScript code)',
              },
            },
            required: ['name', 'content'],
          },
        },
        entrypointPath: {
          type: 'string',
          description: 'Path to the entrypoint file (default: "index.ts")',
        },
        importMapPath: {
          type: 'string',
          description: 'Path to import map file if using custom imports (default: "import_map.json")',
        },
        verifyJWT: {
          type: 'boolean',
          description: 'Whether to verify JWT tokens (default: true)',
        },
      },
      required: ['functionName', 'files'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'supabase_delete_function',
    description: 'Delete a Supabase Edge Function. This action is irreversible and requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'Name of the edge function to delete',
        },
      },
      required: ['functionName'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'supabase_invoke_function',
    description: 'Invoke a Supabase Edge Function with optional payload. Useful for testing deployed functions.',
    parameters: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'Name of the edge function to invoke',
        },
        payload: {
          type: 'object',
          description: 'JSON payload to send to the function',
        },
        headers: {
          type: 'object',
          description: 'Additional headers to include in the request',
        },
      },
      required: ['functionName'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'supabase_get_function_logs',
    description: 'Get recent logs for a Supabase Edge Function. Useful for debugging.',
    parameters: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'Name of the edge function to get logs for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of log entries to return (default: 100)',
        },
      },
      required: ['functionName'],
    },
    requiresConfirmation: false,
  },
];
