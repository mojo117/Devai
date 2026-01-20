import { appendFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { saveAuditLog } from '../db/queries.js';

const AUDIT_LOG_PATH = resolve(process.cwd(), '../../var/audit.log');

interface AuditEntry {
  timestamp: string;
  user: string;
  action: string;
  [key: string]: unknown;
}

// Ensure the var directory exists
let dirCreated = false;

async function ensureDir(): Promise<void> {
  if (dirCreated) return;

  try {
    await mkdir(dirname(AUDIT_LOG_PATH), { recursive: true });
    dirCreated = true;
  } catch {
    // Directory may already exist
    dirCreated = true;
  }
}

// List of keys that should never be logged
const SENSITIVE_KEYS = [
  'api_key',
  'apikey',
  'api-key',
  'token',
  'secret',
  'password',
  'credential',
  'auth',
  'authorization',
  'bearer',
];

// Recursively sanitize an object to remove sensitive data
function sanitize(obj: unknown, depth: number = 0): unknown {
  if (depth > 10) return '[max depth]';

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Check if the string looks like a secret (long base64 or hex string)
    if (obj.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(obj)) {
      return '[redacted]';
    }
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitize(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();

    // Check if key matches any sensitive pattern
    const isSensitive = SENSITIVE_KEYS.some((pattern) => keyLower.includes(pattern));

    if (isSensitive) {
      sanitized[key] = '[redacted]';
    } else {
      sanitized[key] = sanitize(value, depth + 1);
    }
  }

  return sanitized;
}

export async function auditLog(data: Record<string, unknown>): Promise<void> {
  await ensureDir();

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    user: 'anonymous', // TODO: Add user authentication
    action: data.action as string || 'unknown',
    ...sanitize(data) as Record<string, unknown>,
  };

  const line = JSON.stringify(entry) + '\n';

  try {
    await appendFile(AUDIT_LOG_PATH, line, 'utf-8');
    await saveAuditLog(entry.action, entry);
  } catch (error) {
    // Log to console as fallback
    console.error('[Audit Log Error]', error);
    console.log('[Audit Entry]', entry);
  }
}

// Convenience function for tool execution logging
export async function logToolExecution(
  toolName: string,
  args: Record<string, unknown>,
  result: { success: boolean; result?: unknown; error?: string }
): Promise<void> {
  await auditLog({
    action: 'tool.executed',
    toolName,
    args: sanitize(args) as Record<string, unknown>,
    success: result.success,
    error: result.error,
    resultSummary: result.result ? summarizeResult(result.result) : undefined,
  });
}

function summarizeResult(result: unknown): string {
  if (result === null || result === undefined) {
    return 'null';
  }

  if (typeof result === 'string') {
    return result.length > 100 ? `${result.substring(0, 100)}...` : result;
  }

  if (typeof result === 'object') {
    const keys = Object.keys(result);
    return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`;
  }

  return String(result);
}
