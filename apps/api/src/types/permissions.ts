/**
 * Permission Pattern Types
 *
 * Pattern-based permission system similar to Claude Code.
 * Allows granting permissions like "Bash(git *)" that persist
 * and skip per-tool confirmation.
 */

export interface PermissionPattern {
  id: string;
  toolName: string;        // Tool name (e.g., "bash_execute") or "*" for all
  argPattern?: string;     // Glob pattern for args (e.g., "git *", "/opt/Klyde/*")
  granted: boolean;        // Whether this pattern grants or denies permission
  createdAt: string;       // ISO timestamp
  expiresAt?: string;      // Optional expiration (ISO timestamp)
  description?: string;    // Human-readable description
}

export interface PermissionCheckResult {
  allowed: boolean;
  matchedPattern?: PermissionPattern;
  requiresConfirmation: boolean;
  reason?: string;
}

export interface CreatePatternParams {
  toolName: string;
  argPattern?: string;
  granted?: boolean;       // Default: true
  expiresAt?: string;
  description?: string;
}
