import type { ToolDefinition } from '../registry.js';

export const webTools: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information using Perplexity AI. Use for: weather, news, documentation, best practices, tutorials, comparisons.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string (e.g., "Wetter Berlin", "React 19 new features")',
        },
        complexity: {
          type: 'string',
          description: 'Search depth: "simple" for quick facts, "detailed" for explanations, "deep" for thorough analysis',
        },
        recency: {
          type: 'string',
          description: 'Limit to recent content: "day", "week", "month", or "year"',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'web_fetch',
    description: 'Fetch and extract content from a URL. Returns text content with HTML stripped.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch (must be http or https)',
        },
        timeout: {
          type: 'number',
          description: 'Request timeout in milliseconds (default: 10000)',
        },
      },
      required: ['url'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'search_quick',
    description: 'Quick web search for fast orientation and source discovery (Firecrawl). Use for finding relevant URLs and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        limit: {
          type: 'number',
          description: 'Max number of results (1-10, default: 5)',
        },
        country: {
          type: 'string',
          description: 'Country hint for localized search results (optional, e.g. "de", "us")',
        },
        location: {
          type: 'string',
          description: 'Location hint for localized search results (optional, e.g. "Berlin, Germany")',
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional source buckets: web, news',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional categories: research, github, pdf',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'search_deep',
    description: 'Deep web search with full-page markdown extraction for evidence-rich findings (Firecrawl). Use when you need actual page content.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        limit: {
          type: 'number',
          description: 'Max number of results (1-10, default: 5)',
        },
        country: {
          type: 'string',
          description: 'Country hint for localized search results (optional, e.g. "de", "us")',
        },
        location: {
          type: 'string',
          description: 'Location hint for localized search results (optional)',
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional source buckets: web, news',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional categories: research, github, pdf',
        },
        recency: {
          type: 'string',
          description: 'Optional freshness filter: day, week, month, year',
          enum: ['day', 'week', 'month', 'year'],
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'search_site_map',
    description: 'Discover all URLs on a website (Firecrawl map). Use to understand site structure before crawling.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Target site URL',
        },
        search: {
          type: 'string',
          description: 'Optional substring filter for mapped URLs',
        },
        limit: {
          type: 'number',
          description: 'Max number of mapped URLs (1-10, default: 10)',
        },
        includeSubdomains: {
          type: 'boolean',
          description: 'Whether to include subdomains',
        },
        ignoreSitemap: {
          type: 'boolean',
          description: 'Ignore sitemap and discover URLs via crawling only',
        },
        sitemapOnly: {
          type: 'boolean',
          description: 'Use only sitemap-based URL discovery',
        },
      },
      required: ['url'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'search_crawl',
    description: 'Crawl multiple pages on a domain with path filtering (Firecrawl). Use for multi-page content extraction.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Target site URL',
        },
        prompt: {
          type: 'string',
          description: 'Optional natural-language crawl objective',
        },
        includePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional include path patterns',
        },
        excludePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional exclude path patterns',
        },
        maxPages: {
          type: 'number',
          description: 'Max pages to crawl (1-10, default: 5)',
        },
        maxDepth: {
          type: 'number',
          description: 'Max discovery depth (1-5, default: 2)',
        },
        includeSubdomains: {
          type: 'boolean',
          description: 'Whether to include subdomains',
        },
        allowExternalLinks: {
          type: 'boolean',
          description: 'Whether Firecrawl may traverse external links',
        },
      },
      required: ['url'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'search_extract',
    description: 'Extract structured JSON data from URLs using a schema (Firecrawl). Use for prices, specs, structured data.',
    parameters: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of URLs to extract from (max 25)',
        },
        prompt: {
          type: 'string',
          description: 'Optional extraction objective/instructions',
        },
        schema: {
          type: 'object',
          description: 'Optional JSON schema for structured extraction',
        },
        enableWebSearch: {
          type: 'boolean',
          description: 'Allow Firecrawl to augment extraction with web search',
        },
      },
      required: ['urls'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'search_research',
    description: 'Comprehensive research: runs quick + deep search, merges and dedupes findings, returns confidence-ranked evidence (Firecrawl).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Research query string',
        },
        domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional domain filters (e.g. docs.example.com, github.com)',
        },
        recencyDays: {
          type: 'number',
          description: 'Optional recency window in days (mapped internally to Firecrawl day/week/month/year)',
        },
        maxFindings: {
          type: 'number',
          description: 'Maximum number of merged findings (1-10, default: 5)',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
];
