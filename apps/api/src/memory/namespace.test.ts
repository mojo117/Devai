import { describe, expect, it } from 'vitest';
import {
  normalizeMemoryNamespace,
  normalizeNamespacePrefix,
  uniqueNormalizedNamespaces,
} from './namespace.js';

describe('memory namespace normalization', () => {
  it('normalizes prefixes by trimming, lowercasing, and collapsing slashes', () => {
    expect(normalizeNamespacePrefix('  /DevAI//Project/Klyde/  ')).toBe('devai/project/klyde');
    expect(normalizeNamespacePrefix('')).toBe('');
    expect(normalizeNamespacePrefix(undefined)).toBe('');
  });

  it('normalizes storage namespace with fallback', () => {
    expect(normalizeMemoryNamespace('/PERSONA/Role/')).toBe('persona/role');
    expect(normalizeMemoryNamespace('   ', 'DevAI/General')).toBe('devai/general');
  });

  it('deduplicates normalized namespace scopes while preserving order', () => {
    const scopes = uniqueNormalizedNamespaces([
      '/devai/project/Klyde/',
      'devai/project/klyde',
      'persona',
      '/persona/',
      '',
      null,
      undefined,
      'architecture',
    ]);

    expect(scopes).toEqual([
      'devai/project/klyde',
      'persona',
      'architecture',
    ]);
  });
});
