/**
 * Bash Tool
 *
 * Executes bash commands locally with safety checks.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

  // Safety check
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Gefährlicher Befehl blockiert: ${command}`);
    }
  }

  const timeout = options?.timeout || TIMEOUT_MS;

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: options?.cwd,
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
