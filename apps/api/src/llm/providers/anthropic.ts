import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition } from '../types.js';

export class AnthropicProvider implements LLMProviderAdapter {
  readonly name = 'anthropic' as const;
  private client: Anthropic | null = null;

  get isConfigured(): boolean {
    return !!config.anthropicApiKey;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      if (!config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is not configured');
      }
      this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    }
    return this.client;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = this.getClient();

    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const tools = request.toolsEnabled && request.tools
      ? request.tools.map(this.convertTool)
      : undefined;

    const response = await client.messages.create({
      model: request.model || 'claude-sonnet-4-20250514',
      max_tokens: request.maxTokens || 4096,
      system: request.systemPrompt,
      messages,
      tools,
    });

    // Extract text content and tool uses
    let textContent = '';
    const toolCalls: GenerateResponse['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: response.stop_reason === 'tool_use' ? 'tool_use' :
                    response.stop_reason === 'max_tokens' ? 'max_tokens' : 'stop',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private convertTool(tool: ToolDefinition): Anthropic.Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    };
  }

  listModels(): string[] {
    return [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ];
  }
}
