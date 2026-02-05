/**
 * MCP Manager
 *
 * Manages all MCP server connections, discovers tools, and bridges them
 * into Devai's tool system.
 */

import { McpClient } from './client.js';
import { loadMcpConfig } from './config.js';
import type { McpServerConfig } from './config.js';
import type { McpToolInfo } from './client.js';
import type { ToolDefinition } from '../tools/registry.js';
import type { ToolExecutionResult } from '../tools/executor.js';

interface McpToolMapping {
  /** Prefixed tool name used in Devai (e.g. "mcp_serena_find_symbol") */
  prefixedName: string;
  /** Original tool name on the MCP server */
  originalName: string;
  /** Which MCP server this tool belongs to */
  serverName: string;
}

const MCP_TOOL_TIMEOUT_MS = 30000; // 30 second timeout for MCP tool calls

class McpManager {
  private clients: Map<string, McpClient> = new Map();
  private serverConfigs: Map<string, McpServerConfig> = new Map();
  private toolMappings: Map<string, McpToolMapping> = new Map();
  private toolDefinitions: ToolDefinition[] = [];
  private agentToolAccess: Map<string, string[]> = new Map(); // agent -> prefixed tool names
  private initialized = false;

  /**
   * Initialize all configured MCP servers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const config = loadMcpConfig();

    if (config.mcpServers.length === 0) {
      console.info('[mcp] No MCP servers configured');
      this.initialized = true;
      return;
    }

    for (const serverConfig of config.mcpServers) {
      try {
        await this.connectServer(serverConfig);
      } catch (error) {
        console.error(`[mcp] Failed to connect to "${serverConfig.name}":`, error);
      }
    }

    this.initialized = true;
    console.info(`[mcp] Initialized: ${this.clients.size} server(s), ${this.toolDefinitions.length} tool(s)`);
  }

  /**
   * Connect to a single MCP server and discover its tools
   */
  private async connectServer(serverConfig: McpServerConfig): Promise<void> {
    const client = new McpClient(serverConfig);
    await client.connect();

    this.clients.set(serverConfig.name, client);
    this.serverConfigs.set(serverConfig.name, serverConfig);

    // Discover tools
    const tools = await client.listTools();
    console.info(`[mcp:${serverConfig.name}] Discovered ${tools.length} tool(s)`);

    const requiresConfirmation = serverConfig.requiresConfirmation ?? true;

    for (const tool of tools) {
      const prefixedName = `mcp_${serverConfig.toolPrefix}_${tool.name}`;

      // Store mapping
      this.toolMappings.set(prefixedName, {
        prefixedName,
        originalName: tool.name,
        serverName: serverConfig.name,
      });

      // Convert to Devai ToolDefinition
      const toolDef: ToolDefinition = {
        name: prefixedName as ToolDefinition['name'],
        description: `[${serverConfig.name}] ${tool.description}`,
        parameters: {
          type: 'object',
          properties: this.convertProperties(tool.inputSchema.properties || {}),
          required: tool.inputSchema.required,
        },
        requiresConfirmation,
      };

      this.toolDefinitions.push(toolDef);

      // Track per-agent access
      for (const agent of serverConfig.enabledForAgents) {
        if (!this.agentToolAccess.has(agent)) {
          this.agentToolAccess.set(agent, []);
        }
        this.agentToolAccess.get(agent)!.push(prefixedName);
      }
    }
  }

  /**
   * Convert MCP JSON Schema properties to Devai's simpler format
   */
  private convertProperties(
    props: Record<string, unknown>
  ): Record<string, { type: string; description: string }> {
    const result: Record<string, { type: string; description: string }> = {};

    for (const [key, value] of Object.entries(props)) {
      const prop = value as { type?: string; description?: string };
      result[key] = {
        type: prop.type || 'string',
        description: prop.description || '',
      };
    }

    return result;
  }

  /**
   * Get all MCP tool definitions (for merging into registry)
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.toolDefinitions;
  }

  /**
   * Get MCP tool names available to a specific agent
   */
  getToolsForAgent(agentName: string): string[] {
    return this.agentToolAccess.get(agentName) || [];
  }

