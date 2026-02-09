import { config as loadEnv } from "dotenv";
import { resolve } from "path";

// Load .env from project root
loadEnv({ path: resolve(process.cwd(), "../../.env") });

// Hardcoded allowed roots for file access security
// These paths are enforced regardless of environment variables
const HARDCODED_ALLOWED_ROOTS: readonly string[] = [
  "/opt/Klyde/projects", // Klyde server (lokal, wenn DevAI dort läuft)
  "/mnt/klyde-projects", // Baso: SSHFS mount zu Klyde (read-write)
] as const;

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
  allowedRoots: readonly string[];

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

  // Feature flags
  useNewAgentRouter: boolean;

  // Persistence
  dbPath: string;

  // Looper-AI
  looperMaxIterations: number;
  looperMaxConversationTokens: number;
  looperMaxToolRetries: number;
  looperMinValidationConfidence: number;
  looperSelfValidationEnabled: boolean;

  // New Agent Router (capability-based)
  newAgentExecutorMaxTurns: number;
  newAgentExecutorMaxTurnsOnContinue: number;
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

    githubToken: process.env.GITHUB_TOKEN,
    githubOwner: process.env.GITHUB_OWNER,
    githubRepo: process.env.GITHUB_REPO,

    projectRoot: undefined, // Disabled - use allowedRoots only
    allowedRoots,

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

    // Feature flags
    useNewAgentRouter: process.env.USE_NEW_AGENT_ROUTER === "true",

    dbPath: process.env.DB_PATH || resolve(process.cwd(), "../../var/devai.db"),

    // Looper-AI
    looperMaxIterations: parseInt(process.env.LOOPER_MAX_ITERATIONS || "25", 10),
    looperMaxConversationTokens: parseInt(process.env.LOOPER_MAX_CONVERSATION_TOKENS || "120000", 10),
    looperMaxToolRetries: parseInt(process.env.LOOPER_MAX_TOOL_RETRIES || "3", 10),
    looperMinValidationConfidence: parseFloat(process.env.LOOPER_MIN_VALIDATION_CONFIDENCE || "0.7"),
    looperSelfValidationEnabled: process.env.LOOPER_SELF_VALIDATION !== "false",

    // New Agent Router (capability-based)
    // 5 turns was too low for real-world tasks (often needs multiple tool calls + synthesis).
    newAgentExecutorMaxTurns: parseInt(process.env.NEW_AGENT_EXECUTOR_MAX_TURNS || "20", 10),
    newAgentExecutorMaxTurnsOnContinue: parseInt(process.env.NEW_AGENT_EXECUTOR_MAX_TURNS_ON_CONTINUE || "40", 10),
  };
}

export const config = loadConfig();

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
