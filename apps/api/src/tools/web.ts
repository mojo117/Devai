/**
 * Web Tools - Search and Fetch
 *
 * Provides web search via Perplexity API and URL content fetching.
 * Used by SCOUT agent for research tasks.
 */

import { isIP } from 'node:net';
import dns from 'node:dns/promises';

import {
  getPerplexityClient,
  isPerplexityConfigured,
  complexityToModel,
  formatSearchResponse,
  type PerplexitySearchResponse,
} from '../llm/perplexity.js';

// ============================================
// TYPES
// ============================================

export interface WebSearchResult {
  answer: string;
  citations: { url: string; title?: string }[];
  model: string;
}

export interface WebSearchOptions {
  complexity?: 'simple' | 'detailed' | 'deep';
  recency?: 'day' | 'week' | 'month' | 'year';
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
// WEB SEARCH (Perplexity API)
// ============================================

/**
 * Search the web using Perplexity API
 *
 * @param query - Search query string
 * @param options - Search options (complexity, recency)
 * @returns Search result with answer and citations
 */
export async function webSearch(
  query: string,
  options: WebSearchOptions = {}
): Promise<WebSearchResult> {
  if (!isPerplexityConfigured()) {
    throw new Error(
      'PERPLEXITY_API_KEY not configured. Please set it in your environment variables.\n' +
        'Get an API key from: https://www.perplexity.ai/settings/api'
    );
  }

  const client = getPerplexityClient();
  if (!client) {
    throw new Error('Failed to initialize Perplexity client');
  }

  const { complexity = 'simple', recency } = options;
  const model = complexityToModel(complexity);

  try {
    const response = await client.search({
      query,
      model,
      searchRecencyFilter: recency,
    });

    return {
      answer: response.answer,
      citations: response.citations,
      model: response.model,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Perplexity API')) {
      throw error;
    }
    throw new Error(
      `Web search failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Format web search result for display
 */
export function formatWebSearchResult(result: WebSearchResult): string {
  let output = result.answer;

  if (result.citations.length > 0) {
    output += '\n\nQuellen:\n';
    output += result.citations
      .map((c) => `- [${c.title || c.url}](${c.url})`)
      .join('\n');
  }

  return output;
}

// ============================================
// SSRF PROTECTION
// ============================================

const PRIVATE_IP_RANGES = [
  /^127\./,                    // loopback
  /^10\./,                     // class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // class B private
  /^192\.168\./,               // class C private
  /^169\.254\./,               // link-local
  /^0\./,                      // current network
  /^::1$/,                     // IPv6 loopback
  /^fc00:/i,                   // IPv6 ULA
  /^fe80:/i,                   // IPv6 link-local
  /^fd/i,                      // IPv6 ULA
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

async function checkSsrf(hostname: string): Promise<void> {
  // Check if hostname is already an IP
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Blocked: "${hostname}" resolves to a private/internal IP address.`);
    }
    return;
  }

  // Resolve DNS and check all addresses
  try {
    const addresses = await dns.resolve4(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new Error(`Blocked: "${hostname}" resolves to private IP ${addr}.`);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      throw new Error(`DNS lookup failed for "${hostname}".`);
    }
    // For other DNS errors, allow the request (will fail at fetch level)
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

  // SSRF protection: block private/internal IPs
  await checkSsrf(parsedUrl.hostname);

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
