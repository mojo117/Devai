import type { ToolDefinition as LLMToolDefinition } from '../llm/types.js';
import { TOOL_REGISTRY } from './nativeToolRegistry.js';
export { TOOL_REGISTRY } from './nativeToolRegistry.js';

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
  | 'devo_exec_session_start'
  | 'devo_exec_session_write'
  | 'devo_exec_session_poll'
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
  | 'scout_search_fast'
  | 'scout_search_deep'
  | 'scout_site_map'
  | 'scout_crawl_focused'
  | 'scout_extract_schema'
  | 'scout_research_bundle'
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
  | 'notify_user'
  // TaskForge Tools (CAIO)
  | 'taskforge_list_tasks'
  | 'taskforge_get_task'
  | 'taskforge_create_task'
  | 'taskforge_move_task'
  | 'taskforge_add_comment'
  | 'taskforge_search'
  // Email Tool (CAIO)
  | 'send_email'
  // Telegram Tools (CAIO)
  | 'telegram_send_document'
  // Web Document Delivery (CAIO)
  | 'deliver_document'
  // Skill Management Tools
  | 'skill_create'
  | 'skill_update'
  | 'skill_delete'
  | 'skill_reload'
  | 'skill_list';

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
