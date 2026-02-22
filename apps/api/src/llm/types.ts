export type LLMProvider = 'anthropic' | 'openai' | 'gemini' | 'zai';

export interface ToolResult {
  toolUseId: string;
  result: string;
  isError?: boolean;
}

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
  toolCalls?: ToolCall[];      // For assistant messages with tool calls
  toolResults?: ToolResult[];  // For user messages with tool results
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

/** Extract plain text from content that may be string or ContentBlock[] */
export function getTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is TextContentBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
