export type LLMProvider = 'anthropic' | 'openai' | 'gemini';

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required?: string[];
  };
}

export interface GenerateRequest {
  messages: LLMMessage[];
  systemPrompt?: string;
  model?: string;
  toolsEnabled?: boolean;
  tools?: ToolDefinition[];
  maxTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface GenerateResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_use' | 'max_tokens' | 'error';
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProviderAdapter {
  readonly name: LLMProvider;
  readonly isConfigured: boolean;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  listModels(): string[];
}
