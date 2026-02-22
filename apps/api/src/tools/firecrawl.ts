/**
 * Firecrawl Tools - Structured web research for SCOUT.
 *
 * Uses Firecrawl v2 endpoints for fast/deep search, site mapping,
 * focused crawling, and schema extraction.
 */

import { assertPublicHttpUrl } from './urlSafety.js';

const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev';
const MAX_LIMIT = 10;
const MAX_URLS = 25;

type FirecrawlCategory = 'github' | 'research' | 'pdf';
type FirecrawlSource = 'web' | 'news';
type FirecrawlRecency = 'day' | 'week' | 'month' | 'year';


interface FirecrawlSearchWebItem {
  title?: string;
  url?: string;
  description?: string;
  markdown?: string;
  links?: string[];
  publishedDate?: string;
}

interface FirecrawlSearchResponse {
  success?: boolean;
  warning?: string;
  data?: {
    web?: FirecrawlSearchWebItem[];
  };
}

interface FirecrawlMapResponse {
  success?: boolean;
  warning?: string;
  data?: string[];
}

interface FirecrawlCrawlResponse {
  success?: boolean;
  warning?: string;
  id?: string;
  url?: string;
  status?: string;
}

interface FirecrawlExtractResponse {
  success?: boolean;
  warning?: string;
  id?: string;
  status?: string;
  data?: unknown;
  error?: string;
}

export interface ScoutSearchFastOptions {
  limit?: number;
  country?: string;
  location?: string;
  categories?: FirecrawlCategory[];
  sources?: FirecrawlSource[];
}

export interface ScoutSearchDeepOptions {
  limit?: number;
  country?: string;
  location?: string;
  categories?: FirecrawlCategory[];
  sources?: FirecrawlSource[];
  recency?: FirecrawlRecency;
}

export interface ScoutSiteMapOptions {
  search?: string;
  limit?: number;
  includeSubdomains?: boolean;
  ignoreSitemap?: boolean;
  sitemapOnly?: boolean;
}

export interface ScoutFocusedCrawlOptions {
  prompt?: string;
  includePaths?: string[];
  excludePaths?: string[];
  maxPages?: number;
  maxDepth?: number;
  includeSubdomains?: boolean;
  allowExternalLinks?: boolean;
}

export interface ScoutExtractSchemaOptions {
  prompt?: string;
  schema?: Record<string, unknown>;
  enableWebSearch?: boolean;
}

export interface ScoutResearchBundleOptions {
  domains?: string[];
  recencyDays?: number;
  maxFindings?: number;
}

interface EvidenceItem {
  url: string;
  snippet?: string;
  publishedAt?: string;
}

interface BundleFinding {
  title: string;
  url: string;
  claim: string;
  evidenceSnippet?: string;
  freshness?: string;
  confidence: 'high' | 'medium' | 'low';
}

function normalizeLimit(limit: unknown, fallback: number): number {
  const value = typeof limit === 'number' ? Math.floor(limit) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, value));
}

function normalizeUrls(urls: string[]): string[] {
  const deduped = Array.from(new Set(urls.map((item) => item.trim()).filter((item) => item.length > 0)));
  return deduped.slice(0, MAX_URLS);
}

function recencyFromDays(days?: number): FirecrawlRecency | undefined {
  if (!Number.isFinite(days)) return undefined;
  const normalized = Math.max(1, Math.floor(days as number));
  if (normalized <= 2) return 'day';
  if (normalized <= 14) return 'week';
  if (normalized <= 45) return 'month';
  return 'year';
}

