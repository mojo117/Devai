import OpenAI from 'openai';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition } from '../types.js';

export class OpenAIProvider implements LLMProviderAdapter {
  readonly name = 'openai' as const;
  private client: OpenAI | null = null;

  get isConfigured(): boolean {
    return !!config.openaiApiKey;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is not configured');
      }
      this.client = new OpenAI({ apiKey: config.openaiApiKey });
    }
    return this.client;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = this.getClient();

    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system message if present
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    // Add conversation messages
    for (const m of request.messages) {
      if (m.role === 'system') continue; // Already handled above
      messages.push({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      });
    }

    const toolNameMap = new Map<string, string>();
    const tools = request.toolsEnabled && request.tools
      ? request.tools.map((tool) => {
          const alias = tool.name.replace(/\./g, '_');
          toolNameMap.set(alias, tool.name);
          return this.convertTool(tool, alias);
        })
      : undefined;

    const response = await client.chat.completions.create({
      model: request.model || 'gpt-4o',
      max_tokens: request.maxTokens || 4096,
      messages,
      tools,
    });

    const choice = response.choices[0];
    const message = choice.message;

    // Extract tool calls
    const toolCalls: GenerateResponse['toolCalls'] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function') {
          const name = toolNameMap.get(tc.function.name) || tc.function.name;
          toolCalls.push({
            id: tc.id,
            name,
            arguments: JSON.parse(tc.function.arguments || '{}'),
          });
        }
      }
    }

    return {
      content: message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_use' :
                    choice.finish_reason === 'length' ? 'max_tokens' : 'stop',
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
    };
  }

  private convertTool(tool: ToolDefinition, alias?: string): OpenAI.ChatCompletionTool {
    return {
      type: 'function',
      function: {
        name: alias || tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    };
  }

  listModels(): string[] {
    return [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-3.5-turbo',
    ];
  }
}
