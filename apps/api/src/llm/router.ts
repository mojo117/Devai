import type { LLMProvider, LLMProviderAdapter, GenerateRequest, GenerateResponse } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { ZAIProvider } from './providers/zai.js';
import { logUsage } from './usage-logger.js';

// Default fallback chain
const DEFAULT_FALLBACK_CHAIN: LLMProvider[] = ['zai', 'anthropic', 'openai', 'gemini'];

// Default models per provider (used when falling back to a different provider)
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  zai: 'glm-4.7',
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
};

// Check if a model belongs to a specific provider
function isModelForProvider(model: string, provider: LLMProvider): boolean {
  const providerPrefixes: Record<LLMProvider, string[]> = {
    zai: ['glm'],
    anthropic: ['claude'],
    openai: ['gpt', 'o1', 'o3'],
    gemini: ['gemini'],
  };
  const prefixes = providerPrefixes[provider] || [];
  return prefixes.some(prefix => model.toLowerCase().startsWith(prefix));
}

// Helper for exponential backoff
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class LLMRouter {
  private providers: Map<LLMProvider, LLMProviderAdapter>;

  constructor() {
    this.providers = new Map();

    // Register all providers
    const anthropic = new AnthropicProvider();
    const openai = new OpenAIProvider();
    const gemini = new GeminiProvider();

    const zai = new ZAIProvider();

    this.providers.set('zai', zai);
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

    const response = await provider.generate(request);
    if (response.usage) {
      logUsage(providerName, request.model || 'unknown', response.usage.inputTokens, response.usage.outputTokens);
    }
    return response;
  }

  /**
   * Generate with automatic retry on transient failures
   */
  async generateWithRetry(
    providerName: LLMProvider,
    request: GenerateRequest,
    maxRetries: number = 2
  ): Promise<GenerateResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.generate(providerName, request);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) - these won't succeed on retry
        const errorMsg = lastError.message.toLowerCase();
        if (errorMsg.includes('400') ||
            errorMsg.includes('401') ||
            errorMsg.includes('403') ||
            errorMsg.includes('invalid') ||
            errorMsg.includes('unauthorized')) {
          throw lastError;
        }

        // Last attempt - don't wait, just throw
        if (attempt === maxRetries) {
          throw lastError;
        }

        // Exponential backoff: 1s, 2s, 4s...
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.warn(`[llm] Retry ${attempt + 1}/${maxRetries} for ${providerName} after ${backoffMs}ms:`, lastError.message);
        await sleep(backoffMs);
      }
    }

    throw lastError || new Error('Unknown error in generateWithRetry');
  }

  /**
   * Generate with fallback across multiple providers
   *
   * Tries the preferred provider first, then falls back to alternatives.
   * When falling back to a different provider, the model is automatically
   * adjusted to a compatible model for that provider.
   */
  async generateWithFallback(
    preferredProvider: LLMProvider,
    request: GenerateRequest,
    fallbackProviders?: LLMProvider[]
  ): Promise<GenerateResponse & { usedProvider: LLMProvider }> {
    const providers = [preferredProvider, ...(fallbackProviders || DEFAULT_FALLBACK_CHAIN)];
    // Remove duplicates while preserving order
    const uniqueProviders = [...new Set(providers)];

    const errors: Array<{ provider: LLMProvider; error: string }> = [];
    const originalModel = request.model;

    for (const providerName of uniqueProviders) {
      if (!this.isProviderConfigured(providerName)) {
        continue;
      }

      // Adjust model if it doesn't match the current provider
      let adjustedRequest = request;
      if (originalModel && !isModelForProvider(originalModel, providerName)) {
        const fallbackModel = DEFAULT_MODELS[providerName];
        console.info(`[llm] Adjusting model from ${originalModel} to ${fallbackModel} for provider ${providerName}`);
        adjustedRequest = { ...request, model: fallbackModel };
      }

      try {
        const response = await this.generateWithRetry(providerName, adjustedRequest);
        return { ...response, usedProvider: providerName };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ provider: providerName, error: errorMsg });
        console.warn(`[llm] Provider ${providerName} failed, trying next...`, errorMsg);
      }
    }

    // All providers failed
    const errorSummary = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
    throw new Error(`All LLM providers failed. Errors: ${errorSummary}`);
  }

  listModels(providerName: LLMProvider): string[] {
    const provider = this.providers.get(providerName);
    return provider?.listModels() ?? [];
  }
}

// Singleton instance
export const llmRouter = new LLMRouter();
