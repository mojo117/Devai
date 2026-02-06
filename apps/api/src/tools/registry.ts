import type { ToolDefinition as LLMToolDefinition } from '../llm/types.js';

export type ToolName =
  // File System Tools
  | 'fs_listFiles'
  | 'fs_readFile'
  | 'fs_writeFile'
  | 'fs_glob'
  | 'fs_grep'
  | 'fs_edit'
  | 'fs_mkdir'
  | 'fs_move'
  | 'fs_delete'
  // Git Tools
  | 'git_status'
  | 'git_diff'
  | 'git_commit'
  | 'git_push'
  | 'git_pull'
  | 'git_add'
  // GitHub Tools
  | 'github_triggerWorkflow'
  | 'github_getWorkflowRunStatus'
  // Logs Tools
  | 'logs_getStagingLogs'
  // DevOps Tools (DEVO)
  | 'bash_execute'
  | 'ssh_execute'
  | 'pm2_status'
  | 'pm2_restart'
  | 'pm2_stop'
  | 'pm2_start'
  | 'pm2_logs'
  | 'pm2_reloadAll'
  | 'pm2_save'
  | 'npm_install'
  | 'npm_run'
  // Web Tools (SCOUT agent)
  | 'web_search'
  | 'web_fetch'
  // Agent Meta-Tools
  | 'delegateToKoda'
  | 'delegateToDevo'
  | 'delegateToScout'
  | 'escalateToChapo'
  | 'askUser'
  | 'requestApproval'
  | 'askForConfirmation'
  // Context Tools (read-only document access)
  | 'context_listDocuments'
  | 'context_readDocument'
  | 'context_searchDocuments';

export interface ToolPropertyDefinition {
  type: string;
  description: string;
  items?: { type: string };  // For array types
  enum?: string[];           // For enum types
  default?: unknown;         // For default values
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolPropertyDefinition>;
    required?: string[];
  };
  requiresConfirmation: boolean;
}

// Whitelisted tools with their definitions
export const TOOL_REGISTRY: ToolDefinition[] = [
  // File System Tools
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

  // Git Tools
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

  // Web Tools (SCOUT agent)
  {
    name: 'web_search',
    description: 'Search the web for current information using Perplexity AI. Use for: weather, news, documentation, best practices, tutorials, comparisons.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string (e.g., "Wetter Berlin", "React 19 new features")',
        },
        complexity: {
          type: 'string',
          description: 'Search depth: "simple" for quick facts, "detailed" for explanations, "deep" for thorough analysis',
        },
        recency: {
          type: 'string',
          description: 'Limit to recent content: "day", "week", "month", or "year"',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'web_fetch',
    description: 'Fetch and extract content from a URL. Returns text content with HTML stripped.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch (must be http or https)',
        },
        timeout: {
          type: 'number',
          description: 'Request timeout in milliseconds (default: 10000)',
        },
      },
      required: ['url'],
    },
    requiresConfirmation: false,
  },

  // DevOps Tools (DEVO agent)
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

  // Agent Meta-Tools
  {
    name: 'delegateToKoda',
    description: 'Delegate a code-related task to KODA (Senior Developer). Only available to CHAPO.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Description of the coding task',
        },
        context: {
          type: 'object',
          description: 'Gathered context and relevant information',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of relevant file paths',
        },
      },
      required: ['task'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'delegateToDevo',
    description: 'Delegate a DevOps task to DEVO (DevOps Engineer). Only available to CHAPO.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Description of the DevOps task',
        },
        context: {
          type: 'object',
          description: 'Gathered context and relevant information',
        },
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'Suggested commands to execute',
        },
      },
      required: ['task'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'delegateToScout',
    description: 'Delegate exploration or research task to SCOUT. Available to CHAPO, KODA, and DEVO.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to explore or search for',
        },
        scope: {
          type: 'string',
          description: 'Where to search: "codebase", "web", or "both" (default: "both")',
        },
        context: {
          type: 'string',
          description: 'Additional context to help SCOUT understand the task',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'escalateToChapo',
    description: 'Escalate a problem to CHAPO (Task Coordinator). Available to KODA and DEVO.',
    parameters: {
      type: 'object',
      properties: {
        issueType: {
          type: 'string',
          description: 'Type of issue: error, clarification, or blocker',
        },
        description: {
          type: 'string',
          description: 'Description of the problem',
        },
        context: {
          type: 'object',
          description: 'Relevant context (error messages, logs, etc.)',
        },
        suggestedSolutions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Possible solutions to the problem',
        },
      },
      required: ['issueType', 'description'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'askUser',
    description: 'Ask the user a question for clarification. Only available to CHAPO.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Possible answer options (optional)',
        },
      },
      required: ['question'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'requestApproval',
    description: 'Request user approval for a risky action. Only available to CHAPO.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Description of the action requiring approval',
        },
        risk: {
          type: 'string',
          description: 'Risk level: low, medium, or high',
        },
        details: {
          type: 'object',
          description: 'Additional details about the action',
        },
      },
      required: ['action', 'risk'],
    },
    requiresConfirmation: false,
  },

  // Context Tools (read-only document access)
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

// Dynamic MCP tools (registered at runtime by McpManager)
let MCP_TOOLS: ToolDefinition[] = [];

/**
 * Register MCP tools discovered from MCP servers.
 * Called by McpManager during initialization.
 */
export function registerMcpTools(tools: ToolDefinition[]): void {
  MCP_TOOLS = tools;
  console.info(`[registry] Registered ${tools.length} MCP tool(s)`);
}

/**
 * Get all tool definitions (native + MCP)
 */
function getAllTools(): ToolDefinition[] {
  return [...TOOL_REGISTRY, ...MCP_TOOLS];
}

// Get tool definition by name
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return getAllTools().find((t) => t.name === name);
}

// Check if a tool is whitelisted
export function isToolWhitelisted(name: string): boolean {
  return getAllTools().some((t) => t.name === name);
}

// Check if a tool requires confirmation
export function toolRequiresConfirmation(name: string): boolean {
  const tool = getToolDefinition(name);
  return tool?.requiresConfirmation ?? true; // Default to requiring confirmation for unknown tools
}

// Convert to LLM tool format
export function getToolsForLLM(): LLMToolDefinition[] {
  return getAllTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
