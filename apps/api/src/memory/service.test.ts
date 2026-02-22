import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredMemory } from './types.js';

const mocks = vi.hoisted(() => ({
  searchMemories: vi.fn(),
  reinforceMemory: vi.fn(),
}));

const memoryConfig = vi.hoisted(() => ({
  memoryRetrievalThresholds: [0.5, 0.35, 0.2],
  memoryMinHitsBeforeStop: 3,
  memoryIncludePersonalScope: true,
}));

vi.mock('./memoryStore.js', () => ({
  searchMemories: mocks.searchMemories,
  reinforceMemory: mocks.reinforceMemory,
}));

vi.mock('../config.js', () => ({
  config: memoryConfig,
}));

import {
  buildMemorySearchNamespaces,
  buildRetrievalThresholds,
  retrieveRelevantMemories,
} from './service.js';

function makeMemory(id: string, score: number): StoredMemory {
  return {
    id,
    content: `memory-${id}`,
    similarity: score,
    memory_type: 'semantic',
    namespace: 'devai/project/klyde',
    strength: 1,
    priority: 'high',
  };
}

describe('memory service retrieval strategy', () => {
  beforeEach(() => {
    mocks.searchMemories.mockReset();
    mocks.reinforceMemory.mockReset();
    mocks.reinforceMemory.mockResolvedValue(undefined);
  });

  it('builds expanded and normalized memory scopes', () => {
    const scopes = buildMemorySearchNamespaces(' /KLYDE/ ');

    expect(scopes).toContain('devai/project/klyde');
    expect(scopes).toContain('devai/global');
    expect(scopes).toContain('devai/user');
    expect(scopes).toContain('devai');
    expect(scopes).toContain('persona');
    expect(scopes).toContain('architecture');
    if (memoryConfig.memoryIncludePersonalScope) {
      expect(scopes).toContain('personal');
    }
    expect(scopes.every((scope) => !scope.endsWith('/'))).toBe(true);
  });

  it('falls back to lower thresholds when first retrieval has no hits', async () => {
    const thresholds = buildRetrievalThresholds();
    const enoughHits = Math.min(10, Math.max(1, memoryConfig.memoryMinHitsBeforeStop));
    const retrieved = Array.from({ length: enoughHits }, (_, index) =>
      makeMemory(`m-${index}`, 0.9 - index * 0.01),
    );

    mocks.searchMemories
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(retrieved);

    const result = await retrieveRelevantMemories('klyde package manager', 'klyde');

    expect(mocks.searchMemories).toHaveBeenCalledTimes(2);
    expect(mocks.searchMemories.mock.calls[0]?.[3]).toBe(thresholds[0]);
    expect(mocks.searchMemories.mock.calls[1]?.[3]).toBe(thresholds[1]);
    expect(result.memoryIds.length).toBe(enoughHits);
    expect(mocks.reinforceMemory).toHaveBeenCalledTimes(enoughHits);
  });

  it('stops early when the highest threshold already returns enough hits', async () => {
    const enoughHits = Math.min(10, Math.max(1, memoryConfig.memoryMinHitsBeforeStop));
    const retrieved = Array.from({ length: enoughHits }, (_, index) =>
      makeMemory(`top-${index}`, 0.95 - index * 0.01),
    );

    mocks.searchMemories.mockResolvedValueOnce(retrieved);

    await retrieveRelevantMemories('deploy on klyde', 'klyde');

    expect(mocks.searchMemories).toHaveBeenCalledTimes(1);
  });
});
