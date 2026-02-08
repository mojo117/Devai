import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
loadEnv({ path: resolve(process.cwd(), '../../.env') });

export interface Config {
  nodeEnv: string;
  port: number;

  // LLM API Keys
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;

  // GitHub
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;

  // Project
  projectRoot?: string;
  allowedRoots: string[];

  // Skills
  skillsDir: string;

  // Tool execution
  toolTimeoutMs: number;
  toolMaxReadBytes: number;
  toolMaxWriteBytes: number;
  toolMaxListEntries: number;
  toolMaxDiffChars: number;
  toolAllowedExtensions: string[];

  // Persistence
  dbPath: string;

  // Looper-AI
  looperMaxIterations: number;
  looperMaxConversationTokens: number;
  looperMaxToolRetries: number;
  looperMinValidationConfidence: number;
  looperSelfValidationEnabled: boolean;
}

export function loadConfig(): Config {
  const allowedRoots = process.env.ALLOWED_ROOTS
    ? process.env.ALLOWED_ROOTS.split(/[;,]/).map((p) => p.trim()).filter(Boolean)
    : [];

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3001', 10),

    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,

    githubToken: process.env.GITHUB_TOKEN,
    githubOwner: process.env.GITHUB_OWNER,
    githubRepo: process.env.GITHUB_REPO,

    projectRoot: process.env.PROJECT_ROOT,
    allowedRoots,

    skillsDir: process.env.SKILLS_DIR || resolve(process.cwd(), '../../skills'),

    toolTimeoutMs: parseInt(process.env.TOOL_TIMEOUT_MS || '15000', 10),
    toolMaxReadBytes: parseInt(process.env.TOOL_MAX_READ_BYTES || '1048576', 10),
    toolMaxWriteBytes: parseInt(process.env.TOOL_MAX_WRITE_BYTES || '262144', 10),
    toolMaxListEntries: parseInt(process.env.TOOL_MAX_LIST_ENTRIES || '500', 10),
    toolMaxDiffChars: parseInt(process.env.TOOL_MAX_DIFF_CHARS || '12000', 10),
    toolAllowedExtensions: parseExtensions(process.env.TOOL_ALLOWED_EXTENSIONS),

    dbPath: process.env.DB_PATH || resolve(process.cwd(), '../../var/devai.db'),

    // Looper-AI
    looperMaxIterations: parseInt(process.env.LOOPER_MAX_ITERATIONS || '25', 10),
    looperMaxConversationTokens: parseInt(process.env.LOOPER_MAX_CONVERSATION_TOKENS || '120000', 10),
    looperMaxToolRetries: parseInt(process.env.LOOPER_MAX_TOOL_RETRIES || '3', 10),
    looperMinValidationConfidence: parseFloat(process.env.LOOPER_MIN_VALIDATION_CONFIDENCE || '0.7'),
    looperSelfValidationEnabled: process.env.LOOPER_SELF_VALIDATION !== 'false',
  };
}

export const config = loadConfig();

function parseExtensions(value?: string): string[] {
  if (!value) {
    return [
      '.md',
      '.txt',
      '.json',
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.css',
      '.scss',
      '.html',
      '.yml',
      '.yaml',
      '.env',
      '.example',
      '.log',
    ];
  }
  return value
    .split(/[;,]/)
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
}
