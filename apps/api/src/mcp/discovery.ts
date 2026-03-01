/**
 * MCP Server Discovery
 *
 * Discovers MCP servers from workspace configuration files,
 * merging with the static global config. This allows per-project
 * MCP servers without editing the central mcp-servers.json.
 *
 * Search order:
 *   1. <projectRoot>/workspace/mcp-servers.json
 *   2. <projectRoot>/.mcp/servers.json
 *   3. <projectRoot>/.devai/mcp-servers.json
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { McpServerConfig } from './config.js';

/** Paths to probe inside a project root for workspace MCP configs. */
const WORKSPACE_CONFIG_PATHS = [
  'workspace/mcp-servers.json',
  '.mcp/servers.json',
  '.devai/mcp-servers.json',
];

/**
 * Discover MCP servers from workspace configuration.
 * Merges workspace-discovered servers with the static config,
 * skipping duplicates (static config wins on name collision).
 */
export async function discoverMcpServers(
  staticServers: McpServerConfig[],
  projectRoot: string | null,
): Promise<McpServerConfig[]> {
  const servers = [...staticServers];
  const existingNames = new Set(servers.map((s) => s.name));

  if (!projectRoot) return servers;

  const workspaceServers = await loadWorkspaceMcpConfig(projectRoot);
  for (const server of workspaceServers) {
    if (existingNames.has(server.name)) {
      console.info(`[mcp:discovery] Skipping workspace server "${server.name}" (already in static config)`);
      continue;
    }
    servers.push(server);
    existingNames.add(server.name);
    console.info(`[mcp:discovery] Discovered workspace server "${server.name}" from ${projectRoot}`);
  }

  return servers;
}

/**
 * Load MCP config from workspace paths.
 * Returns the servers from the first config file found.
 */
async function loadWorkspaceMcpConfig(projectRoot: string): Promise<McpServerConfig[]> {
  for (const relPath of WORKSPACE_CONFIG_PATHS) {
    const fullPath = join(projectRoot, relPath);
    try {
      const raw = await readFile(fullPath, 'utf-8');
      const config = JSON.parse(raw);

      // Support both { mcpServers: [...] } and { servers: [...] } formats
      const serverList = Array.isArray(config.mcpServers)
        ? config.mcpServers
        : Array.isArray(config.servers)
          ? config.servers
          : null;

      if (!serverList) continue;

      return serverList.map((s: Partial<McpServerConfig>) => ({
        name: s.name || 'unknown',
        command: s.command || 'npx',
        args: s.args || [],
        env: s.env,
        requiresConfirmation: s.requiresConfirmation ?? true,
        toolPrefix: s.toolPrefix || s.name || 'mcp',
        enabledForAgents: s.enabledForAgents || ['chapo'],
      }));
    } catch {
      // File not found or parse error — try next path
    }
  }

  return [];
}
