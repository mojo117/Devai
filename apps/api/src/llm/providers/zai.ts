import OpenAI from 'openai';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition, LLMMessage } from '../types.js';
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
    const thinkingActive = !!(request.thinkingEnabled && (request.model || 'glm-5') === 'glm-5');
    for (const m of request.messages) {
      if (m.role === 'system') continue; // Already handled above
      this.convertMessage(m, messages, toolNameToAlias, thinkingActive);
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
      : (request.model || 'glm-5');

    // GLM-5 thinking mode: enable extended reasoning for complex tasks
    const useThinking = request.thinkingEnabled && model === 'glm-5';
    const useWebSearch = request.webSearchEnabled && model.startsWith('glm-');
    // Validate and sanitize message sequence before sending to ZAI
    this.validateMessageSequence(messages);

    const createParams: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens || 16384,
      messages,
      tools,
    };
    if (tools && request.toolChoice) {
      createParams.tool_choice = request.toolChoice;
    }
    if (useThinking) {
      createParams.enable_thinking = true;
    }
    if (useWebSearch) {
      createParams.web_search = true;
    }

    const response = await client.chat.completions.create(
      createParams as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming
    );

    const choice = response.choices[0];
    const message = choice.message;
    // GLM-5 returns reasoning_content when thinking is enabled (same field as Kimi)
    const reasoningContent = useThinking
      ? (message as unknown as Record<string, unknown>).reasoning_content as string | undefined
      : undefined;

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
        // Detect if ZAI API returns cached token info (prompt_tokens_details)
        ...(() => {
          const details = (response.usage as unknown as Record<string, unknown>).prompt_tokens_details as Record<string, number> | undefined;
          if (details?.cached_tokens) {
            console.log(`[zai] Context caching active: ${details.cached_tokens} cached tokens`);
            return { cachedTokens: details.cached_tokens };
          }
          return {};
        })(),
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
    toolNameToAlias: Map<string, string>,
    thinkingActive: boolean
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
      const assistantMsg: Record<string, unknown> = {
        role: 'assistant',
        content: getTextContent(message.content) || null,
        tool_calls: toolCalls,
      };
      // Only inject reasoning_content when thinking is active for this request.
      // Cross-provider fallback disables thinking, so stale reasoning_content
      // from a different provider won't leak into the message history.
      // When thinking IS active but no reasoning_content was stored, inject a
      // minimal placeholder to satisfy APIs that require it on every tool-call message.
      if (thinkingActive) {
        const reasoningContent = message.toolCalls[0]?.providerMetadata?.reasoning_content as string | undefined;
        assistantMsg.reasoning_content = reasoningContent || 'Analyzing the request.';
      }
      messages.push(assistantMsg as unknown as OpenAI.ChatCompletionMessageParam);
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

  /**
   * Validate and fix common message sequence issues that cause ZAI 400 errors.
   * Logs warnings for debugging and removes orphaned tool messages.
   */
  private validateMessageSequence(messages: OpenAI.ChatCompletionMessageParam[]): void {
    // Collect valid tool_call IDs from assistant messages
    const validToolCallIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          validToolCallIds.add(tc.id);
        }
      }
    }

    // Remove orphaned tool messages whose tool_call_id doesn't match any assistant tool_call
    let removed = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'tool' && 'tool_call_id' in msg) {
        if (!validToolCallIds.has(msg.tool_call_id)) {
          messages.splice(i, 1);
          removed++;
        }
      }
    }

    if (removed > 0) {
      console.warn(`[zai] Removed ${removed} orphaned tool message(s) from conversation`);
    }

    // Log message structure for diagnostics if it looks suspicious
    const roles = messages.map((m) => m.role);
    for (let i = 0; i < roles.length; i++) {
      if (roles[i] === 'tool' && (i === 0 || roles[i - 1] === 'user' || roles[i - 1] === 'system')) {
        console.warn('[zai] Suspicious message sequence — tool message not preceded by assistant:', roles.join(','));
        break;
      }
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
