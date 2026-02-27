import type { ToolDefinition } from '../registry.js';

export const devopsTools: ToolDefinition[] = [
  // GitHub Tools
  {
    name: 'github_triggerWorkflow',
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
    name: 'github_getWorkflowRunStatus',
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
  {
    name: 'github_createPR',
    description: 'Create a GitHub Pull Request from locally committed changes. Pushes changed files to an ephemeral branch and opens a PR to the base branch. Use this instead of git_push for the Devai repo.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'PR title (short, descriptive)',
        },
        description: {
          type: 'string',
          description: 'PR body/description (optional — auto-generated if omitted)',
        },
        baseBranch: {
          type: 'string',
          description: 'Target branch for the PR (default: "dev")',
        },
      },
      required: ['title'],
    },
    requiresConfirmation: true,
  },

  // Logs Tools
  {
    name: 'logs_getStagingLogs',
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

  // Bash / SSH / PM2 / NPM
  {
    name: 'bash_execute',
    description: 'Execute a bash command locally. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 15000)',
        },
      },
      required: ['command'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'exec_session_start',
    description: 'Start a persistent execution session for long-running command output and incremental polling. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to start (non-interactive shell startup is blocked)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command',
        },
        timeoutMs: {
          type: 'number',
          description: 'Session timeout in milliseconds (default: 600000, max: 1800000)',
        },
        allowArbitraryInput: {
          type: 'boolean',
          description: 'If true, exec_session_write accepts arbitrary text input; otherwise only control/whitespace input is allowed.',
        },
      },
      required: ['command'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'exec_session_write',
    description: 'Write to a running execution session stdin (e.g. control sequences or interactive replies).',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned by exec_session_start',
        },
        input: {
          type: 'string',
          description: 'Input to write to stdin',
        },
      },
      required: ['sessionId', 'input'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'exec_session_poll',
    description: 'Poll output/status from a running or completed execution session.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned by exec_session_start',
        },
        maxBytes: {
          type: 'number',
          description: 'Maximum output bytes to return in this poll (default: 8192)',
        },
      },
      required: ['sessionId'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'ssh_execute',
    description: 'Execute a command on a remote server via SSH. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'Host alias (baso, klyde, infrit) or IP address',
        },
        command: {
          type: 'string',
          description: 'The command to execute on the remote server',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['host', 'command'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'pm2_status',
    description: 'Get PM2 process status from the server',
    parameters: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'Host alias (default: baso)',
        },
      },
    },
    requiresConfirmation: false,
  },
  {
    name: 'pm2_restart',
    description: 'Restart a PM2 process. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        processName: {
          type: 'string',
          description: 'Name of the PM2 process to restart',
        },
        host: {
          type: 'string',
          description: 'Host alias (default: baso)',
        },
      },
      required: ['processName'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'pm2_stop',
    description: 'Stop a PM2 process. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        processName: {
          type: 'string',
          description: 'Name of the PM2 process to stop',
        },
        host: {
          type: 'string',
          description: 'Host alias (default: baso)',
        },
      },
      required: ['processName'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'pm2_start',
    description: 'Start a PM2 process. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        processName: {
          type: 'string',
          description: 'Name of the PM2 process to start',
        },
        host: {
          type: 'string',
          description: 'Host alias (default: baso)',
        },
      },
      required: ['processName'],
    },
    requiresConfirmation: true,
  },
  {
    name: 'pm2_logs',
    description: 'Get PM2 logs for a process',
    parameters: {
      type: 'object',
      properties: {
        processName: {
          type: 'string',
          description: 'Name of the PM2 process',
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to retrieve (default: 50)',
        },
        host: {
          type: 'string',
          description: 'Host alias (default: baso)',
        },
      },
      required: ['processName'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'pm2_reloadAll',
    description: 'Reload all PM2 processes. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'Host alias (default: baso)',
        },
      },
    },
    requiresConfirmation: true,
  },
  {
    name: 'pm2_save',
    description: 'Save current PM2 process list. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'Host alias (default: baso)',
        },
      },
    },
    requiresConfirmation: true,
  },
  {
    name: 'npm_install',
    description: 'Run npm install. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        packageName: {
          type: 'string',
          description: 'Package name to install (optional, installs all if not specified)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command',
        },
      },
    },
    requiresConfirmation: true,
  },
  {
    name: 'npm_run',
    description: 'Run an npm script. This action requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'The npm script to run',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command',
        },
      },
      required: ['script'],
    },
    requiresConfirmation: true,
  },
];
