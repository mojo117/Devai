/**
 * Perplexity API Client for web search
 * Used by Scout agent for real-time web information
 */

export type PerplexityModel = 'sonar' | 'sonar-pro' | 'sonar-reasoning';

export interface PerplexitySearchRequest {
  query: string;
  model?: PerplexityModel;
  searchRecencyFilter?: 'day' | 'week' | 'month' | 'year';
}

export interface PerplexityCitation {
  url: string;
  title?: string;
}

export interface PerplexitySearchResponse {
  answer: string;
  citations: PerplexityCitation[];
  model: PerplexityModel;
}

export class PerplexityClient {
  private apiKey: string;
  private baseUrl = 'https://api.perplexity.ai';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Check if the client is configured with an API key
   */
  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Search the web using Perplexity API
   */
  async search(request: PerplexitySearchRequest): Promise<PerplexitySearchResponse> {
    const model = request.model || 'sonar';

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: request.query,
          },
        ],
        ...(request.searchRecencyFilter && {
          search_recency_filter: request.searchRecencyFilter,
        }),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Perplexity API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Extract answer from response
    const answer = data.choices?.[0]?.message?.content || '';

    // Extract citations if available
    const citations: PerplexityCitation[] = (data.citations || []).map((url: string) => ({
      url,
      title: extractDomainFromUrl(url),
    }));

    return {
      answer,
      citations,
      model,
    };
  }
}

/**
 * Extract domain name from URL for display
 */
function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

/**
 * Map complexity level to Perplexity model
 */
export function complexityToModel(complexity: 'simple' | 'detailed' | 'deep'): PerplexityModel {
  switch (complexity) {
    case 'simple':
      return 'sonar';
    case 'detailed':
      return 'sonar-pro';
    case 'deep':
      return 'sonar-reasoning';
    default:
      return 'sonar';
  }
}

/**
 * Format search response with citations for display
 */
export function formatSearchResponse(response: PerplexitySearchResponse): string {
  let result = response.answer;

  if (response.citations.length > 0) {
    result += '\n\nQuellen:\n';
    result += response.citations
      .map((c) => `- [${c.title || c.url}](${c.url})`)
      .join('\n');
  }

  return result;
}

// Singleton instance
let perplexityClient: PerplexityClient | null = null;

/**
 * Get or create Perplexity client instance
 */
export function getPerplexityClient(): PerplexityClient | null {
  if (!perplexityClient) {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (apiKey) {
      perplexityClient = new PerplexityClient(apiKey);
    }
  }
  return perplexityClient;
}

/**
 * Check if Perplexity is configured
 */
export function isPerplexityConfigured(): boolean {
  return Boolean(process.env.PERPLEXITY_API_KEY);
}
