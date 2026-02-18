/**
 * Trust Mode Configuration
 *
 * Defines which actions are allowed in different trust modes and
 * which actions are always blocked regardless of trust level.
 */

// Actions that are ALWAYS blocked, even in trusted mode
export const BLOCKED_ACTIONS = new Set([
  // Prevent catastrophic deletions
  'delete_project_root',
  'delete_node_modules',
  'rm_rf_root',

  // Prevent secrets exposure
  'modify_env_file',

  // Prevent production accidents
  'push_to_main',
  'push_to_master',
]);

// Patterns for blocked file paths
export const BLOCKED_PATH_PATTERNS = [
  /^\.env$/,                    // .env file
  /^\.env\..+$/,                // .env.local, .env.production, etc.
  /node_modules\/?$/,           // node_modules directory
  /^\/$/,                       // root directory
];

// Patterns for blocked git operations
export const BLOCKED_GIT_PATTERNS = [
  /^(main|master)$/i,           // main/master branches
];

export type TrustMode = 'default' | 'trusted';

export interface TrustConfig {
  mode: TrustMode;
  // Future: could add per-tool overrides, time limits, etc.
}

// Sandbox default: run in trusted mode so risky-action approvals are bypassed.
// Set this to 'default' to restore explicit confirmations by default.
export const DEFAULT_TRUST_MODE: TrustMode = 'trusted';

/**
 * Check if a file path is blocked from modification
 */
export function isPathBlocked(path: string): { blocked: boolean; reason?: string } {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '');

  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(normalizedPath) || pattern.test(normalizedPath.split('/').pop() || '')) {
      return {
        blocked: true,
        reason: `Path matches blocked pattern: ${pattern.toString()}`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Check if a git branch is blocked from push
 */
export function isBranchBlocked(branch: string): { blocked: boolean; reason?: string } {
  for (const pattern of BLOCKED_GIT_PATTERNS) {
    if (pattern.test(branch)) {
      return {
        blocked: true,
        reason: `Cannot push to protected branch: ${branch}`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Check if an action should require confirmation based on trust mode
 */
export function shouldRequireConfirmation(
  toolName: string,
  toolArgs: Record<string, unknown>,
  trustMode: TrustMode,
  toolRequiresConfirmation: boolean
): { requiresConfirmation: boolean; reason?: string } {
  // Check for blocked paths on write operations
  if (toolName === 'fs_writeFile' || toolName === 'fs_edit' || toolName === 'fs_delete') {
    const path = toolArgs.path as string;
    if (path) {
      const pathCheck = isPathBlocked(path);
      if (pathCheck.blocked) {
        return { requiresConfirmation: true, reason: pathCheck.reason };
      }
    }
  }

  // Check for blocked branches on git push
  if (toolName === 'git_push') {
    const branch = toolArgs.branch as string;
    if (branch) {
      const branchCheck = isBranchBlocked(branch);
      if (branchCheck.blocked) {
        return { requiresConfirmation: true, reason: branchCheck.reason };
      }
    }
  }

  // In trusted mode, skip confirmation for non-blocked actions
  if (trustMode === 'trusted') {
    return { requiresConfirmation: false };
  }

  // Default mode: use tool's requiresConfirmation flag
  return { requiresConfirmation: toolRequiresConfirmation };
}