  /**
   * Check if a tool name is an MCP tool
   */
  isMcpTool(toolName: string): boolean {
    return this.toolMappings.has(toolName);
  }

  /**
   * Execute an MCP tool with timeout and auto-reconnect
   */
  async executeTool(
    prefixedName: string,
    args: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    const mapping = this.toolMappings.get(prefixedName);
    if (!mapping) {
      return {
        success: false,
        error: `Unknown MCP tool: ${prefixedName}`,
      };
    }

    let client = this.clients.get(mapping.serverName);

    // Auto-reconnect if not connected
    if (!client || !client.isConnected()) {
      const serverConfig = this.serverConfigs.get(mapping.serverName);
      if (serverConfig) {
        console.info(`[mcp:${mapping.serverName}] Attempting auto-reconnect...`);
        try {
          const newClient = new McpClient(serverConfig);
          await newClient.connect();
          this.clients.set(mapping.serverName, newClient);
          client = newClient;
          console.info(`[mcp:${mapping.serverName}] Auto-reconnect successful`);
        } catch (reconnectError) {
          console.error(`[mcp:${mapping.serverName}] Auto-reconnect failed:`, reconnectError);
          return {
            success: false,
            error: `MCP server "${mapping.serverName}" is not connected and reconnect failed`,
          };
        }
      } else {
        return {
          success: false,
          error: `MCP server "${mapping.serverName}" is not connected`,
        };
      }
    }

    const start = Date.now();

    try {
      // Execute with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`MCP tool call timed out after ${MCP_TOOL_TIMEOUT_MS}ms`)), MCP_TOOL_TIMEOUT_MS);
      });

      const result = await Promise.race([
        client.callTool(mapping.originalName, args),
        timeoutPromise,
      ]);

      return {
        success: !result.isError,
        result: result.content,
        error: result.isError ? result.content : undefined,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'MCP tool execution failed';
      console.error(`[mcp:${mapping.serverName}] Tool "${mapping.originalName}" failed:`, errorMessage);
      return {
        success: false,
        error: errorMessage,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Get connection status for all MCP servers
   */
  getServerStatus(): Record<string, { connected: boolean; toolCount: number }> {
    const status: Record<string, { connected: boolean; toolCount: number }> = {};

    for (const [name, client] of this.clients.entries()) {
      const toolCount = Array.from(this.toolMappings.values())
        .filter((m) => m.serverName === name).length;
      status[name] = {
        connected: client.isConnected(),
        toolCount,
      };
    }

    return status;
  }

  /**
   * Get status of all configured MCP servers for health endpoint
   */
  getStatus(): Array<{ name: string; status: string; toolCount: number; error?: string }> {
    const result: Array<{ name: string; status: string; toolCount: number; error?: string }> = [];

    for (const [name, serverConfig] of this.serverConfigs.entries()) {
      const client = this.clients.get(name);
      const toolCount = Array.from(this.toolMappings.values())
        .filter((m) => m.serverName === name).length;

      if (!client) {
        result.push({
          name,
          status: 'error',
          toolCount: 0,
          error: 'Client not initialized',
        });
      } else if (client.isConnected()) {
        result.push({
          name,
          status: 'connected',
          toolCount,
        });
      } else {
        result.push({
          name,
          status: 'disconnected',
          toolCount,
        });
      }
    }

    return result;
  }

  /**
   * Gracefully disconnect all MCP servers
   */
  async shutdown(): Promise<void> {
    console.info('[mcp] Shutting down...');

    const disconnects = Array.from(this.clients.values()).map((client) =>
      client.disconnect()
    );

    await Promise.allSettled(disconnects);

    this.clients.clear();
    this.serverConfigs.clear();
    this.toolMappings.clear();
    this.toolDefinitions = [];
    this.agentToolAccess.clear();
    this.initialized = false;

    console.info('[mcp] Shutdown complete');
  }
}

export const mcpManager = new McpManager();
