// Re-export shared types and add frontend-specific types

export type LLMProvider = 'anthropic' | 'openai' | 'gemini';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export type ActionStatus = 'pending' | 'approved' | 'executing' | 'done' | 'failed';

export interface Action {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  status: ActionStatus;
  createdAt: string;
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
