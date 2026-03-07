import OpenAI from 'openai';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition, LLMMessage } from '../types.js';
import { getTextContent } from '../types.js';

export class MoonshotProvider implements LLMProviderAdapter {
  readonly name = 'moonshot' as const;
  private client: OpenAI | null = null;
  /** Maps original tool_call IDs → normalized IDs for Kimi format compliance */
  private toolCallIdMap = new Map<string, string>();

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
      });
    }
    return this.client;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = this.getClient();
    this.toolCallIdMap.clear();

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

    const thinkingActive = !!(request.thinkingEnabled && (request.model || 'kimi-k2.5').startsWith('kimi-'));
    for (const m of request.messages) {
      if (m.role === 'system') continue;
      this.convertMessage(m, messages, toolNameToAlias, thinkingActive);
    }

    const tools = request.toolsEnabled && request.tools
      ? request.tools.map((tool) => {
          const alias = toolNameToAlias.get(tool.name) || tool.name;
          return this.convertTool(tool, alias);
        })
      : undefined;

    const model = request.model || 'kimi-k2.5';

    const createParams: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens || 16384,
      messages,
      tools,
    };

    // Kimi-specific: enable built-in web search for research tasks
    if (request.kimiSearchEnabled && model.startsWith('kimi-')) {
      createParams.use_search = true;
    }

    // Kimi-specific: thinking mode with capped budget
    if (request.thinkingEnabled && model.startsWith('kimi-')) {
      createParams.thinking = { type: 'enabled', budget_tokens: 8192 };
    }

    const response = await client.chat.completions.create(
      createParams as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
    );

    const choice = response.choices[0];
    const message = choice.message;
    // Kimi returns reasoning_content on assistant messages when thinking is enabled
    const reasoningContent = (message as unknown as Record<string, unknown>).reasoning_content as string | undefined;

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
      reasoning: reasoningContent || undefined,
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
    toolNameToAlias: Map<string, string>,
    thinkingActive: boolean
  ): void {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = message.toolCalls.map((tc, idx) => {
        const alias = toolNameToAlias.get(tc.name) || tc.name;
        const normalizedId = this.normalizeToolCallId(tc.id, alias, idx);
        return {
          id: normalizedId,
          type: 'function' as const,
          function: {
            name: alias,
            arguments: JSON.stringify(tc.arguments),
          },
        };
      });
      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: getTextContent(message.content) || null,
        tool_calls: toolCalls,
      };
      // Kimi requires reasoning_content on ALL assistant tool-call messages when
      // thinking is enabled. If none was stored (e.g. cross-provider history or
      // model skipped it), inject a minimal placeholder to satisfy the API.
      if (thinkingActive) {
        const reasoningContent = message.toolCalls[0]?.providerMetadata?.reasoning_content as string | undefined;
        assistantMsg.reasoning_content = reasoningContent || 'Analyzing the request.';
      }
      messages.push(assistantMsg as unknown as OpenAI.ChatCompletionMessageParam);
      return;
    }

    if (message.role === 'user' && message.toolResults?.length) {
      for (const tr of message.toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: this.toolCallIdMap.get(tr.toolUseId) || tr.toolUseId,
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

  /**
   * Normalize tool call IDs for Kimi format compliance.
   * Kimi K2.5 expects consistent IDs; non-standard IDs from other providers
   * (e.g. `toolu_xxx` from Anthropic, `call_xxx` from GLM) can confuse
   * the model at high conversation depth.
   */
  private normalizeToolCallId(originalId: string, toolAlias: string, idx: number): string {
    // If already a Kimi-native ID (from a previous Kimi call), keep as-is
    if (originalId.startsWith('call_')) {
      return originalId;
    }
    // Generate a consistent normalized ID and track the mapping
    const normalized = `call_${idx}_${toolAlias}`;
    this.toolCallIdMap.set(originalId, normalized);
    return normalized;
  }

  listModels(): string[] {
    return ['kimi-k2.5'];
  }
}
