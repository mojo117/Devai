/**
 * Permission Pattern Checker
 *
 * Checks if tool calls match granted permission patterns.
 * Patterns are stored in the settings table as JSON.
 */

import { nanoid } from 'nanoid';
import { getSetting, setSetting, getTrustMode } from '../db/queries.js';
import { getToolDefinition } from '../tools/registry.js';
import { shouldRequireConfirmation } from '../config/trust.js';
import type {
  PermissionPattern,
  PermissionCheckResult,
  CreatePatternParams,
} from '../types/permissions.js';

const SETTING_KEY = 'permission_patterns';

/**
 * Simple glob-like pattern matching.
 * Supports:
 * - "*" matches any sequence of characters
 * - "?" matches any single character
 */
function matchGlob(pattern: string, text: string): boolean {
  // Convert glob to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\*/g, '.*')                   // * -> .*
    .replace(/\?/g, '.');                   // ? -> .

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(text);
}

/**
 * Get all permission patterns for a user.
 */
export async function getPermissionPatterns(userId?: string): Promise<PermissionPattern[]> {
  const raw = await getSetting(SETTING_KEY, userId);
  if (!raw) return [];

  try {
    const patterns = JSON.parse(raw) as PermissionPattern[];

    // Filter out expired patterns
    const now = new Date().toISOString();
    return patterns.filter(p => !p.expiresAt || p.expiresAt > now);
  } catch {
    console.error('[permissions] Failed to parse permission patterns');
    return [];
  }
}

/**
 * Add a new permission pattern.
 */
export async function addPermissionPattern(
  params: CreatePatternParams,
  userId?: string
): Promise<PermissionPattern> {
  const patterns = await getPermissionPatterns(userId);

  const newPattern: PermissionPattern = {
    id: nanoid(),
    toolName: params.toolName,
    argPattern: params.argPattern,
    granted: params.granted ?? true,
    createdAt: new Date().toISOString(),
    expiresAt: params.expiresAt,
    description: params.description,
  };

  patterns.push(newPattern);
  await setSetting(SETTING_KEY, JSON.stringify(patterns), userId);

  return newPattern;
}

/**
 * Remove a permission pattern by ID.
 */
export async function removePermissionPattern(
  patternId: string,
  userId?: string
): Promise<boolean> {
  const patterns = await getPermissionPatterns(userId);
  const index = patterns.findIndex(p => p.id === patternId);

  if (index === -1) return false;

  patterns.splice(index, 1);
  await setSetting(SETTING_KEY, JSON.stringify(patterns), userId);

  return true;
}

/**
 * Clear all permission patterns.
 */
export async function clearPermissionPatterns(userId?: string): Promise<void> {
  await setSetting(SETTING_KEY, JSON.stringify([]), userId);
}

/**
 * Build a matchable string from tool arguments.
 * This is tool-specific to enable intuitive pattern matching.
 */
function buildArgString(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'bash_execute':
      return (args.command as string) || '';

    case 'ssh_execute':
      return `${args.host || ''}:${args.command || ''}`;

    case 'fs_edit':
    case 'fs_writeFile':
    case 'fs_readFile':
    case 'fs_delete':
    case 'fs_mkdir':
      return (args.path as string) || '';

    case 'fs_move':
      return `${args.source || ''} -> ${args.destination || ''}`;

    case 'git_commit':
      return (args.message as string) || '';

    case 'git_push':
    case 'git_pull':
      return `${args.remote || 'origin'}/${args.branch || ''}`;

    case 'npm_run':
      return (args.script as string) || '';

    case 'npm_install':
      return (args.packages as string[])?.join(' ') || '';

    case 'pm2_restart':
    case 'pm2_stop':
    case 'pm2_start':
      return (args.processName as string) || '';

    case 'github_triggerWorkflow':
      return (args.workflow as string) || '';

    default:
      // Default: stringify all args
      return JSON.stringify(args);
  }
}

/**
 * Check if a pattern matches a tool call.
 */
function matchesPattern(
  pattern: PermissionPattern,
  toolName: string,
  args: Record<string, unknown>
): boolean {
  // Check tool name match (supports wildcards)
  if (pattern.toolName !== '*' && !matchGlob(pattern.toolName, toolName)) {
    return false;
  }

  // If no arg pattern, tool name match is sufficient
  if (!pattern.argPattern) {
    return true;
  }

  // Match arg pattern
  const argString = buildArgString(toolName, args);
  return matchGlob(pattern.argPattern, argString);
}

/**
 * Check if a tool call is permitted by any pattern.
 * Returns whether the tool requires confirmation.
 */
export async function checkPermission(
  toolName: string,
  toolArgs: Record<string, unknown>,
  userId?: string
): Promise<PermissionCheckResult> {
  // First check if tool even requires confirmation
  const toolDef = getToolDefinition(toolName);
  if (!toolDef?.requiresConfirmation) {
    return {
      allowed: true,
      requiresConfirmation: false,
      reason: 'Tool does not require confirmation',
    };
  }

  const patterns = await getPermissionPatterns(userId);
  for (const pattern of patterns) {
    if (matchesPattern(pattern, toolName, toolArgs)) {
      if (pattern.granted) {
        return {
          allowed: true,
          matchedPattern: pattern,
          requiresConfirmation: false,
          reason: `Matched permission pattern: ${pattern.description || pattern.id}`,
        };
      } else {
        // Explicitly denied
        return {
          allowed: false,
          matchedPattern: pattern,
          requiresConfirmation: true,
          reason: `Denied by pattern: ${pattern.description || pattern.id}`,
        };
      }
    }
  }

  // No pattern matched - apply trust mode policy.
  const trustMode = await getTrustMode();
  const trustDecision = shouldRequireConfirmation(
    toolName,
    toolArgs,
    trustMode,
    true
  );

  return {
    allowed: true,
    requiresConfirmation: trustDecision.requiresConfirmation,
    reason: trustDecision.reason || `No matching permission pattern (trust mode: ${trustMode})`,
  };
}

/**
 * Format a permission pattern for display.
 */
export function formatPattern(pattern: PermissionPattern): string {
  let result = pattern.toolName;
  if (pattern.argPattern) {
    result += `(${pattern.argPattern})`;
  }
  if (!pattern.granted) {
    result = `DENY: ${result}`;
  }
  return result;
}
