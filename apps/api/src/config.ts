import { config as loadEnv } from "dotenv";
import { resolve } from "path";

// Load .env from project root
loadEnv({ path: resolve(process.cwd(), "../../.env") });

// Hardcoded allowed roots for file access security
// These paths are enforced regardless of environment variables
const HARDCODED_ALLOWED_ROOTS: readonly string[] = [
  "/root",   // Clawd home — projects, scripts
  "/opt",    // Clawd /opt — project files, tools
  "/home",   // Service home directories
] as const;

// Paths that are explicitly denied even within allowed roots
// OpenClaw is a separate system — Devai must not read its config, credentials, or workspace
// Devai must not be able to modify its own deployment
const HARDCODED_DENIED_PATHS: readonly string[] = [
  "/root/.openclaw",  // OpenClaw config, credentials, workspace — separate system
  "/opt/Devai",       // Devai's own deployment — prevent self-modification
] as const;

// Directories/files within /opt/Devai that SCOUT must NOT read (secrets, runtime data)
const SELF_INSPECTION_EXCLUDE: readonly string[] = [
  '.env',
  'secrets',
  'var',
  'workspace/memory',
  '.git',
  'node_modules',
] as const;

export interface Config {
  nodeEnv: string;
  port: number;

  // LLM API Keys
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  zaiApiKey?: string;

  // GitHub
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;

  // Project
  projectRoot?: string;
  allowedRoots: readonly string[];
  deniedPaths: readonly string[];

  // Self-inspection: allows SCOUT to read Devai's own source (read-only, secrets excluded)
  selfInspectionRoot: string;
  selfInspectionExclude: string[];

  // Skills
  skillsDir: string;

  // Tool execution
  toolTimeoutMs: number;
  toolMaxReadBytes: number;
  toolMaxWriteBytes: number;
  toolMaxListEntries: number;
  toolMaxDiffChars: number;
  toolAllowedExtensions: string[];

  // Supabase
  supabaseUrl: string;
  supabaseServiceKey: string;

  // CAIO — TaskForge, Email, Telegram
  taskforgeApiKey: string;
  resendApiKey: string;
  resendFromAddress: string;
  telegramBotToken: string;
  telegramAllowedChatId: string;

  // Persistence
  dbPath: string;

  // Decision loop runtime tuning (legacy LOOPER_* env var names retained)
  looperMaxIterations: number;
  looperMaxConversationTokens: number;
  looperMaxToolRetries: number;
  looperMinValidationConfidence: number;
  looperSelfValidationEnabled: boolean;

  // Memory retrieval tuning
  memoryRetrievalThresholds: number[];
  memoryMinHitsBeforeStop: number;
  memoryIncludePersonalScope: boolean;

}

export interface EnvValidationIssue {
  key: string;
  reason: string;
}

export interface EnvValidationResult {
  ok: boolean;
  errors: EnvValidationIssue[];
  warnings: EnvValidationIssue[];
}

export function loadConfig(): Config {
  // Use only hardcoded allowed roots for security
  // Environment variables cannot override these restrictions
  const allowedRoots = HARDCODED_ALLOWED_ROOTS;

  return {
    nodeEnv: process.env.NODE_ENV || "development",
    port: parseInt(process.env.PORT || "3001", 10),

    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    zaiApiKey: process.env.ZAI_API_KEY,

    githubToken: process.env.GITHUB_TOKEN,
    githubOwner: process.env.GITHUB_OWNER,
    githubRepo: process.env.GITHUB_REPO,

    taskforgeApiKey: process.env.DEVAI_TASKBOARD_API_KEY || '',
    resendApiKey: process.env.RESEND_API_KEY || '',
    resendFromAddress: process.env.RESEND_FROM_ADDRESS || '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramAllowedChatId: process.env.TELEGRAM_ALLOWED_CHAT_ID || '',

    projectRoot: undefined, // Disabled - use allowedRoots only
    allowedRoots,
    deniedPaths: HARDCODED_DENIED_PATHS,

    selfInspectionRoot: '/opt/Devai',
    selfInspectionExclude: [...SELF_INSPECTION_EXCLUDE],

    skillsDir: process.env.SKILLS_DIR || resolve(process.cwd(), "../../skills"),

    toolTimeoutMs: parseInt(process.env.TOOL_TIMEOUT_MS || "15000", 10),
    toolMaxReadBytes: parseInt(process.env.TOOL_MAX_READ_BYTES || "1048576", 10),
    toolMaxWriteBytes: parseInt(process.env.TOOL_MAX_WRITE_BYTES || "262144", 10),
    toolMaxListEntries: parseInt(process.env.TOOL_MAX_LIST_ENTRIES || "500", 10),
    toolMaxDiffChars: parseInt(process.env.TOOL_MAX_DIFF_CHARS || "12000", 10),
    toolAllowedExtensions: parseExtensions(process.env.TOOL_ALLOWED_EXTENSIONS),

    supabaseUrl: process.env.DEVAI_SUPABASE_URL || process.env.SUPABASE_URL || "",
    // Support both DevAI-prefixed and standard Supabase env var names.
    // We prefer the service-role key, but some deployments used SUPABASE_SERVICE_KEY historically.
    supabaseServiceKey:
      process.env.DEVAI_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      "",

    dbPath: process.env.DB_PATH || resolve(process.cwd(), "../../var/devai.db"),

    // Decision loop runtime tuning (legacy env names for compatibility)
    looperMaxIterations: parseInt(process.env.LOOPER_MAX_ITERATIONS || "25", 10),
    looperMaxConversationTokens: parseInt(process.env.LOOPER_MAX_CONVERSATION_TOKENS || "180000", 10),
    looperMaxToolRetries: parseInt(process.env.LOOPER_MAX_TOOL_RETRIES || "3", 10),
    looperMinValidationConfidence: parseFloat(process.env.LOOPER_MIN_VALIDATION_CONFIDENCE || "0.7"),
    looperSelfValidationEnabled: process.env.LOOPER_SELF_VALIDATION !== "false",
    memoryRetrievalThresholds: parseNumberList(
      process.env.MEMORY_RETRIEVAL_THRESHOLDS,
      [0.5, 0.35, 0.2],
      { min: 0, max: 1, sortDesc: true },
    ),
    memoryMinHitsBeforeStop: Math.max(1, parseInt(process.env.MEMORY_MIN_HITS_BEFORE_STOP || "3", 10)),
    memoryIncludePersonalScope: process.env.MEMORY_INCLUDE_PERSONAL_SCOPE !== "false",

  };
}

