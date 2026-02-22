import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { nanoid } from 'nanoid';
import { prepareBashExecution } from './bash.js';

const DEFAULT_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
const MAX_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const IDLE_SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 min without poll/write
const MAX_ACTIVE_SESSIONS = 12;
const MAX_PENDING_OUTPUT_BYTES = 256 * 1024; // 256KB
const MAX_WRITE_BYTES = 4096;
const DEFAULT_POLL_MAX_BYTES = 8192;
const MIN_POLL_MAX_BYTES = 128;
const MAX_POLL_MAX_BYTES = 65536;
const RETAIN_EXITED_SESSION_MS = 5 * 60 * 1000; // 5 min after exit

interface ExecSessionRecord {
  sessionId: string;
  process: ChildProcessWithoutNullStreams;
  command: string;
  startedAt: string;
  updatedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  terminatedReason?: string;
  allowArbitraryInput: boolean;
  pendingOutput: string;
  timeoutHandle?: NodeJS.Timeout;
  idleHandle?: NodeJS.Timeout;
  retentionHandle?: NodeJS.Timeout;
}

export interface ExecSessionStartResult {
  sessionId: string;
  status: 'running' | 'exited';
  startedAt: string;
  initialOutput: string;
  timeoutMs: number;
  allowArbitraryInput: boolean;
}

export interface ExecSessionWriteResult {
  success: boolean;
  sessionId: string;
  status: 'running' | 'exited';
  writtenBytes: number;
}

export interface ExecSessionPollResult {
  sessionId: string;
  status: 'running' | 'exited';
  output: string;
  exitCode?: number | null;
  startedAt: string;
  updatedAt: string;
  exitedAt?: string;
  terminatedReason?: string;
}

const sessions = new Map<string, ExecSessionRecord>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function safeUnref(handle?: NodeJS.Timeout): void {
  if (!handle) return;
  handle.unref?.();
}

function isSessionExited(record: ExecSessionRecord): boolean {
  return record.exitCode !== undefined || record.process.killed;
}

function clearTimer(handle?: NodeJS.Timeout): void {
  if (handle) clearTimeout(handle);
}

function dropSession(sessionId: string): void {
  const record = sessions.get(sessionId);
  if (!record) return;
  clearTimer(record.timeoutHandle);
  clearTimer(record.idleHandle);
  clearTimer(record.retentionHandle);
  sessions.delete(sessionId);
}

function appendOutput(record: ExecSessionRecord, chunk: string): void {
  if (!chunk) return;
  record.pendingOutput += chunk;
  if (Buffer.byteLength(record.pendingOutput, 'utf8') > MAX_PENDING_OUTPUT_BYTES) {
    record.pendingOutput = record.pendingOutput.slice(-MAX_PENDING_OUTPUT_BYTES);
  }
  record.updatedAt = new Date().toISOString();
}

function drainOutput(record: ExecSessionRecord, maxBytes: number): string {
  if (!record.pendingOutput) return '';
  const max = clamp(maxBytes, MIN_POLL_MAX_BYTES, MAX_POLL_MAX_BYTES);
  const buffer = Buffer.from(record.pendingOutput, 'utf8');
  if (buffer.length <= max) {
    record.pendingOutput = '';
    return buffer.toString('utf8');
  }

  const out = buffer.subarray(0, max).toString('utf8');
  record.pendingOutput = buffer.subarray(max).toString('utf8');
  return out;
}

function refreshIdleTimer(record: ExecSessionRecord): void {
  clearTimer(record.idleHandle);
  if (isSessionExited(record)) return;
  record.idleHandle = setTimeout(() => {
    if (isSessionExited(record)) return;
    appendOutput(record, '\n[session] terminated due to inactivity timeout.\n');
    record.terminatedReason = 'idle_timeout';
    record.process.kill('SIGTERM');
  }, IDLE_SESSION_TIMEOUT_MS);
  safeUnref(record.idleHandle);
}

function markExited(record: ExecSessionRecord, code: number | null): void {
  if (record.exitCode !== undefined) return;
  record.exitCode = code;
  record.exitedAt = new Date().toISOString();
  record.updatedAt = record.exitedAt;

  clearTimer(record.timeoutHandle);
  clearTimer(record.idleHandle);

  record.retentionHandle = setTimeout(() => {
    dropSession(record.sessionId);
  }, RETAIN_EXITED_SESSION_MS);
  safeUnref(record.retentionHandle);
}

function ensureCapacity(): void {
  if (sessions.size < MAX_ACTIVE_SESSIONS) return;

  for (const [sessionId, record] of sessions) {
    if (isSessionExited(record)) {
      dropSession(sessionId);
      if (sessions.size < MAX_ACTIVE_SESSIONS) return;
    }
  }

  throw new Error(`Too many active exec sessions (${MAX_ACTIVE_SESSIONS}). Poll and finish existing sessions first.`);
}

function parseCommandHead(command: string): { head: string; args: string[] } {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { head: '', args: [] };
  if (tokens[0] === '/usr/bin/env' && tokens.length > 1) {
    return { head: tokens[1].toLowerCase(), args: tokens.slice(2) };
  }
  return { head: tokens[0].toLowerCase(), args: tokens.slice(1) };
}

