import { GoogleGenerativeAI, Content, Tool, FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { config } from '../../config.js';
import type { LLMProviderAdapter, GenerateRequest, GenerateResponse, ToolDefinition } from '../types.js';

export class GeminiProvider implements LLMProviderAdapter {
  readonly name = 'gemini' as const;
  private client: GoogleGenerativeAI | null = null;

  get isConfigured(): boolean {
    return !!config.geminiApiKey;
  }

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      if (!config.geminiApiKey) {
        throw new Error('GEMINI_API_KEY is not configured');
      }
      this.client = new GoogleGenerativeAI(config.geminiApiKey);
    }
    return this.client;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = this.getClient();

    const model = client.getGenerativeModel({
      model: request.model || 'gemini-2.0-flash',
      systemInstruction: request.systemPrompt,
    });

    // Convert messages to Gemini format
    const contents: Content[] = [];
    for (const m of request.messages) {
      if (m.role === 'system') continue; // Handled via systemInstruction
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }

    const toolNameMap = new Map<string, string>();
    const tools: Tool[] | undefined = request.toolsEnabled && request.tools
      ? [{
          functionDeclarations: request.tools.map((tool) => {
            const alias = tool.name.replace(/\./g, '_');
            toolNameMap.set(alias, tool.name);
            return this.convertTool(tool, alias);
          }),
        }]
      : undefined;

    const result = await model.generateContent({
      contents,
      tools,
      generationConfig: {
        maxOutputTokens: request.maxTokens || 4096,
      },
    });

    const response = result.response;
    const candidate = response.candidates?.[0];

    if (!candidate) {
      throw new Error('No response candidate from Gemini');
    }

    // Extract text and function calls
    let textContent = '';
    const toolCalls: GenerateResponse['toolCalls'] = [];

    for (const part of candidate.content.parts) {
      if ('text' in part && part.text) {
        textContent += part.text;
      } else if ('functionCall' in part && part.functionCall) {
        const name = toolNameMap.get(part.functionCall.name) || part.functionCall.name;
        toolCalls.push({
          id: `gemini-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name,
          arguments: part.functionCall.args as Record<string, unknown>,
        });
      }
    }

    const finishReason = candidate.finishReason;

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: finishReason === 'STOP' ? 'stop' :
                    finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'stop',
      usage: response.usageMetadata ? {
        inputTokens: response.usageMetadata.promptTokenCount || 0,
        outputTokens: response.usageMetadata.candidatesTokenCount || 0,
      } : undefined,
    };
  }

  private convertTool(tool: ToolDefinition, alias?: string): FunctionDeclaration {
    const typeMap: Record<string, SchemaType> = {
      string: SchemaType.STRING,
      number: SchemaType.NUMBER,
      boolean: SchemaType.BOOLEAN,
      object: SchemaType.OBJECT,
      array: SchemaType.ARRAY,
    };

    return {
      name: alias || tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([key, value]) => [
            key,
            {
              type: typeMap[value.type] || SchemaType.STRING,
              description: value.description,
            },
          ])
        ),
        required: tool.parameters.required,
      },
    };
  }

  listModels(): string[] {
    return [
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ];
  }
}
