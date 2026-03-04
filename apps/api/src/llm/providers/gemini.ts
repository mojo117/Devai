import { GoogleGenAI, Type } from '@google/genai';
import type { Content, Part, FunctionDeclaration } from '@google/genai';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition, LLMMessage } from '../types.js';
import { getTextContent } from '../types.js';

export class GeminiProvider implements LLMProviderAdapter {
  readonly name = 'gemini' as const;
  private client: GoogleGenAI | null = null;

  get isConfigured(): boolean {
    return !!config.geminiApiKey;
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      if (!config.geminiApiKey) {
        throw new Error('GEMINI_API_KEY is not configured');
      }
      this.client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    return this.client;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = this.getClient();

    // Build tool name alias maps (Gemini doesn't allow dots in function names)
    const toolNameToAlias = new Map<string, string>();
    const aliasToToolName = new Map<string, string>();
    if (request.tools) {
      for (const tool of request.tools) {
        const alias = tool.name.replace(/\./g, '_');
        toolNameToAlias.set(tool.name, alias);
        aliasToToolName.set(alias, tool.name);
      }
    }

    // Convert messages to Gemini format
    const contents: Content[] = [];
    for (const m of request.messages) {
      if (m.role === 'system') continue; // Handled via systemInstruction
      const content = this.convertMessage(m, toolNameToAlias);
      if (content) {
        contents.push(content);
      }
    }

    const toolDeclarations: FunctionDeclaration[] | undefined =
      request.toolsEnabled && request.tools
        ? request.tools.map((tool) => {
            const alias = toolNameToAlias.get(tool.name) || tool.name;
            return this.convertTool(tool, alias);
          })
        : undefined;

    // Gemini 3.x: bounded thinking — the model self-regulates how much it uses
    const isThinkingModel = (request.model || '').startsWith('gemini-3');
    const thinkingConfig = isThinkingModel
      ? { thinkingBudget: 8192 }
      : undefined;

    const response = await client.models.generateContent({
      model: request.model || 'gemini-3.1-pro-preview',
      contents,
      config: {
        systemInstruction: request.systemPrompt,
        maxOutputTokens: request.maxTokens || 16384,
        tools: toolDeclarations ? [{ functionDeclarations: toolDeclarations }] : undefined,
        thinkingConfig,
      },
    });

    const candidate = response.candidates?.[0];

    if (!candidate) {
      throw new Error('No response candidate from Gemini');
    }

    // Extract text, thinking, and function calls
    let textContent = '';
    let reasoningContent = '';
    const toolCalls: GenerateResponse['toolCalls'] = [];

    for (const part of candidate.content?.parts || []) {
      if (part.text) {
        // Gemini thinking models mark reasoning parts with thought: true
        if (part.thought === true) {
          reasoningContent += (reasoningContent ? '\n' : '') + part.text;
        } else {
          textContent += part.text;
        }
      } else if (part.functionCall) {
        const name = aliasToToolName.get(part.functionCall.name!) || part.functionCall.name!;
        // Preserve thoughtSignature for Gemini 3.x thinking models (required for round-trip)
        const providerMetadata: Record<string, unknown> | undefined =
          part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : undefined;
        toolCalls.push({
          id: `gemini-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name,
          arguments: (part.functionCall.args || {}) as Record<string, unknown>,
          providerMetadata,
        });
      }
    }

    const finishReason = candidate.finishReason;

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: finishReason === 'STOP' ? 'stop' :
                    finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'stop',
      reasoning: reasoningContent || undefined,
      usage: response.usageMetadata ? {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
      } : undefined,
    };
  }

  private convertTool(tool: ToolDefinition, alias?: string): FunctionDeclaration {
    const typeMap: Record<string, string> = {
      string: Type.STRING,
      number: Type.NUMBER,
      boolean: Type.BOOLEAN,
      object: Type.OBJECT,
      array: Type.ARRAY,
    };

    return {
      name: alias || tool.name,
      description: tool.description,
      parameters: {
        type: Type.OBJECT,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([key, value]) => {
            const prop: Record<string, unknown> = {
              type: typeMap[value.type] || Type.STRING,
              description: value.description,
            };
            // Gemini requires `items` for array types
            if (value.type === 'array') {
              const itemType = value.items?.type || 'string';
              prop.items = { type: typeMap[itemType] || Type.STRING };
            }
            return [key, prop];
          })
        ),
        required: tool.parameters.required,
      },
    };
  }

  private convertMessage(message: LLMMessage, toolNameToAlias: Map<string, string>): Content | null {
    const role = message.role === 'assistant' ? 'model' : 'user';

    // Model message with function calls
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const parts: Part[] = [];
      if (message.content) {
        parts.push({ text: getTextContent(message.content) });
      }
      for (const tc of message.toolCalls) {
        const fcPart: Part = {
          functionCall: {
            name: toolNameToAlias.get(tc.name) || tc.name,
            args: tc.arguments,
          },
        };
        // Restore thoughtSignature for Gemini 3.x thinking models
        if (tc.providerMetadata?.thoughtSignature != null) {
          fcPart.thoughtSignature = tc.providerMetadata.thoughtSignature as string;
        }
        parts.push(fcPart);
      }
      return { role: 'model', parts };
    }

    // User message with function responses
    if (message.role === 'user' && message.toolResults?.length) {
      const parts: Part[] = message.toolResults.map((tr) => ({
        functionResponse: {
          name: tr.toolUseId, // Gemini uses function name, but we store as toolUseId
          response: { result: tr.result },
        },
      }));
      return { role: 'user', parts };
    }

    // Simple text message
    return { role, parts: [{ text: getTextContent(message.content) }] };
  }

  listModels(): string[] {
    return [
      'gemini-3.1-pro-preview',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ];
  }
}
