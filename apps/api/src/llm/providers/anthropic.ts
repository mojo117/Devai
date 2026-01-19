import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition, LLMMessage } from '../types.js';

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

    const messages: MessageParam[] = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => this.convertMessage(m));

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

  private convertMessage(message: LLMMessage): MessageParam {
    const role = message.role as 'user' | 'assistant';

    // Assistant message with tool calls
    if (role === 'assistant' && message.toolCalls?.length) {
      const content: ContentBlockParam[] = [];
      if (message.content) {
        content.push({ type: 'text', text: message.content });
      }
      for (const tc of message.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      return { role, content };
    }

    // User message with tool results
    if (role === 'user' && message.toolResults?.length) {
      const content: ContentBlockParam[] = message.toolResults.map((tr) => ({
        type: 'tool_result' as const,
        tool_use_id: tr.toolUseId,
        content: tr.result,
        is_error: tr.isError,
      }));
      return { role, content };
    }

    // Simple text message
    return { role, content: message.content };
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
