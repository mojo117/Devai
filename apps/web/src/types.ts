// Re-export shared types and add frontend-specific types

export type LLMProvider = 'anthropic' | 'openai' | 'gemini';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface PinnedFilesSetting {
  files: string[];
}

export interface IgnorePatternsSetting {
  patterns: string[];
}

export interface ContextStats {
  tokensUsed: number;
  tokenBudget: number;
  note?: string;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

export interface SessionMessagesResponse {
  messages: ChatMessage[];
}

export interface SettingResponse {
  key: string;
  value: unknown;
}

export type ActionStatus = 'pending' | 'approved' | 'executing' | 'done' | 'failed' | 'rejected';

export interface ActionPreview {
  kind: 'diff' | 'summary';
  path: string;
  diff?: string;
  summary?: string;
}

export interface Action {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  status: ActionStatus;
  createdAt: string;
  preview?: ActionPreview;
  approvedAt?: string;
  executedAt?: string;
  result?: unknown;
  error?: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  environment: string;
  providers: {
    anthropic: boolean;
    openai: boolean;
    gemini: boolean;
  };
  projectRoot: string | null;
  allowedRoots: string[];
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version?: string;
  tags?: string[];
}

export interface SkillsResponse {
  skills: SkillSummary[];
  loadedAt: string | null;
  errors: string[];
}

export interface ProjectContext {
  framework: 'vite' | 'cra' | 'next' | 'node' | 'unknown';
  language: 'typescript' | 'javascript';
  hasTests: boolean;
  testCommand?: string;
  buildCommand?: string;
  packageManager: 'npm' | 'yarn' | 'pnpm';
  summary: string;
}

export interface ProjectResponse {
  projectRoot: string;
  context: ProjectContext;
}

export interface ProjectFileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface ProjectFilesResponse {
  path: string;
  files: ProjectFileEntry[];
}

export interface ProjectFileResponse {
  path: string;
  content: string;
  size: number;
}

export interface ProjectSearchMatch {
  file: string;
  line: number;
  content: string;
}

export interface ProjectSearchResponse {
  pattern: string;
  basePath: string;
  matches: ProjectSearchMatch[];
  filesSearched: number;
  truncated: boolean;
}

export interface ProjectGlobResponse {
  pattern: string;
  basePath: string;
  files: string[];
  count: number;
  truncated: boolean;
}
