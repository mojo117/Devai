import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  scoutExtractSchema,
  scoutResearchBundle,
  scoutSearchDeep,
  scoutSearchFast,
  scoutSiteMap,
} from './firecrawl.js';

describe('firecrawl tools', () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.FIRECRAWL_API_KEY;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = 'test-firecrawl-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.FIRECRAWL_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  it('runs fast search and returns mapped results', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          web: [
            {
              title: 'Weather Darmstadt',
              url: 'https://example.com/weather',
              description: 'Forecast for today.',
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const result = await scoutSearchFast('weather darmstadt', { limit: 3 });

    expect(result.mode).toBe('fast');
    expect(result.totalResults).toBe(1);
    expect(result.results[0].url).toBe('https://example.com/weather');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/search',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('runs deep search with recency mapping', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: {
          web: [
            {
              title: 'Release notes',
              url: 'https://example.com/release',
              description: 'Latest updates',
              markdown: '# Update',
              publishedDate: '2026-02-20',
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const result = await scoutSearchDeep('release updates', { recency: 'week' });

    expect(result.mode).toBe('deep');
    expect(result.totalResults).toBe(1);
    expect(result.findings[0].freshness).toContain('published:');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/search',
      expect.objectContaining({
        body: expect.stringContaining('"tbs":"qdr:w"'),
      }),
    );
  });

  it('validates site map url and returns urls', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        data: ['https://example.com/docs', 'https://example.com/pricing'],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const result = await scoutSiteMap('https://93.184.216.34', { limit: 2 });

    expect(result.totalUrls).toBe(2);
    expect(result.urls[0]).toContain('https://example.com');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/map',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('validates extract input and forwards schema payload', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        status: 'completed',
        data: { items: [{ title: 'Result' }] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const result = await scoutExtractSchema(
      ['https://93.184.216.34'],
      {
        prompt: 'extract titles',
        schema: { type: 'object', properties: { title: { type: 'string' } } },
      },
    );

    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/extract',
      expect.objectContaining({
        body: expect.stringContaining('"schema"'),
      }),
    );
  });

  it('fails with clear error when API key is missing', async () => {
    process.env.FIRECRAWL_API_KEY = '';
    await expect(scoutSearchFast('any query')).rejects.toThrow('FIRECRAWL_API_KEY not configured');
  });

  it('builds a research bundle with merged and filtered findings', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          success: true,
          data: {
            web: [
              {
                title: 'Guide',
                url: 'https://docs.example.com/guide',
                description: 'Quick guide',
              },
              {
                title: 'Off-domain',
                url: 'https://other.example.net/post',
                description: 'Should be filtered',
              },
            ],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          success: true,
          data: {
            web: [
              {
                title: 'Guide Deep',
                url: 'https://docs.example.com/guide',
                description: 'Detailed claim',
                markdown: '# Deep details\nMore evidence here',
                publishedDate: '2026-02-21',
              },
              {
                title: 'External Deep',
                url: 'https://irrelevant.com/post',
                description: 'filtered',
                markdown: '# No',
              },
            ],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as unknown as typeof fetch;

    const result = await scoutResearchBundle('example docs', {
      domains: ['docs.example.com'],
      recencyDays: 7,
      maxFindings: 5,
    });

    expect(result.mode).toBe('bundle');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].url).toBe('https://docs.example.com/guide');
    expect(result.findings[0].confidence).toBe('medium');
    expect(result.summary).toContain('recency=week');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
