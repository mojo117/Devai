import type { Action } from './actions.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: ToolCallResult[];
}

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'approved' | 'executed' | 'failed';
}

export type LLMProvider = 'anthropic' | 'openai' | 'gemini';

export interface ChatRequest {
  messages: ChatMessage[];
  provider: LLMProvider;
  projectRoot: string;
  skillIds?: string[];
  sessionId?: string;
}

export interface ChatResponse {
  message: ChatMessage;
  pendingActions: Action[];
  sessionId?: string;
}
