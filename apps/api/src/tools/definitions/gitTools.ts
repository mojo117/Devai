import type { ToolDefinition } from '../registry.js';

export const gitTools: ToolDefinition[] = [
  {
    name: 'git_status',
    description: 'Show the working tree status (modified, staged, untracked files)',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: 'git_diff',
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
    name: 'git_commit',
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
  {
    name: 'git_push',
    description: 'Push commits to remote repository. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        remote: {
          type: 'string',
          description: 'Remote name (default: origin)',
        },
        branch: {
          type: 'string',
          description: 'Branch name (default: current branch)',
        },
      },
    },
    requiresConfirmation: true,
  },
  {
    name: 'git_pull',
    description: 'Pull changes from remote repository. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        remote: {
          type: 'string',
          description: 'Remote name (default: origin)',
        },
        branch: {
          type: 'string',
          description: 'Branch name (default: current branch)',
        },
      },
    },
    requiresConfirmation: true,
  },
  {
    name: 'git_add',
    description: 'Stage files for commit',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to stage (default: all changes)',
        },
      },
    },
    requiresConfirmation: false,
  },
];
