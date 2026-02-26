/**
 * Hook Configuration — reads and matches user-defined hooks.
 *
 * Hooks fire before/after tool executions. Users configure them
 * in workspace/hooks.json or ~/.devai/hooks.json.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

export interface HookRule {
  event: 'before:tool' | 'after:tool' | 'after:tool:error' | 'on:answer';
  toolMatch?: string;
  command: string;
  cwd?: string;
  timeout?: number;
  blocking?: boolean;
}

interface HookConfig {
  version: number;
  hooks: HookRule[];
}

const MAX_HOOK_TIMEOUT = 30_000;
const DEFAULT_HOOK_TIMEOUT = 10_000;

/** Session-scoped hook config cache */
const hookCache = new Map<string, { rules: HookRule[]; loadedAt: number }>();
const CACHE_TTL = 60_000; // 1 minute

/**
 * Load hooks from workspace/hooks.json or ~/.devai/hooks.json.
 */
export async function getHooksForSession(
  projectRoot: string | null,
): Promise<HookRule[]> {
  const cacheKey = projectRoot || 'global';
  const cached = hookCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
    return cached.rules;
  }

  const paths = [
    projectRoot ? join(projectRoot, 'workspace', 'hooks.json') : null,
    join(process.env.HOME || '/root', '.devai', 'hooks.json'),
  ].filter(Boolean) as string[];

  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf-8');
      const config: HookConfig = JSON.parse(raw);
      if (config.version !== 1) continue;
      if (!Array.isArray(config.hooks)) continue;

      const rules = config.hooks
        .filter((h): h is HookRule => h != null && typeof h.event === 'string' && typeof h.command === 'string')
        .map((h) => ({
          ...h,
          timeout: Math.min(h.timeout || DEFAULT_HOOK_TIMEOUT, MAX_HOOK_TIMEOUT),
        }));

      hookCache.set(cacheKey, { rules, loadedAt: Date.now() });
      return rules;
    } catch {
      // File not found or invalid — try next
    }
  }

  hookCache.set(cacheKey, { rules: [], loadedAt: Date.now() });
  return [];
}

/**
 * Find hooks matching a specific event and tool name.
 */
export function matchHooks(
  rules: HookRule[],
  event: HookRule['event'],
  toolName?: string,
): HookRule[] {
  return rules.filter((rule) => {
    if (rule.event !== event) return false;
    if (!rule.toolMatch) return true; // No filter = match all
    if (!toolName) return false;

    // Simple glob: "fs_*" matches "fs_writeFile"
    if (rule.toolMatch.endsWith('*')) {
      const prefix = rule.toolMatch.slice(0, -1);
      return toolName.startsWith(prefix);
    }
    return toolName === rule.toolMatch;
  });
}

/** Clear cache — used in tests */
export function clearHookCache(): void {
  hookCache.clear();
}