function assertCommandAllowedForSession(command: string): void {
  const { head, args } = parseCommandHead(command);
  if (!head) {
    throw new Error('Command must not be empty.');
  }

  if (head === 'bash' || head === 'sh' || head === 'zsh' || head === 'fish' || head === 'pwsh' || head === 'powershell') {
    throw new Error('Interactive shell startup is not allowed for devo_exec_session_start. Start a concrete command instead.');
  }

  if ((head === 'node' || head === 'python' || head === 'python3' || head === 'ruby' || head === 'perl' || head === 'irb')) {
    if (args.length === 0 || args.includes('-i')) {
      throw new Error(`Interactive REPL startup (${head}) is not allowed for devo_exec_session_start.`);
    }
  }
}

export async function devoExecSessionStart(
  command: string,
  options?: {
    cwd?: string;
    timeoutMs?: number;
    allowArbitraryInput?: boolean;
  },
): Promise<ExecSessionStartResult> {
  ensureCapacity();
  const trimmed = String(command || '').trim();
  if (!trimmed) {
    throw new Error('command is required');
  }
  assertCommandAllowedForSession(trimmed);

  const requestedTimeout = options?.timeoutMs;
  if (requestedTimeout !== undefined && (!Number.isFinite(requestedTimeout) || requestedTimeout < 1000)) {
    throw new Error('timeoutMs must be at least 1000 milliseconds.');
  }
  if (requestedTimeout !== undefined && requestedTimeout > MAX_SESSION_TIMEOUT_MS) {
    throw new Error(`timeoutMs exceeds maximum (${MAX_SESSION_TIMEOUT_MS}ms).`);
  }

  const prepared = await prepareBashExecution(trimmed, {
    cwd: options?.cwd,
    timeout: requestedTimeout,
    defaultTimeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
    requireDevServerCommandTimeoutWrapper: false,
    devServerMaxTimeoutMs: MAX_SESSION_TIMEOUT_MS,
  });

  const child = spawn('bash', ['-lc', trimmed], {
    cwd: prepared.runtimeCwd,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const sessionId = nanoid();
  const startedAt = new Date().toISOString();
  const record: ExecSessionRecord = {
    sessionId,
    process: child,
    command: trimmed,
    startedAt,
    updatedAt: startedAt,
    allowArbitraryInput: options?.allowArbitraryInput === true,
    pendingOutput: '',
  };

  child.stdout.on('data', (chunk: Buffer | string) => {
    appendOutput(record, chunk.toString());
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    appendOutput(record, chunk.toString());
  });
  child.on('error', (err) => {
    appendOutput(record, `\n[session-error] ${err.message}\n`);
    if (!record.terminatedReason) {
      record.terminatedReason = 'spawn_error';
    }
  });
  child.on('exit', (code) => {
    markExited(record, code);
  });

  record.timeoutHandle = setTimeout(() => {
    if (isSessionExited(record)) return;
    appendOutput(record, '\n[session] terminated due to command timeout.\n');
    record.terminatedReason = 'command_timeout';
    record.process.kill('SIGTERM');
  }, prepared.timeout);
  safeUnref(record.timeoutHandle);

  sessions.set(sessionId, record);
  refreshIdleTimer(record);

  // Allow immediate startup output/errors to arrive.
  await delay(30);

  return {
    sessionId,
    status: isSessionExited(record) ? 'exited' : 'running',
    startedAt: record.startedAt,
    initialOutput: drainOutput(record, DEFAULT_POLL_MAX_BYTES),
    timeoutMs: prepared.timeout,
    allowArbitraryInput: record.allowArbitraryInput,
  };
}

export async function devoExecSessionWrite(
  sessionId: string,
  input: string,
): Promise<ExecSessionWriteResult> {
  const record = sessions.get(String(sessionId || ''));
  if (!record) {
    throw new Error(`Unknown exec session: ${sessionId}`);
  }

  if (isSessionExited(record)) {
    return {
      success: false,
      sessionId: record.sessionId,
      status: 'exited',
      writtenBytes: 0,
    };
  }

  const payload = String(input ?? '');
  const bytes = Buffer.byteLength(payload, 'utf8');
  if (bytes === 0) {
    return {
      success: true,
      sessionId: record.sessionId,
      status: 'running',
      writtenBytes: 0,
    };
  }
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`Input too large (${bytes} bytes). Max ${MAX_WRITE_BYTES} bytes.`);
  }

  if (!record.allowArbitraryInput && /[^\x00-\x1F\x7F\s]/.test(payload)) {
    throw new Error(
      'This session only accepts control/whitespace input. Start a new session with allowArbitraryInput=true to send arbitrary text.',
    );
  }

  await new Promise<void>((resolve, reject) => {
    record.process.stdin.write(payload, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  record.updatedAt = new Date().toISOString();
  refreshIdleTimer(record);

  return {
    success: true,
    sessionId: record.sessionId,
    status: 'running',
    writtenBytes: bytes,
  };
}

export async function devoExecSessionPoll(
  sessionId: string,
  options?: { maxBytes?: number },
): Promise<ExecSessionPollResult> {
  const record = sessions.get(String(sessionId || ''));
  if (!record) {
    throw new Error(`Unknown exec session: ${sessionId}`);
  }

  const output = drainOutput(record, options?.maxBytes ?? DEFAULT_POLL_MAX_BYTES);
  refreshIdleTimer(record);

  return {
    sessionId: record.sessionId,
    status: isSessionExited(record) ? 'exited' : 'running',
    output,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    exitedAt: record.exitedAt,
    terminatedReason: record.terminatedReason,
  };
}

export function resetExecSessionsForTests(): void {
  for (const [, record] of sessions) {
    clearTimer(record.timeoutHandle);
    clearTimer(record.idleHandle);
    clearTimer(record.retentionHandle);
    if (!isSessionExited(record)) {
      record.process.kill('SIGKILL');
    }
  }
  sessions.clear();
}
