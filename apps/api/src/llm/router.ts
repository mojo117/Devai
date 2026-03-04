import type { LLMProvider, LLMProviderAdapter, GenerateRequest, GenerateResponse } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { ZAIProvider } from './providers/zai.js';
import { MoonshotProvider } from './providers/moonshot.js';
import { logUsage } from './usage-logger.js';
import { errorTracker } from './circuitBreaker.js';

// Default fallback chain (removed anthropic/openai/gemini — use kimi as primary fallback)
const DEFAULT_FALLBACK_CHAIN: LLMProvider[] = ['zai', 'moonshot'];

// Default models per provider (used when falling back to a different provider)
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  zai: 'glm-4.7',
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-3.1-pro-preview',
  moonshot: 'kimi-k2.5',
};

// Check if a model belongs to a specific provider
function isModelForProvider(model: string, provider: LLMProvider): boolean {
  const providerPrefixes: Record<LLMProvider, string[]> = {
    zai: ['glm'],
    anthropic: ['claude'],
    openai: ['gpt', 'o1', 'o3'],
    gemini: ['gemini'],
    moonshot: ['kimi'],
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
    const moonshot = new MoonshotProvider();

    this.providers.set('zai', zai);
    this.providers.set('anthropic', anthropic);
    this.providers.set('openai', openai);
    this.providers.set('gemini', gemini);
    this.providers.set('moonshot', moonshot);
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
    // 429 rate limits get extra retries with longer backoff
    const isRateLimit = (msg: string): boolean => msg.includes('429') || msg.toLowerCase().includes('rate limit');

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.generate(providerName, request);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMsg = lastError.message;

        // 429 → extend retries up to 5 with longer backoff (2s, 4s, 8s, 16s, 32s) + jitter
        if (isRateLimit(errorMsg)) {
          const rateMaxRetries = Math.max(maxRetries, 5);
          if (attempt < rateMaxRetries) {
            const jitter = 1 + Math.random() * 0.3;
            const backoffMs = Math.round(Math.pow(2, attempt + 1) * 1000 * jitter);
            console.warn(`[llm] Rate-limited, retry ${attempt + 1}/${rateMaxRetries} for ${providerName} after ${backoffMs}ms`);
            await sleep(backoffMs);
            // Extend the loop bound so we keep retrying
            maxRetries = rateMaxRetries;
            continue;
          }
          // Exhausted rate-limit retries — fall through to throw
          break;
        }

        // Don't retry on non-transient client errors
        const lowerMsg = errorMsg.toLowerCase();
        if (lowerMsg.includes('400') ||
            lowerMsg.includes('401') ||
            lowerMsg.includes('403') ||
            lowerMsg.includes('invalid') ||
            lowerMsg.includes('unauthorized')) {
          throw lastError;
        }

        // Last attempt for non-rate-limit errors
        if (attempt === maxRetries) {
          throw lastError;
        }

        // Exponential backoff with jitter: 1s, 2s, 4s... (+ 0-30% random)
        const jitter = 1 + Math.random() * 0.3;
        const backoffMs = Math.round(Math.pow(2, attempt) * 1000 * jitter);
        console.warn(`[llm] Retry ${attempt + 1}/${maxRetries} for ${providerName} after ${backoffMs}ms:`, errorMsg);
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

      if (!errorTracker.isAvailable(providerName)) {
        console.info(`[llm] Skipping ${providerName} — too many recent errors`);
        errors.push({ provider: providerName, error: 'error tracker blocked' });
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
        errorTracker.recordSuccess(providerName);
        return { ...response, usedProvider: providerName };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ provider: providerName, error: errorMsg });
        console.warn(`[llm] Provider ${providerName} failed with primary model, trying same-provider fallbacks...`, errorMsg);

        // Try same-provider fallback models before moving to the next provider
        const fallbacks = request.sameProviderFallbacks ?? [];
        let recovered = false;
        for (const altModel of fallbacks) {
          // Only try if the model actually belongs to this provider
          if (!isModelForProvider(altModel, providerName)) continue;
          try {
            console.info(`[llm] Trying same-provider fallback ${altModel} on ${providerName}`);
            const response = await this.generateWithRetry(providerName, { ...request, model: altModel });
            errorTracker.recordSuccess(providerName);
            recovered = true;
            return { ...response, usedProvider: providerName };
          } catch (fallbackErr) {
            const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            console.warn(`[llm] Same-provider fallback ${altModel} on ${providerName} also failed:`, fbMsg);
          }
        }

        if (!recovered) {
          errorTracker.recordError(providerName, errorMsg);
          console.warn(`[llm] Provider ${providerName} exhausted, trying next...`);
        }
      }
    }

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

export { errorTracker } from './circuitBreaker.js';
