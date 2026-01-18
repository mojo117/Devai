import type { LLMProvider, LLMProviderAdapter, GenerateRequest, GenerateResponse } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';

export class LLMRouter {
  private providers: Map<LLMProvider, LLMProviderAdapter>;

  constructor() {
    this.providers = new Map();

    // Register all providers
    const anthropic = new AnthropicProvider();
    const openai = new OpenAIProvider();
    const gemini = new GeminiProvider();

    this.providers.set('anthropic', anthropic);
    this.providers.set('openai', openai);
    this.providers.set('gemini', gemini);
  }

  getProvider(name: LLMProvider): LLMProviderAdapter | undefined {
    return this.providers.get(name);
  }

  isProviderConfigured(name: LLMProvider): boolean {
    const provider = this.providers.get(name);
    return provider?.isConfigured ?? false;
  }

  getConfiguredProviders(): LLMProvider[] {
    return Array.from(this.providers.entries())
      .filter(([_, provider]) => provider.isConfigured)
      .map(([name]) => name);
  }

  async generate(providerName: LLMProvider, request: GenerateRequest): Promise<GenerateResponse> {
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    if (!provider.isConfigured) {
      throw new Error(`Provider ${providerName} is not configured. Please set the API key.`);
    }

    return provider.generate(request);
  }

  listModels(providerName: LLMProvider): string[] {
    const provider = this.providers.get(providerName);
    return provider?.listModels() ?? [];
  }
}

// Singleton instance
export const llmRouter = new LLMRouter();
