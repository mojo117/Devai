/**
 * Web Tools - Search and Fetch
 *
 * Provides web search via Brave Search API and URL content fetching.
 * Used by SCOUT agent for research tasks.
 */

// ============================================
// TYPES
// ============================================

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  limit?: number;
  freshness?: 'day' | 'week' | 'month';
}

export interface WebFetchResult {
  url: string;
  title?: string;
  content: string;
  contentType: string;
  truncated: boolean;
}

export interface WebFetchOptions {
  timeout?: number;
  maxLength?: number;
}

// ============================================
// WEB SEARCH (Brave Search API)
// ============================================

/**
 * Search the web using Brave Search API
 *
 * @param query - Search query string
 * @param options - Search options (limit, freshness)
 * @returns Array of search results
 */
export async function webSearch(
  query: string,
  options: WebSearchOptions = {}
): Promise<WebSearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;

  if (!apiKey) {
    throw new Error(
      'BRAVE_API_KEY not configured. Please set it in your environment variables.\n' +
        'Get an API key from: https://brave.com/search/api/'
    );
  }

  const { limit = 5, freshness } = options;

  // Build query parameters
  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(Math.max(limit, 1), 10)), // Clamp between 1-10
  });

  if (freshness) {
    params.set('freshness', freshness);
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          'X-Subscription-Token': apiKey,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brave Search API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Extract and format results
    const results: WebSearchResult[] = (data.web?.results ?? []).map(
      (r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      })
    );

    return results;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Brave Search API')) {
      throw error;
    }
    throw new Error(
      `Web search failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================
// WEB FETCH (URL Content Extraction)
// ============================================

/**
 * Fetch and extract content from a URL
 *
 * @param url - URL to fetch
 * @param options - Fetch options (timeout, maxLength)
 * @returns Extracted content
 */
export async function webFetch(
  url: string,
  options: WebFetchOptions = {}
): Promise<WebFetchResult> {
  const { maxLength = 50000, timeout = 10000 } = options;

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Security check: only allow http/https
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Unsupported protocol: ${parsedUrl.protocol}. Only http/https allowed.`);
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'DevAI-Scout/1.0 (Research Bot)',
        Accept: 'text/html,application/json,text/plain,*/*',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? 'text/html';
    let content = await response.text();
    let title: string | undefined;

    // Extract text based on content type
    if (contentType.includes('html')) {
      const extracted = extractFromHtml(content);
      content = extracted.text;
      title = extracted.title;
    } else if (contentType.includes('json')) {
      // Pretty print JSON for readability
      try {
        const parsed = JSON.parse(content);
        content = JSON.stringify(parsed, null, 2);
      } catch {
        // Keep as-is if not valid JSON
      }
    }

    // Truncate if too long
    const truncated = content.length > maxLength;
    if (truncated) {
      content = content.slice(0, maxLength) + '\n\n...[content truncated]';
    }

    return {
      url,
      title,
      content,
      contentType,
      truncated,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms for URL: ${url}`);
      }
      throw new Error(`Fetch failed for ${url}: ${error.message}`);
    }
    throw new Error(`Fetch failed for ${url}: ${String(error)}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================
// HTML EXTRACTION HELPERS
// ============================================

interface ExtractedHtml {
  title?: string;
  text: string;
}

/**
 * Extract readable text and title from HTML content
 */
function extractFromHtml(html: string): ExtractedHtml {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : undefined;

  // Remove unwanted elements
  let text = html
    // Remove script tags and content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove style tags and content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove noscript tags and content
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    // Remove comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove head section
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    // Remove nav sections
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    // Remove footer sections
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // Convert block elements to newlines
  text = text
    .replace(/<\/?(div|p|br|li|h[1-6]|section|article|header|tr)[^>]*>/gi, '\n')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    // Normalize whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  return { title, text };
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}
