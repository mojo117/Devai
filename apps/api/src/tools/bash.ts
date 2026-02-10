/**
 * Bash Tool
 *
 * Executes bash commands locally with safety checks.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { config } from '../config.js';
import { toCanonicalPath, toRuntimePath } from '../utils/pathMapping.js';

const execAsync = promisify(exec);

// DeviSpace ephemeral dev-server ports on Klyde.
// Keep this range small and explicit, and match UFW rules on Klyde.
const DEVSERVER_PORT_MIN = 8090;
const DEVSERVER_PORT_MAX = 8095;
const DEVSERVER_MAX_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// Maximum execution time (15 seconds)
const TIMEOUT_MS = 15000;

// Maximum output size (100KB)
const MAX_OUTPUT_SIZE = 100 * 1024;

// Dangerous commands that should never be executed
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(?!opt)/i, // rm -rf / (but allow /opt)
  /rm\s+-rf\s+~/, // rm -rf ~
  /mkfs/, // Format filesystem
  /dd\s+if=.*of=\/dev/, // Write to devices
  />\s*\/dev\/sd/, // Write to disk devices
  /chmod\s+-R\s+777\s+\//, // chmod 777 /
  /:(){ :|:& };:/, // Fork bomb
];

export interface BashResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

/**
 * Execute a bash command
 */
export async function executeBash(
  command: string,
  options?: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  }
): Promise<BashResult> {
  const startTime = Date.now();

  const isDevServerCommand =
    /\bnpm\s+run\s+dev\b/.test(command) ||
    /\b(vite|next)\s+dev\b/.test(command) ||
    /\bpython3?\s+-m\s+http\.server\b/.test(command);

  const extractedPort = extractPort(command);
  if (isDevServerCommand) {
    if (extractedPort == null) {
      throw new Error(
        `Dev server must specify a port within ${DEVSERVER_PORT_MIN}-${DEVSERVER_PORT_MAX} (e.g. --port ${DEVSERVER_PORT_MIN}).`
      );
    }
    if (extractedPort < DEVSERVER_PORT_MIN || extractedPort > DEVSERVER_PORT_MAX) {
      throw new Error(`Dev server port must be within ${DEVSERVER_PORT_MIN}-${DEVSERVER_PORT_MAX}. Got ${extractedPort}.`);
    }
    if (!/\btimeout\b/.test(command)) {
      throw new Error(`Dev server commands must be wrapped in "timeout" (e.g. timeout 10m npm run dev -- --host 0.0.0.0 --port ${extractedPort}).`);
    }
  }

  // DevAI safety: restrict bash to allowedRoots (currently DeviSpace only).
  // This prevents accidental self-modification of the Devai repo via shell commands.
  const canonicalAllowedRoots = config.allowedRoots.map((r) => resolve(r));
  const assertAllowedPath = (p: string) => {
    const canonical = toCanonicalPath(resolve(p));
    const ok = canonicalAllowedRoots.some((root) => canonical === root || canonical.startsWith(root + '/'));
    if (!ok) {
      throw new Error(`Access denied: cwd must be within allowed roots: ${canonicalAllowedRoots.join(' or ')}`);
    }
  };

  // Block obvious references to other project roots in the command string.
  // This is intentionally blunt: DevAI is only allowed to work inside DeviSpace.
  const disallowProjectPath = (prefix: string, allowedSuffix: string) => {
    if (command.includes(prefix) && !command.includes(allowedSuffix)) {
      throw new Error(`Access denied: command references paths outside allowed roots`);
    }
  };
  disallowProjectPath('/opt/Klyde/projects/', '/opt/Klyde/projects/DeviSpace');
  disallowProjectPath('/mnt/klyde-projects/', '/mnt/klyde-projects/DeviSpace');

  // Safety check
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Gefährlicher Befehl blockiert: ${command}`);
    }
  }

  const timeout = options?.timeout || TIMEOUT_MS;
  if (isDevServerCommand) {
    if (timeout > DEVSERVER_MAX_TIMEOUT_MS) {
      throw new Error(`Dev server timeout too long. Max ${DEVSERVER_MAX_TIMEOUT_MS}ms.`);
    }
  }
  const canonicalCwd = options?.cwd || config.allowedRoots[0];
  if (canonicalCwd) {
    assertAllowedPath(canonicalCwd);
  }
  const runtimeCwd = canonicalCwd ? await toRuntimePath(canonicalCwd) : undefined;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: runtimeCwd,
      timeout,
      maxBuffer: MAX_OUTPUT_SIZE,
      env: {
        ...process.env,
        ...options?.env,
      },
    });

    return {
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
      throw new Error(`Befehl wurde nach ${timeout}ms abgebrochen (Timeout)`);
    }

    return {
      command,
      stdout: truncateOutput(execError.stdout || ''),
      stderr: truncateOutput(execError.stderr || (error as Error).message),
      exitCode: execError.code || 1,
      duration: Date.now() - startTime,
    };
  }
}

function extractPort(command: string): number | null {
  // Common patterns for dev servers.
  const patterns: RegExp[] = [
    /--port=(\d{2,5})\b/,
    /--port\s+(\d{2,5})\b/,
    /\bPORT=(\d{2,5})\b/,
    /\b-p\s+(\d{2,5})\b/,
  ];
  for (const re of patterns) {
    const m = command.match(re);
    if (m && m[1]) return Number(m[1]);
  }
  return null;
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
 * Execute npm command
 */
export async function executeNpm(
  args: string,
  cwd?: string
): Promise<BashResult> {
  return executeBash(`npm ${args}`, { cwd });
}

/**
 * Execute npm install
 */
export async function npmInstall(
  packageName?: string,
  cwd?: string
): Promise<BashResult> {
  const command = packageName ? `npm install ${packageName}` : 'npm install';
  return executeBash(command, { cwd, timeout: 120000 }); // 2 min timeout for install
}

/**
 * Execute npm run script
 */
export async function npmRun(
  script: string,
  cwd?: string
): Promise<BashResult> {
  return executeBash(`npm run ${script}`, { cwd, timeout: 300000 }); // 5 min timeout
}
