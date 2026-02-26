import OpenAI from 'openai';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition, LLMMessage } from '../types.js';
import { getTextContent } from '../types.js';

export class MoonshotProvider implements LLMProviderAdapter {
  readonly name = 'moonshot' as const;
  private client: OpenAI | null = null;

  get isConfigured(): boolean {
    return !!config.moonshotApiKey;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      if (!config.moonshotApiKey) {
        throw new Error('MOONSHOT_API_KEY is not configured');
      }
      this.client = new OpenAI({
        apiKey: config.moonshotApiKey,
        baseURL: 'https://api.moonshot.ai/v1',
        timeout: 120_000,
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

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    for (const m of request.messages) {
      if (m.role === 'system') continue;
      this.convertMessage(m, messages, toolNameToAlias);
    }

    const tools = request.toolsEnabled && request.tools
      ? request.tools.map((tool) => {
          const alias = toolNameToAlias.get(tool.name) || tool.name;
          return this.convertTool(tool, alias);
        })
      : undefined;

    const model = request.model || 'kimi-k2.5';

    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens || 4096,
      messages,
      tools,
    });

    const choice = response.choices[0];
    const message = choice.message;
    // Kimi returns reasoning_content on assistant messages when thinking is enabled
    const reasoningContent = (message as Record<string, unknown>).reasoning_content as string | undefined;

    const toolCalls: GenerateResponse['toolCalls'] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function') {
          const name = aliasToToolName.get(tc.function.name) || tc.function.name;
          toolCalls.push({
            id: tc.id,
            name,
            arguments: JSON.parse(tc.function.arguments || '{}'),
            // Preserve reasoning_content so it can be sent back on subsequent requests
            ...(reasoningContent ? { providerMetadata: { reasoning_content: reasoningContent } } : {}),
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
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = message.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: toolNameToAlias.get(tc.name) || tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
      // Kimi requires reasoning_content on assistant tool-call messages when thinking is enabled.
      // Retrieve it from providerMetadata where we stored it during generate().
      const reasoningContent = message.toolCalls[0]?.providerMetadata?.reasoning_content as string | undefined;
      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: getTextContent(message.content) || null,
        tool_calls: toolCalls,
      };
      if (reasoningContent) {
        assistantMsg.reasoning_content = reasoningContent;
      }
      messages.push(assistantMsg as OpenAI.ChatCompletionMessageParam);
      return;
    }

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

    if (Array.isArray(message.content) && message.role === 'user') {
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
    return ['kimi-k2.5'];
  }
}
