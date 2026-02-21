/**
 * PM2 Tool
 *
 * Manages PM2 processes on remote servers (primarily Baso).
 */

import { executeSSH } from './ssh.js';

// Default server where PM2 runs
const DEFAULT_PM2_HOST = 'baso';

const VALID_PROCESS_NAME = /^[a-zA-Z0-9_-]+$/;

function validateProcessName(name: string): string {
  if (!VALID_PROCESS_NAME.test(name)) {
    throw new Error(`Invalid PM2 process name: "${name}". Only alphanumeric, dash, and underscore allowed.`);
  }
  return name;
}

export interface PM2Process {
  name: string;
  id: number;
  mode: string;
  pid: number;
  status: string;
  restart: number;
  uptime: string;
  cpu: string;
  mem: string;
}

export interface PM2StatusResult {
  processes: PM2Process[];
  host: string;
}

export interface PM2LogsResult {
  processName: string;
  lines: string[];
  host: string;
}

export interface PM2RestartResult {
  processName: string;
  success: boolean;
  message: string;
  host: string;
}

/**
 * Get PM2 process status
 */
export async function pm2Status(
  host: string = DEFAULT_PM2_HOST
): Promise<PM2StatusResult> {
  const result = await executeSSH(host, 'pm2 jlist', { timeout: 15000 });

  if (result.exitCode !== 0) {
    throw new Error(`PM2 status Fehler: ${result.stderr}`);
  }

  try {
    const processes = JSON.parse(result.stdout);
    return {
      processes: processes.map((p: {
        name?: string;
        pm_id?: number;
        pid?: number;
        pm2_env?: {
          exec_mode?: string;
          status?: string;
          restart_time?: number;
          pm_uptime?: number;
        };
        monit?: {
          cpu?: number;
          memory?: number;
        };
      }) => ({
        name: p.name || 'unknown',
        id: p.pm_id || 0,
        mode: p.pm2_env?.exec_mode || 'unknown',
        pid: p.pid || 0,
        status: p.pm2_env?.status || 'unknown',
        restart: p.pm2_env?.restart_time || 0,
        uptime: formatUptime(p.pm2_env?.pm_uptime),
        cpu: `${p.monit?.cpu || 0}%`,
        mem: formatMemory(p.monit?.memory),
      })),
      host,
    };
  } catch {
    // Fallback to text parsing if JSON fails
    const textResult = await executeSSH(host, 'pm2 status', { timeout: 15000 });
    throw new Error(`PM2 Status:\n${textResult.stdout}`);
  }
}

/**
 * Restart a PM2 process
 */
export async function pm2Restart(
  processName: string,
  host: string = DEFAULT_PM2_HOST
): Promise<PM2RestartResult> {
  processName = validateProcessName(processName);
  const result = await executeSSH(host, `pm2 restart ${processName}`, {
    timeout: 30000,
  });

  return {
    processName,
    success: result.exitCode === 0,
    message: result.exitCode === 0
      ? `Prozess ${processName} erfolgreich neugestartet`
      : `Fehler beim Neustart: ${result.stderr}`,
    host,
  };
}

/**
 * Stop a PM2 process
 */
export async function pm2Stop(
  processName: string,
  host: string = DEFAULT_PM2_HOST
): Promise<PM2RestartResult> {
  processName = validateProcessName(processName);
  const result = await executeSSH(host, `pm2 stop ${processName}`, {
    timeout: 15000,
  });

  return {
    processName,
    success: result.exitCode === 0,
    message: result.exitCode === 0
      ? `Prozess ${processName} gestoppt`
      : `Fehler beim Stoppen: ${result.stderr}`,
    host,
  };
}

/**
 * Start a PM2 process
 */
export async function pm2Start(
  processName: string,
  host: string = DEFAULT_PM2_HOST
): Promise<PM2RestartResult> {
  processName = validateProcessName(processName);
  const result = await executeSSH(host, `pm2 start ${processName}`, {
    timeout: 15000,
  });

  return {
    processName,
    success: result.exitCode === 0,
    message: result.exitCode === 0
      ? `Prozess ${processName} gestartet`
      : `Fehler beim Starten: ${result.stderr}`,
    host,
  };
}

/**
 * Get PM2 logs for a process
 */
export async function pm2Logs(
  processName: string,
  lines: number = 50,
  host: string = DEFAULT_PM2_HOST
): Promise<PM2LogsResult> {
  processName = validateProcessName(processName);
  if (!Number.isInteger(lines) || lines < 1 || lines > 5000) {
    throw new Error(`Invalid lines parameter: ${lines}. Must be integer 1-5000.`);
  }
  const result = await executeSSH(
    host,
    `pm2 logs ${processName} --lines ${lines} --nostream`,
    { timeout: 15000 }
  );

  return {
    processName,
    lines: result.stdout.split('\n').filter((line) => line.trim()),
    host,
  };
}

/**
 * Reload all PM2 processes
 */
export async function pm2ReloadAll(
  host: string = DEFAULT_PM2_HOST
): Promise<PM2RestartResult> {
  const result = await executeSSH(host, 'pm2 reload all', { timeout: 60000 });

  return {
    processName: 'all',
    success: result.exitCode === 0,
    message: result.exitCode === 0
      ? 'Alle Prozesse erfolgreich neugeladen'
      : `Fehler beim Neuladen: ${result.stderr}`,
    host,
  };
}

/**
 * Save PM2 process list
 */
export async function pm2Save(
  host: string = DEFAULT_PM2_HOST
): Promise<{ success: boolean; message: string }> {
  const result = await executeSSH(host, 'pm2 save', { timeout: 15000 });

  return {
    success: result.exitCode === 0,
    message: result.exitCode === 0
      ? 'PM2 Prozessliste gespeichert'
      : `Fehler beim Speichern: ${result.stderr}`,
  };
}

/**
 * Format uptime from milliseconds timestamp
 */
function formatUptime(timestamp: number | undefined): string {
  if (!timestamp) return 'unknown';

  const now = Date.now();
  const uptime = now - timestamp;

  const seconds = Math.floor(uptime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format memory from bytes
 */
function formatMemory(bytes: number | undefined): string {
  if (!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