export const config = loadConfig();

export function validateRequiredEnv(currentConfig: Config = config): EnvValidationResult {
  const errors: EnvValidationIssue[] = [];
  const warnings: EnvValidationIssue[] = [];

  const hasAnyLlmProvider = Boolean(
    currentConfig.zaiApiKey ||
    currentConfig.anthropicApiKey ||
    currentConfig.openaiApiKey ||
    currentConfig.geminiApiKey,
  );

  if (!currentConfig.supabaseUrl) {
    errors.push({
      key: 'DEVAI_SUPABASE_URL | SUPABASE_URL',
      reason: 'Supabase project URL is required for sessions, auth, scheduler, and memory.',
    });
  }

  if (!currentConfig.supabaseServiceKey) {
    errors.push({
      key: 'DEVAI_SUPABASE_SERVICE_ROLE_KEY | SUPABASE_SERVICE_ROLE_KEY | SUPABASE_SERVICE_KEY',
      reason: 'Supabase service key is required for backend data access.',
    });
  }

  if (!process.env.DEVAI_JWT_SECRET) {
    errors.push({
      key: 'DEVAI_JWT_SECRET',
      reason: 'JWT signing secret is required for authentication routes.',
    });
  }

  if (!hasAnyLlmProvider) {
    errors.push({
      key: 'ZAI_API_KEY | ANTHROPIC_API_KEY | OPENAI_API_KEY | GEMINI_API_KEY',
      reason: 'At least one LLM provider key must be configured.',
    });
  }

  if (!currentConfig.telegramBotToken) {
    warnings.push({
      key: 'TELEGRAM_BOT_TOKEN',
      reason: 'Telegram notifications are disabled.',
    });
  }

  if (!currentConfig.telegramAllowedChatId) {
    warnings.push({
      key: 'TELEGRAM_ALLOWED_CHAT_ID',
      reason: 'Telegram inbound webhooks will reject all chats until allowed IDs are set.',
    });
  }

  if (!currentConfig.taskforgeApiKey) {
    warnings.push({
      key: 'DEVAI_TASKBOARD_API_KEY',
      reason: 'TaskForge integration is disabled.',
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function parseExtensions(value?: string): string[] {
  if (!value) {
    return [
      ".md",
      ".txt",
      ".json",
      ".js",
      ".ts",
      ".tsx",
      ".jsx",
      ".css",
      ".scss",
      ".html",
      ".yml",
      ".yaml",
      ".env",
      ".example",
      ".log",
    ];
  }
  return value
    .split(/[;,]/)
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
}

function parseNumberList(
  value: string | undefined,
  fallback: number[],
  options: { min?: number; max?: number; sortDesc?: boolean } = {},
): number[] {
  const source = (value || '')
    .split(/[;,]/)
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));

  const raw = source.length > 0 ? source : fallback;
  const filtered = raw.filter((entry) => {
    if (options.min !== undefined && entry < options.min) return false;
    if (options.max !== undefined && entry > options.max) return false;
    return true;
  });

  const unique = Array.from(new Set(filtered));
  if (options.sortDesc) {
    unique.sort((a, b) => b - a);
  }
  return unique.length > 0 ? unique : fallback;
}
