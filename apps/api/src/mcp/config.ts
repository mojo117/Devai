/**
 * MCP Server Configuration
 *
 * Defines the structure for MCP server connections and loads
 * the global configuration from mcp-servers.json.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface McpServerConfig {
  /** Unique name for this MCP server (e.g. "serena") */
  name: string;
  /** Command to spawn the MCP server process */
  command: string;
  /** Arguments for the command */
  args: string[];
  /** Optional environment variables for the process */
  env?: Record<string, string>;
  /** Whether all tools from this server require user confirmation (default: true) */
  requiresConfirmation?: boolean;
  /** Prefix for tool names, e.g. "serena" -> "mcp_serena_find_symbol" */
  toolPrefix: string;
  /** Which agents can use tools from this server */
  enabledForAgents: string[];
}

export interface McpConfig {
  mcpServers: McpServerConfig[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../../mcp-servers.json');

function expandEnvInString(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, key: string) => process.env[key] || '');
}

function resolveProjectPath(path: string): string {
  if (existsSync(path)) return path;
  // Fallback candidates for Clawd server
  const candidates = ['/opt/Devai', '/opt', '/root/projects'].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return path;
}

/**
 * Expand environment variable references in env config
 * Supports syntax: ${ENV_VAR_NAME}
 */
function expandEnvVars(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1);
      result[key] = process.env[envVar] || '';
    } else {
      result[key] = value;
    }
  }
  return result;
}

function rewriteArgAfterFlag(args: string[], flag: string, value: string): string[] {
  const idx = args.findIndex(a => a === flag);
  if (idx === -1) return args;
  if (idx + 1 >= args.length) return args;
  const out = [...args];
  out[idx + 1] = value;
  return out;
}

/**
 * Load MCP server configuration from mcp-servers.json
 */
export function loadMcpConfig(): McpConfig {
  if (!existsSync(CONFIG_PATH)) {
    console.info('[mcp] No mcp-servers.json found, MCP disabled');
    return { mcpServers: [] };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const config: McpConfig = JSON.parse(raw);

    if (!Array.isArray(config.mcpServers)) {
      console.warn('[mcp] Invalid mcp-servers.json: mcpServers must be an array');
      return { mcpServers: [] };
    }

    // Expand environment variables in each server config
    const expandedConfig: McpConfig = {
      mcpServers: config.mcpServers.map((server) => {
        const expandedArgs = (server.args || []).map(a => expandEnvInString(a));

        let normalizedArgs = expandedArgs;
        if (server.name === 'serena') {
          const projectIdx = normalizedArgs.findIndex(a => a === '--project');
          if (projectIdx !== -1 && projectIdx + 1 < normalizedArgs.length) {
            normalizedArgs = rewriteArgAfterFlag(normalizedArgs, '--project', resolveProjectPath(normalizedArgs[projectIdx + 1]));
          }
        }
        if (server.name === 'filesystem') {
          // Shape: ["-y", "@modelcontextprotocol/server-filesystem", <dir>...]
          const head = normalizedArgs.slice(0, 2);
          const dirs = normalizedArgs.slice(2).map(resolveProjectPath).filter(d => existsSync(d));
          normalizedArgs = dirs.length > 0 ? [...head, ...dirs] : normalizedArgs;
        }

        return {
          ...server,
          args: normalizedArgs,
          env: expandEnvVars(server.env),
        };
      }),
    };

    console.info(`[mcp] Loaded ${expandedConfig.mcpServers.length} MCP server config(s)`);
    return expandedConfig;
  } catch (error) {
    console.error('[mcp] Failed to load mcp-servers.json:', error);
    return { mcpServers: [] };
  }
}
