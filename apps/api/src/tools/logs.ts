import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { config } from '../config.js';

const DEFAULT_LOG_PATH = './var/staging.log';
const DEFAULT_LINES = 200;

export interface StagingLogsResult {
  lines: string[];
  totalLines: number;
  logPath: string;
}

export async function getStagingLogs(lines: number = DEFAULT_LINES, projectPath?: string): Promise<StagingLogsResult> {
  if (!projectPath) {
    throw new Error('Project path is required for log access');
  }

  // Validate project path is within allowed roots
  const normalizedPath = resolve(projectPath);
  const isAllowed = config.allowedRoots.some((root) => {
    const absoluteRoot = resolve(root);
    return normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot;
  });

  if (!isAllowed) {
    throw new Error(`Access denied: Path must be within ${config.allowedRoots.join(' or ')}`);
  }

  const logPath = resolve(normalizedPath, DEFAULT_LOG_PATH);

  try {
    await stat(logPath);
  } catch {
    // Log file doesn't exist - return placeholder message
    return {
      lines: ['[Staging logs not available - log file does not exist]'],
      totalLines: 1,
      logPath: DEFAULT_LOG_PATH,
    };
  }

  const content = await readFile(logPath, 'utf-8');
  const allLines = content.split('\n').filter((line) => line.trim());
  const totalLines = allLines.length;

  // Get the last N lines
  const requestedLines = Math.min(lines, totalLines);
  const resultLines = allLines.slice(-requestedLines);

  return {
    lines: resultLines,
    totalLines,
    logPath: DEFAULT_LOG_PATH,
  };
}
