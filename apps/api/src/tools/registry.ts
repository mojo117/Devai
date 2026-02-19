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
  // Context Tools (read-only document access)
  | 'context_listDocuments'
  | 'context_readDocument'
  | 'context_searchDocuments'
  // Workspace Memory Tools
  | 'memory_remember'
  | 'memory_search'
  | 'memory_readToday'
  // Scheduler Tools (DEVO)
  | 'scheduler_create'
  | 'scheduler_list'
  | 'scheduler_update'
  | 'scheduler_delete'
  | 'reminder_create'
  | 'notify_user';

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

// ============================================
// UNIFIED TOOL SYSTEM
// ============================================

/** Tool category for the unified registry */
export type ToolCategory = 'native' | 'mcp' | 'meta';

/**
 * Unified tool definition that covers all tool types:
 * - native: built-in tools (fs, git, bash, etc.)
 * - mcp: tools discovered from MCP servers at runtime
 * - meta: agent coordination tools (delegateToDevo, escalateToChapo, etc.)
 */
export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolPropertyDefinition>;
    required?: string[];
  };
  requiresConfirmation: boolean;
  category: ToolCategory;
  /** For MCP tools: the MCP server name */
  mcpServer?: string;
  /** For meta-tools: which agent owns/defines this tool */
  ownerAgent?: string;
}

/**
 * Unified ToolRegistry — single source of truth for all tools.
 *
 * Replaces the fragmented system where native tools lived in TOOL_REGISTRY,
 * MCP tools in a separate array, and meta-tools inline in agent files.
 */
class UnifiedToolRegistry {
  private tools = new Map<string, ToolDef>();
  /** Which agents can access which tools: agent name -> set of tool names */
  private agentAccess = new Map<string, Set<string>>();

  /** Register a single tool */
  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  /** Register multiple tools at once */
  registerAll(tools: ToolDef[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** Remove tools by category (used when MCP reconnects) */
  removeByCategory(category: ToolCategory): void {
    for (const [name, tool] of this.tools) {
      if (tool.category === category) {
        this.tools.delete(name);
      }
    }
  }

  /** Grant an agent access to a specific tool */
  grantAccess(agentName: string, toolName: string): void {
    if (!this.agentAccess.has(agentName)) {
      this.agentAccess.set(agentName, new Set());
    }
    this.agentAccess.get(agentName)!.add(toolName);
  }

  /** Grant an agent access to multiple tools */
  grantAccessAll(agentName: string, toolNames: string[]): void {
    for (const name of toolNames) {
      this.grantAccess(agentName, name);
    }
  }

  /** Get all tool names an agent can access */
  getAgentTools(agentName: string): string[] {
    return Array.from(this.agentAccess.get(agentName) ?? []);
  }

  /** Check if an agent can use a specific tool */
  canAccess(agentName: string, toolName: string): boolean {
    return this.agentAccess.get(agentName)?.has(toolName) ?? false;
  }

  /** Get a tool by name */
  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Get all registered tools */
  getAll(): ToolDef[] {
    return Array.from(this.tools.values());
  }

  /** Get tools filtered by category */
  getByCategory(category: ToolCategory): ToolDef[] {
    return this.getAll().filter((t) => t.category === category);
  }

  /** Convert all tools to LLM format (name, description, parameters only) */
  toLLMFormat(): LLMToolDefinition[] {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /** Convert tools for a specific agent to LLM format */
  toLLMFormatForAgent(agentName: string): LLMToolDefinition[] {
    const agentToolNames = this.getAgentTools(agentName);
    return this.getAll()
      .filter((t) => agentToolNames.includes(t.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  }

  /** Get count of registered tools */
  get size(): number {
    return this.tools.size;
  }
}

/** Singleton unified registry */
export const toolRegistry = new UnifiedToolRegistry();

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
  // Workspace Memory Tools
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
        promoteToLongTerm: {
          type: 'boolean',
          description: 'Also append to long-term MEMORY.md',
        },
      },
      required: ['content'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'memory_search',
    description: 'Search persisted workspace memory (daily + optional long-term memory).',
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
        includeLongTerm: {
          type: 'boolean',
          description: 'Include MEMORY.md in search',
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

  // Scheduler Tools (DEVO agent)
  {
    name: 'scheduler_create',
    description: 'Create a scheduled job (cron). Runs an instruction on a recurring schedule. Use standard cron syntax (e.g. "0 8 * * *" = every day at 8am).',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable job name (e.g. "Morning PM2 health check")',
        },
        cronExpression: {
          type: 'string',
          description: 'Cron schedule expression (e.g. "0 8 * * *" for daily at 8am, "*/30 * * * *" for every 30 min)',
        },
        instruction: {
          type: 'string',
          description: 'Natural language instruction for what to do when the job fires (executed by CHAPO)',
        },
        notificationChannel: {
          type: 'string',
          description: 'Optional notification channel override (default: use global setting)',
        },
      },
      required: ['name', 'cronExpression', 'instruction'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'scheduler_list',
    description: 'List all scheduled jobs with their status, schedule, and last run info.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: 'scheduler_update',
    description: 'Update a scheduled job (change name, schedule, instruction, or enable/disable).',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The job ID to update',
        },
        name: {
          type: 'string',
          description: 'New job name',
        },
        cronExpression: {
          type: 'string',
          description: 'New cron schedule expression',
        },
        instruction: {
          type: 'string',
          description: 'New instruction',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the job',
        },
      },
      required: ['id'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'scheduler_delete',
    description: 'Delete a scheduled job permanently.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The job ID to delete',
        },
      },
      required: ['id'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'reminder_create',
    description: 'Create a one-time reminder. Fires at the specified datetime and auto-deletes.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The reminder message to send',
        },
        datetime: {
          type: 'string',
          description: 'ISO 8601 datetime for when to fire (e.g. "2026-02-20T09:00:00")',
        },
      },
      required: ['message', 'datetime'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'notify_user',
    description: 'Send a notification to the user on their default notification channel (Telegram, etc.).',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The notification message to send',
        },
        channel: {
          type: 'string',
          description: 'Optional: specific channel to use instead of default',
        },
      },
      required: ['message'],
    },
    requiresConfirmation: false,
  },
];

