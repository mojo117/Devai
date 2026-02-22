/** Lightweight wrapper around fetch with pre-configured auth and base URL */
export interface ApiClient {
  /** Whether this API is configured (has an API key) */
  available: boolean;
  /** Make an authenticated request. Path is relative to the base URL. */
  request(path: string, options?: RequestInit): Promise<Response>;
  /** GET + parse JSON response */
  get<T = unknown>(path: string): Promise<T>;
  /** POST JSON body + parse JSON response */
  post<T = unknown>(path: string, body: unknown): Promise<T>;
}

export interface SkillContext {
  /** HTTP client for external API calls */
  fetch: typeof globalThis.fetch;
  /** Read-only access to environment variables (API keys, etc.) */
  env: Readonly<Record<string, string | undefined>>;
  /** Pre-configured API clients for common services */
  apis: {
    openai: ApiClient;
    firecrawl: ApiClient;
  };
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
