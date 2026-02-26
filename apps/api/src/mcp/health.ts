/**
 * MCP Health Monitor
 *
 * Periodically checks MCP server connections and auto-reconnects
 * disconnected servers. Run on a configurable interval (default 60s).
 */

import type { McpManager } from './manager.js';

export interface McpServerHealth {
  name: string;
  connected: boolean;
  toolCount: number;
  lastError?: string;
  lastCheckAt: string;
}

const DEFAULT_INTERVAL_MS = 60_000;

let healthInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the auto-reconnect health loop.
 * Checks all configured servers and reconnects any that dropped.
 */
export function startHealthMonitor(
  manager: McpManager,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  if (healthInterval) return; // Already running

  console.info(`[mcp:health] Starting health monitor (interval: ${intervalMs / 1000}s)`);

  healthInterval = setInterval(async () => {
    await autoReconnect(manager);
  }, intervalMs);

  // Don't prevent process exit
  if (healthInterval.unref) healthInterval.unref();
}

/**
 * Stop the health monitor.
 */
export function stopHealthMonitor(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
    console.info('[mcp:health] Health monitor stopped');
  }
}

/**
 * Run a single reconnection pass over all disconnected servers.
 */
export async function autoReconnect(manager: McpManager): Promise<void> {
  const status = manager.getServerStatus();

  for (const [name, info] of Object.entries(status)) {
    if (info.connected) continue;

    console.info(`[mcp:health] Auto-reconnecting "${name}"...`);
    try {
      await manager.reconnectServer(name);
      console.info(`[mcp:health] Reconnected "${name}" successfully`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mcp:health] Reconnect failed for "${name}": ${msg}`);
    }
  }
}

/**
 * Get health status for all MCP servers.
 */
export function getMcpHealth(manager: McpManager): McpServerHealth[] {
  const status = manager.getServerStatus();
  const now = new Date().toISOString();

  return Object.entries(status).map(([name, info]) => ({
    name,
    connected: info.connected,
    toolCount: info.toolCount,
    lastCheckAt: now,
  }));
}
