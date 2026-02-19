/**
 * SSH Tool
 *
 * Executes commands on remote servers via SSH.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Maximum execution time (30 seconds)
const TIMEOUT_MS = 30000;

// Maximum output size (100KB)
const MAX_OUTPUT_SIZE = 100 * 1024;

// Known hosts with their SSH configurations
const KNOWN_HOSTS: Record<string, { user: string; host: string; privateIp?: string }> = {
  baso: { user: 'root', host: '77.42.90.193', privateIp: '10.0.0.4' },
  klyde: { user: 'root', host: '46.224.197.7', privateIp: '10.0.0.2' },
  infrit: { user: 'root', host: '46.224.89.119' },
};

// Dangerous commands that should never be executed
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(?!opt)/i,
  /rm\s+-rf\s+~/,
  /mkfs/,
  /dd\s+if=.*of=\/dev/,
  /reboot/i,
  /shutdown/i,
  /halt/i,
  /init\s+0/,
];

export interface SSHResult {
  host: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

/**
 * Execute a command via SSH
 */
export async function executeSSH(
  hostOrAlias: string,
  command: string,
  options?: {
    timeout?: number;
    user?: string;
  }
): Promise<SSHResult> {
  const startTime = Date.now();

  // Safety check
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Gefährlicher Befehl blockiert: ${command}`);
    }
  }

  // Resolve host alias
  let host: string;
  let user: string;

  const knownHost = KNOWN_HOSTS[hostOrAlias.toLowerCase()];
  if (knownHost) {
    host = knownHost.privateIp || knownHost.host;
    user = options?.user || knownHost.user;
  } else {
    // Assume it's a direct host address
    host = hostOrAlias;
    user = options?.user || 'root';
  }

  const timeout = options?.timeout || TIMEOUT_MS;

  // Build SSH command
  // Using StrictHostKeyChecking=no and BatchMode=yes for non-interactive execution
  const sshCommand = `ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 ${user}@${host} '${escapeCommand(command)}'`;

  try {
    const { stdout, stderr } = await execAsync(sshCommand, {
      timeout,
      maxBuffer: MAX_OUTPUT_SIZE,
    });

    return {
      host: `${user}@${host}`,
      command,
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
      exitCode: 0,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      killed?: boolean;
      signal?: string;
    };

    // Check if it was a timeout
    if (execError.killed && execError.signal === 'SIGTERM') {
      throw new Error(`SSH Befehl wurde nach ${timeout}ms abgebrochen (Timeout)`);
    }

    return {
      host: `${user}@${host}`,
      command,
      stdout: truncateOutput(execError.stdout || ''),
      stderr: truncateOutput(execError.stderr || (error as Error).message),
      exitCode: execError.code || 1,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Escape command for SSH using single-quote wrapping to prevent shell interpretation.
 */
function escapeCommand(command: string): string {
  // Use single quotes to prevent shell interpretation.
  // Escape any single quotes within the command using the standard
  // shell idiom: end quote, escaped quote, start quote.
  return command.replace(/'/g, "'\\''");
}

/**
 * Truncate output if too long
 */
function truncateOutput(output: string): string {
  if (output.length > MAX_OUTPUT_SIZE) {
    return output.substring(0, MAX_OUTPUT_SIZE) + '\n... (output truncated)';
  }
  return output;
}

/**
 * Get available host aliases
 */
export function getKnownHosts(): string[] {
  return Object.keys(KNOWN_HOSTS);
}

/**
 * Check if a host is reachable
 */
export async function pingHost(hostOrAlias: string): Promise<boolean> {
  try {
    const result = await executeSSH(hostOrAlias, 'echo "ok"', { timeout: 10000 });
    return result.exitCode === 0 && result.stdout.trim() === 'ok';
  } catch {
    return false;
  }
}
