function normalizeSegments(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * Normalizes a namespace prefix used for retrieval filters.
 * Returns an empty string if the input has no usable namespace content.
 */
export function normalizeNamespacePrefix(raw: string | null | undefined): string {
  if (!raw) return '';
  return normalizeSegments(raw);
}

/**
 * Normalizes a stored memory namespace and falls back to a safe default.
 */
export function normalizeMemoryNamespace(
  raw: string | null | undefined,
  fallback: string = 'devai/general',
): string {
  const normalized = normalizeNamespacePrefix(raw);
  if (normalized) return normalized;
  const fallbackNormalized = normalizeNamespacePrefix(fallback);
  return fallbackNormalized || 'devai/general';
}

/**
 * Deduplicates and normalizes namespace prefixes while preserving order.
 */
export function uniqueNormalizedNamespaces(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeNamespacePrefix(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