// ============================================
// UNIFIED REGISTRY INITIALIZATION
// ============================================

// Seed the unified registry with all native tools
for (const tool of TOOL_REGISTRY) {
  toolRegistry.register({
    ...tool,
    name: tool.name as string,
    category: 'native',
  });
}

/**
 * Register MCP tools discovered from MCP servers.
 * Called by McpManager during initialization.
 */
export function registerMcpTools(tools: ToolDefinition[]): void {
  // Remove old MCP tools before re-registering
  toolRegistry.removeByCategory('mcp');
  for (const tool of tools) {
    toolRegistry.register({
      ...tool,
      name: tool.name as string,
      category: 'mcp',
    });
  }
  console.info(`[registry] Registered ${tools.length} MCP tool(s)`);
}

/**
 * Register meta-tools (agent coordination tools like delegateToDevo, escalateToChapo).
 * Called by agent definitions during setup.
 */
export function registerMetaTools(
  tools: ReadonlyArray<{
    name: string;
    description: string;
    parameters: { type: string; properties: Record<string, unknown>; required?: string[] };
    requiresConfirmation: boolean;
  }>,
  ownerAgent: string
): void {
  for (const tool of tools) {
    toolRegistry.register({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: tool.parameters.properties as unknown as Record<string, ToolPropertyDefinition>,
        required: tool.parameters.required,
      },
      requiresConfirmation: tool.requiresConfirmation,
      category: 'meta',
      ownerAgent,
    });
  }
  console.info(`[registry] Registered ${tools.length} meta-tool(s) for ${ownerAgent}`);
}

/**
 * Register which tools an agent can access.
 * Called once per agent during setup.
 */
export function registerAgentTools(agentName: string, toolNames: string[]): void {
  toolRegistry.grantAccessAll(agentName, toolNames);
}

// ============================================
// BACKWARD-COMPATIBLE API
// ============================================

/**
 * Normalize tool names to canonical registry format.
 * Legacy dotted names like "fs.listFiles" are converted to "fs_listFiles".
 */
export function normalizeToolName(name: string): string {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  if (!raw.includes('.')) return raw;
  return raw.replace(/\./g, '_');
}

/** Get tool definition by name (delegates to unified registry) */
export function getToolDefinition(name: string): ToolDef | undefined {
  const normalized = normalizeToolName(name);
  return toolRegistry.get(normalized);
}

/** Check if a tool is registered (delegates to unified registry) */
export function isToolWhitelisted(name: string): boolean {
  const normalized = normalizeToolName(name);
  return toolRegistry.has(normalized);
}

/** Check if a tool requires confirmation */
export function toolRequiresConfirmation(name: string): boolean {
  const tool = getToolDefinition(name);
  return tool?.requiresConfirmation ?? true; // Default to requiring confirmation for unknown tools
}

/** Convert all tools to LLM format (delegates to unified registry) */
export function getToolsForLLM(): LLMToolDefinition[] {
  return toolRegistry.toLLMFormat();
}
