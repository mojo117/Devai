import type { ToolDefinition } from '../registry.js';

export const fsTools: ToolDefinition[] = [
  {
    name: 'fs_listFiles',
    description: 'List files and directories in a given path',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list (relative to project root)',
        },
      },
      required: ['path'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'fs_readFile',
    description: 'Read the contents of a file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to read (relative to project root)',
        },
      },
      required: ['path'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'fs_writeFile',
    description: 'Write content to a file. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to write to (relative to project root)',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'fs_glob',
    description: 'Find files matching a glob pattern (e.g., **/*.ts, src/**/*.tsx)',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files (e.g., **/*.ts)',
        },
        path: {
          type: 'string',
          description: 'Base directory to search in (optional, defaults to project root)',
        },
      },
      required: ['pattern'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'fs_grep',
    description: 'Search for text/regex pattern in files',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for in file contents',
        },
        path: {
          type: 'string',
          description: 'Directory to search in',
        },
        glob: {
          type: 'string',
          description: 'File pattern filter (e.g., *.ts, **/*.tsx)',
        },
      },
      required: ['pattern', 'path'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'fs_edit',
    description: 'Make targeted edits to a file. By default, old_string must be unique in the file. Set replace_all=true to replace all occurrences. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to edit',
        },
        old_string: {
          type: 'string',
          description: 'Exact text to find (must be unique unless replace_all=true)',
        },
        new_string: {
          type: 'string',
          description: 'Replacement text',
        },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace all occurrences of old_string. Default: false (requires unique match)',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'fs_mkdir',
    description: 'Create a new directory. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to create',
        },
      },
      required: ['path'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'fs_move',
    description: 'Move or rename a file or directory. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'The source path (file or directory to move)',
        },
        destination: {
          type: 'string',
          description: 'The destination path',
        },
      },
      required: ['source', 'destination'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'fs_delete',
    description: 'Delete a file or directory. Set recursive=true to delete non-empty directories. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to delete (file or directory)',
        },
        recursive: {
          type: 'boolean',
          description: 'If true, recursively delete directory contents. Required for non-empty directories.',
        },
      },
      required: ['path'],
    },
    requiresConfirmation: true,
  },
];
