export interface SkillContext {
  /** HTTP client for external API calls */
  fetch: typeof globalThis.fetch;
  /** Read-only access to environment variables (API keys, etc.) */
  env: Readonly<Record<string, string | undefined>>;
  /** Read a file within allowed roots */
  readFile: (path: string) => Promise<string>;
  /** Write a file within allowed roots */
  writeFile: (path: string, content: string) => Promise<void>;
  /** Append a message to the skill execution log */
  log: (message: string) => void;
}

export interface SkillResult {
  success: boolean;
  result?: unknown;
  error?: string;
}
