import OpenAI from 'openai';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition, LLMMessage, ContentBlock } from '../types.js';
import { getTextContent } from '../types.js';

export class ZAIProvider implements LLMProviderAdapter {
  readonly name = 'zai' as const;
  private client: OpenAI | null = null;

  get isConfigured(): boolean {
    return !!config.zaiApiKey;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      if (!config.zaiApiKey) {
        throw new Error('ZAI_API_KEY is not configured');
      }
      this.client = new OpenAI({
        apiKey: config.zaiApiKey,
        baseURL: 'https://api.z.ai/api/coding/paas/v4',
      });
    }
    return this.client;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = this.getClient();

    // Build tool name alias map (dots to underscores for OpenAI-compatible API)
    const toolNameToAlias = new Map<string, string>();
    const aliasToToolName = new Map<string, string>();
    if (request.tools) {
      for (const tool of request.tools) {
        const alias = tool.name.replace(/\./g, '_');
        toolNameToAlias.set(tool.name, alias);
        aliasToToolName.set(alias, tool.name);
      }
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system message if present
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    // Add conversation messages
    for (const m of request.messages) {
      if (m.role === 'system') continue; // Already handled above
      this.convertMessage(m, messages, toolNameToAlias);
    }

    const tools = request.toolsEnabled && request.tools
      ? request.tools.map((tool) => {
          const alias = toolNameToAlias.get(tool.name) || tool.name;
          return this.convertTool(tool, alias);
        })
      : undefined;

    // Auto-switch to vision model when images are present
    const hasImages = request.messages.some((m) =>
      Array.isArray(m.content) && m.content.some((b) => b.type === 'image_url')
    );
    const model = hasImages
      ? (request.model?.includes('4.6v') ? request.model : 'glm-4.6v-flash')
      : (request.model || 'glm-4.7');

    const response = await client.chat.completions.create({
      model,
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
          const name = aliasToToolName.get(tc.function.name) || tc.function.name;
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
    const sanitizedParameters = this.sanitizeJsonSchema({
      type: 'object',
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    });

    return {
      type: 'function',
      function: {
        name: alias || tool.name,
        description: tool.description,
        parameters: sanitizedParameters,
      },
    };
  }

  /**
   * ZAI (OpenAI-compatible) rejects array schemas without `items`.
   * Some MCP tools emit incomplete JSON schema fragments, so we normalize them.
   */
  private sanitizeJsonSchema(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const schema = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [key, raw] of Object.entries(schema)) {
      if (key === 'properties' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const properties = raw as Record<string, unknown>;
        const normalizedProps: Record<string, unknown> = {};
        for (const [propName, propSchema] of Object.entries(properties)) {
          normalizedProps[propName] = this.sanitizeJsonSchema(propSchema);
        }
        out.properties = normalizedProps;
        continue;
      }

      if (key === 'items') {
        out.items = this.sanitizeJsonSchema(raw);
        continue;
      }

      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        out[key] = this.sanitizeJsonSchema(raw);
      } else {
        out[key] = raw;
      }
    }

    if (out.type === 'array' && !out.items) {
      out.items = { type: 'string' };
    }

    return out;
  }

  private convertMessage(
    message: LLMMessage,
    messages: OpenAI.ChatCompletionMessageParam[],
    toolNameToAlias: Map<string, string>
  ): void {
    // Assistant message with tool calls
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = message.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: toolNameToAlias.get(tc.name) || tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
      messages.push({
        role: 'assistant',
        content: getTextContent(message.content) || null,
        tool_calls: toolCalls,
      });
      return;
    }

    // User message with tool results - these become separate 'tool' role messages
    if (message.role === 'user' && message.toolResults?.length) {
      for (const tr of message.toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: tr.toolUseId,
          content: tr.result,
        });
      }
      return;
    }

    // Simple text/multimodal message
    if (Array.isArray(message.content) && message.role === 'user') {
      // Multimodal user message: pass ContentBlock[] as OpenAI-compatible format
      messages.push({
        role: 'user',
        content: message.content.map((block) => {
          if (block.type === 'image_url') {
            return { type: 'image_url' as const, image_url: block.image_url };
          }
          return { type: 'text' as const, text: block.text };
        }),
      });
    } else {
      messages.push({
        role: message.role as 'user' | 'assistant',
        content: getTextContent(message.content),
      });
    }
  }

  listModels(): string[] {
    return [
      'glm-5',
      'glm-4.7',
      'glm-4.7-flash',
      'glm-4.5-flash',
      'glm-4.5-air',
      'glm-4.7-flashx',
      'glm-4.6v',
      'glm-4.6v-flash',
      'glm-4.6v-flashx',
    ];
  }
}
