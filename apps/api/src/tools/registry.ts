import type { ToolDefinition as LLMToolDefinition } from '../llm/types.js';

export type ToolName =
  | 'fs.listFiles'
  | 'fs.readFile'
  | 'fs.writeFile'
  | 'fs.glob'
  | 'fs.grep'
  | 'fs.edit'
  | 'fs.mkdir'
  | 'fs.move'
  | 'fs.delete'
  | 'git.status'
  | 'git.diff'
  | 'git.commit'
  | 'github.triggerWorkflow'
  | 'github.getWorkflowRunStatus'
  | 'logs.getStagingLogs'
  | 'askForConfirmation';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required?: string[];
  };
  requiresConfirmation: boolean;
}

// Whitelisted tools with their definitions
export const TOOL_REGISTRY: ToolDefinition[] = [
  // File System Tools
  {
    name: 'fs.listFiles',
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
    name: 'fs.readFile',
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
    name: 'fs.writeFile',
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
    name: 'fs.glob',
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
    name: 'fs.grep',
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
    name: 'fs.edit',
    description: 'Make targeted edits to a file (find and replace a unique string). This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to edit',
        },
        old_string: {
          type: 'string',
          description: 'Exact text to find (must be unique in the file)',
        },
        new_string: {
          type: 'string',
          description: 'Replacement text',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'fs.mkdir',
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
    name: 'fs.move',
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
    name: 'fs.delete',
    description: 'Delete a file or empty directory. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to delete (file or empty directory)',
        },
      },
      required: ['path'],
    },
    requiresConfirmation: true,
  },

  // Git Tools
  {
    name: 'git.status',
    description: 'Show the working tree status (modified, staged, untracked files)',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: 'git.diff',
    description: 'Show changes between commits, commit and working tree, etc.',
    parameters: {
      type: 'object',
      properties: {
        staged: {
          type: 'boolean',
          description: 'If true, show only staged changes',
        },
      },
    },
    requiresConfirmation: false,
  },
  {
    name: 'git.commit',
    description: 'Create a git commit with the staged changes. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The commit message',
        },
      },
      required: ['message'],
    },
    requiresConfirmation: true,
  },

  // GitHub Tools
  {
    name: 'github.triggerWorkflow',
    description: 'Trigger a GitHub Actions workflow via workflow_dispatch. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        workflow: {
          type: 'string',
          description: 'The workflow file name or ID (e.g., "deploy-staging.yml")',
        },
        ref: {
          type: 'string',
          description: 'The git reference (branch/tag) to run the workflow on',
        },
        inputs: {
          type: 'object',
          description: 'Optional inputs to pass to the workflow',
        },
      },
      required: ['workflow', 'ref'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'github.getWorkflowRunStatus',
    description: 'Get the status of a GitHub Actions workflow run',
    parameters: {
      type: 'object',
      properties: {
        runId: {
          type: 'number',
          description: 'The workflow run ID',
        },
      },
      required: ['runId'],
    },
    requiresConfirmation: false,
  },

  // Logs Tools
  {
    name: 'logs.getStagingLogs',
    description: 'Get recent logs from the staging environment',
    parameters: {
      type: 'object',
      properties: {
        lines: {
          type: 'number',
          description: 'Number of log lines to retrieve (default: 200)',
        },
      },
    },
    requiresConfirmation: false,
  },
  {
    name: 'askForConfirmation',
    description: 'Request user approval for a tool action. Returns an actionId.',
    parameters: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: 'The tool to run after approval (must require confirmation)',
        },
        toolArgs: {
          type: 'object',
          description: 'Arguments for the tool',
        },
        description: {
          type: 'string',
          description: 'Short human-readable description of the action',
        },
      },
      required: ['toolName', 'toolArgs'],
    },
    requiresConfirmation: false,
  },
];

// Get tool definition by name
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

// Check if a tool is whitelisted
export function isToolWhitelisted(name: string): boolean {
  return TOOL_REGISTRY.some((t) => t.name === name);
}

// Check if a tool requires confirmation
export function toolRequiresConfirmation(name: string): boolean {
  const tool = getToolDefinition(name);
  return tool?.requiresConfirmation ?? true; // Default to requiring confirmation for unknown tools
}

// Convert to LLM tool format
export function getToolsForLLM(): LLMToolDefinition[] {
  return TOOL_REGISTRY.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