function normalizeDomainFilters(domains?: string[]): string[] {
  if (!Array.isArray(domains)) return [];
  const normalized = domains
    .map((value) => String(value || '').trim().toLowerCase())
    .map((value) => value.replace(/^https?:\/\//, ''))
    .map((value) => value.replace(/\/.*$/, ''))
    .map((value) => value.replace(/^\*\./, ''))
    .filter((value) => value.length > 0);
  return Array.from(new Set(normalized)).slice(0, 10);
}

function urlMatchesDomains(url: string, domains: string[]): boolean {
  if (domains.length === 0) return true;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function confidenceRank(confidence: 'high' | 'medium' | 'low'): number {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  return 1;
}

function toTbs(recency?: FirecrawlRecency): string | undefined {
  if (!recency) return undefined;
  if (recency === 'day') return 'qdr:d';
  if (recency === 'week') return 'qdr:w';
  if (recency === 'month') return 'qdr:m';
  if (recency === 'year') return 'qdr:y';
  return undefined;
}

function truncate(text: string | undefined, maxChars: number): string {
  const raw = (text || '').trim();
  if (!raw) return '';
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}...`;
}

function getFirecrawlApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'FIRECRAWL_API_KEY not configured. Please set it in your environment variables.',
    );
  }
  return key;
}

async function postFirecrawl<TResponse>(
  path: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  const apiKey = getFirecrawlApiKey();
  const response = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let parsedBody: unknown = null;
  if (rawText) {
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      parsedBody = rawText;
    }
  }

  if (!response.ok) {
    const detail = typeof parsedBody === 'string'
      ? parsedBody
      : JSON.stringify(parsedBody);
    throw new Error(`Firecrawl API error (${response.status}): ${truncate(detail, 600)}`);
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    throw new Error('Firecrawl API returned an empty or invalid JSON response.');
  }

  return parsedBody as TResponse;
}

function normalizeFindingsForDeepSearch(results: FirecrawlSearchWebItem[]): Array<{
  title: string;
  url: string;
  claim: string;
  relevance: string;
  evidence: EvidenceItem[];
  freshness: string;
  confidence: 'high' | 'medium' | 'low';
  gaps: string[];
}> {
  return results.map((item) => {
    const url = (item.url || '').trim();
    const title = (item.title || item.url || 'Untitled').trim();
    const description = truncate(item.description, 320);
    const snippet = truncate(item.markdown || item.description, 600);
    const claim = description || truncate(item.markdown, 200) || 'No direct claim extracted.';
    const freshness = item.publishedDate ? `published:${item.publishedDate}` : 'unknown';
    const confidence: 'high' | 'medium' | 'low' = item.markdown
      ? (item.markdown.length > 400 ? 'high' : 'medium')
      : 'low';

    const evidence: EvidenceItem[] = [];
    if (url) {
      evidence.push({
        url,
        snippet: snippet || undefined,
        publishedAt: item.publishedDate,
      });
    }

    const gaps: string[] = [];
    if (!item.markdown) gaps.push('No markdown content returned by Firecrawl.');
    if (!item.publishedDate) gaps.push('No explicit publish date available.');

    return {
      title,
      url,
      claim,
      relevance: description || claim,
      evidence,
      freshness,
      confidence,
      gaps,
    };
  });
}

export async function scoutSearchFast(
  query: string,
  options: ScoutSearchFastOptions = {},
): Promise<{
  mode: 'fast';
  query: string;
  totalResults: number;
  results: Array<{
    title: string;
    url: string;
    description: string;
    publishedDate?: string;
  }>;
  warning?: string;
}> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) throw new Error('Query cannot be empty.');

  const payload: Record<string, unknown> = {
    query: trimmedQuery,
    limit: normalizeLimit(options.limit, 5),
  };
  if (options.country) payload.country = options.country.trim();
  if (options.location) payload.location = options.location.trim();
  if (options.categories?.length) payload.categories = options.categories;
  if (options.sources?.length) payload.sources = options.sources;

  const response = await postFirecrawl<FirecrawlSearchResponse>('/v2/search', payload);
  const results = response.data?.web || [];

  return {
    mode: 'fast',
    query: trimmedQuery,
    totalResults: results.length,
    results: results.map((item) => ({
      title: (item.title || item.url || 'Untitled').trim(),
      url: (item.url || '').trim(),
      description: truncate(item.description, 320),
      publishedDate: item.publishedDate,
    })),
    warning: response.warning,
  };
}

export async function scoutSearchDeep(
  query: string,
  options: ScoutSearchDeepOptions = {},
): Promise<{
  mode: 'deep';
  query: string;
  totalResults: number;
  findings: Array<{
    title: string;
    url: string;
    claim: string;
    relevance: string;
    evidence: EvidenceItem[];
    freshness: string;
    confidence: 'high' | 'medium' | 'low';
    gaps: string[];
  }>;
  warning?: string;
}> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) throw new Error('Query cannot be empty.');

  const payload: Record<string, unknown> = {
    query: trimmedQuery,
    limit: normalizeLimit(options.limit, 5),
    scrapeOptions: {
      formats: ['markdown', 'links'],
      onlyMainContent: true,
    },
  };
  if (options.country) payload.country = options.country.trim();
  if (options.location) payload.location = options.location.trim();
  if (options.categories?.length) payload.categories = options.categories;
  if (options.sources?.length) payload.sources = options.sources;
  const tbs = toTbs(options.recency);
  if (tbs) payload.tbs = tbs;

  const response = await postFirecrawl<FirecrawlSearchResponse>('/v2/search', payload);
  const results = response.data?.web || [];

  return {
    mode: 'deep',
    query: trimmedQuery,
    totalResults: results.length,
    findings: normalizeFindingsForDeepSearch(results),
    warning: response.warning,
  };
}

export async function scoutSiteMap(
  url: string,
  options: ScoutSiteMapOptions = {},
): Promise<{
  url: string;
  totalUrls: number;
  urls: string[];
  warning?: string;
}> {
  const targetUrl = url.trim();
  if (!targetUrl) throw new Error('URL cannot be empty.');
  await assertPublicHttpUrl(targetUrl);

  const payload: Record<string, unknown> = {
    url: targetUrl,
    limit: normalizeLimit(options.limit, 10),
  };
  if (options.search) payload.search = options.search.trim();
  if (typeof options.includeSubdomains === 'boolean') payload.includeSubdomains = options.includeSubdomains;
  if (typeof options.ignoreSitemap === 'boolean') payload.ignoreSitemap = options.ignoreSitemap;
  if (typeof options.sitemapOnly === 'boolean') payload.sitemapOnly = options.sitemapOnly;

  const response = await postFirecrawl<FirecrawlMapResponse>('/v2/map', payload);
  const urls = normalizeUrls(response.data || []);

  return {
    url: targetUrl,
    totalUrls: urls.length,
    urls,
    warning: response.warning,
  };
}

export async function scoutCrawlFocused(
  url: string,
  options: ScoutFocusedCrawlOptions = {},
): Promise<{
  url: string;
  jobId: string | null;
  status: string;
  trackingUrl: string | null;
  warning?: string;
}> {
  const targetUrl = url.trim();
  if (!targetUrl) throw new Error('URL cannot be empty.');
  await assertPublicHttpUrl(targetUrl);

  const payload: Record<string, unknown> = {
    url: targetUrl,
    limit: normalizeLimit(options.maxPages, 5),
    maxDiscoveryDepth: Math.max(1, Math.min(5, Math.floor(options.maxDepth || 2))),
    allowExternalLinks: Boolean(options.allowExternalLinks),
    scrapeOptions: {
      formats: ['markdown', 'links'],
      onlyMainContent: true,
    },
  };
  if (options.prompt?.trim()) payload.prompt = options.prompt.trim();
  if (options.includePaths?.length) payload.includePaths = options.includePaths;
  if (options.excludePaths?.length) payload.excludePaths = options.excludePaths;
  if (typeof options.includeSubdomains === 'boolean') payload.includeSubdomains = options.includeSubdomains;

  const response = await postFirecrawl<FirecrawlCrawlResponse>('/v2/crawl', payload);

  return {
    url: targetUrl,
    jobId: response.id || null,
    status: response.status || (response.id ? 'started' : 'unknown'),
    trackingUrl: response.url || null,
    warning: response.warning,
  };
}

export async function scoutExtractSchema(
  urls: string[],
  options: ScoutExtractSchemaOptions = {},
): Promise<{
  urls: string[];
  status: string;
  id: string | null;
  data: unknown;
  error: string | null;
  warning?: string;
}> {
  const normalizedUrls = normalizeUrls(urls);
  if (normalizedUrls.length === 0) {
    throw new Error('At least one URL is required.');
  }
  for (const url of normalizedUrls) {
    await assertPublicHttpUrl(url);
  }

  const payload: Record<string, unknown> = {
    urls: normalizedUrls,
    enableWebSearch: Boolean(options.enableWebSearch),
  };
  if (options.prompt?.trim()) payload.prompt = options.prompt.trim();
  if (options.schema && typeof options.schema === 'object') payload.schema = options.schema;

  const response = await postFirecrawl<FirecrawlExtractResponse>('/v2/extract', payload);

  return {
    urls: normalizedUrls,
    status: response.status || 'unknown',
    id: response.id || null,
    data: response.data ?? null,
    error: response.error || null,
    warning: response.warning,
  };
}

export async function scoutResearchBundle(
  query: string,
  options: ScoutResearchBundleOptions = {},
): Promise<{
  mode: 'bundle';
  query: string;
  summary: string;
  findings: BundleFinding[];
  gaps: string[];
  warnings?: string[];
}> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) throw new Error('Query cannot be empty.');

  const maxFindings = normalizeLimit(options.maxFindings, 5);
  const domains = normalizeDomainFilters(options.domains);
  const recency = recencyFromDays(options.recencyDays);

  const warnings: string[] = [];
  let fastResult: Awaited<ReturnType<typeof scoutSearchFast>> | null = null;
  let deepResult: Awaited<ReturnType<typeof scoutSearchDeep>> | null = null;

  try {
    fastResult = await scoutSearchFast(trimmedQuery, { limit: maxFindings });
    if (fastResult.warning) warnings.push(`fast: ${fastResult.warning}`);
  } catch (error) {
    warnings.push(`fast failed: ${(error as Error).message}`);
  }

  try {
    deepResult = await scoutSearchDeep(trimmedQuery, {
      limit: maxFindings,
      recency,
    });
    if (deepResult.warning) warnings.push(`deep: ${deepResult.warning}`);
  } catch (error) {
    warnings.push(`deep failed: ${(error as Error).message}`);
  }

  if (!fastResult && !deepResult) {
    throw new Error(`research bundle failed for both fast/deep search: ${warnings.join(' | ')}`);
  }

  const byUrl = new Map<string, BundleFinding>();
  const gaps: string[] = [];

  for (const finding of deepResult?.findings || []) {
    const url = finding.url.trim();
    if (!url || !urlMatchesDomains(url, domains)) continue;
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        title: finding.title,
        url,
        claim: finding.claim,
        evidenceSnippet: finding.evidence[0]?.snippet,
        freshness: finding.freshness,
        confidence: finding.confidence,
      });
    }
    for (const gap of finding.gaps || []) {
      if (!gaps.includes(gap)) gaps.push(gap);
    }
  }

  for (const result of fastResult?.results || []) {
    const url = result.url.trim();
    if (!url || !urlMatchesDomains(url, domains)) continue;
    if (byUrl.has(url)) continue;
    byUrl.set(url, {
      title: result.title,
      url,
      claim: result.description || result.title,
      evidenceSnippet: result.description || undefined,
      freshness: result.publishedDate ? `published:${result.publishedDate}` : 'unknown',
      confidence: result.description ? 'medium' : 'low',
    });
  }

  const findings = Array.from(byUrl.values())
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
    .slice(0, maxFindings);

  if (findings.length === 0) {
    gaps.push('No findings matched the requested filters.');
  }

  const summaryBits: string[] = [];
  summaryBits.push(`Found ${findings.length} finding(s)`);
  if (domains.length > 0) summaryBits.push(`filtered to ${domains.join(', ')}`);
  if (recency) summaryBits.push(`recency=${recency}`);
  if (warnings.length > 0) summaryBits.push(`${warnings.length} warning(s)`);

  return {
    mode: 'bundle',
    query: trimmedQuery,
    summary: `${summaryBits.join(' | ')}.`,
    findings,
    gaps: gaps.slice(0, 6),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
