/**
 * StockPulse Logger - Strukturiertes Logging
 * Schreibt in Console + Datei
 */

import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'scanner.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

function formatLog(entry: LogEntry): string {
  const ts = entry.timestamp;
  const level = entry.level.padEnd(5);
  const module = entry.module.padEnd(15);
  let line = `[${ts}] ${level} | ${module} | ${entry.message}`;
  if (entry.data) {
    line += ` | ${JSON.stringify(entry.data)}`;
  }
  return line;
}

export function log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    data,
  };
  
  const formatted = formatLog(entry);
  
  // Console output
  const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'INFO' ? 'ℹ️' : '🔍';
  console.log(`${prefix} ${message}`, data || '');
  
  // File output
  fs.appendFileSync(LOG_FILE, formatted + '\n', 'utf-8');
}

export const logger = {
  debug: (module: string, message: string, data?: Record<string, unknown>) => log('DEBUG', module, message, data),
  info: (module: string, message: string, data?: Record<string, unknown>) => log('INFO', module, message, data),
  warn: (module: string, message: string, data?: Record<string, unknown>) => log('WARN', module, message, data),
  error: (module: string, message: string, data?: Record<string, unknown>) => log('ERROR', module, message, data),
};

export default logger;
