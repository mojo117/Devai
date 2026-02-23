import { searchMemories, reinforceMemory } from './memoryStore.js';
import { runExtractionPipeline } from './extraction.js';
import type { StoredMemory } from './types.js';
import type { LLMProvider } from '../llm/types.js';
import { config } from '../config.js';
import { normalizeNamespacePrefix, uniqueNormalizedNamespaces } from './namespace.js';

// ---------------------------------------------------------------------------
// 1. retrieveRelevantMemories
// ---------------------------------------------------------------------------

export function buildMemorySearchNamespaces(projectName?: string): string[] {
  const project = normalizeNamespacePrefix(projectName);

  return uniqueNormalizedNamespaces([
    project ? `devai/project/${project}` : null,
    'devai/global',
    'devai/user',
    'devai',
    'persona',
    'architecture',
    config.memoryIncludePersonalScope ? 'personal' : null,
  ]);
}

export function buildRetrievalThresholds(): number[] {
  if (Array.isArray(config.memoryRetrievalThresholds) && config.memoryRetrievalThresholds.length > 0) {
    return [...config.memoryRetrievalThresholds];
  }
  return [0.5, 0.35, 0.2];
}

function rankMemories(memories: StoredMemory[]): StoredMemory[] {
  return [...memories].sort((a, b) => b.similarity * b.strength - a.similarity * a.strength);
}

export async function retrieveRelevantMemories(
  query: string,
  projectName?: string,
): Promise<StoredMemory[]> {
  try {
    const namespaces = buildMemorySearchNamespaces(projectName);
    const thresholds = buildRetrievalThresholds();
    const limit = 10;
    const minimumHitsBeforeStop = Math.min(limit, Math.max(1, config.memoryMinHitsBeforeStop));
    const mergedById = new Map<string, StoredMemory>();

    for (const threshold of thresholds) {
      const retrieved = await searchMemories(query, namespaces, limit, threshold);
      for (const memory of retrieved) {
        mergedById.set(memory.id, memory);
      }

      const mergedRanked = rankMemories(Array.from(mergedById.values())).slice(0, limit);
      if (mergedRanked.length >= minimumHitsBeforeStop) break;
    }

    const memories = rankMemories(Array.from(mergedById.values())).slice(0, limit);

    // Fire-and-forget: reinforce each accessed memory
    for (const mem of memories) {
      reinforceMemory(mem.id).catch((err) =>
        console.error(`[memoryService] reinforceMemory fire-and-forget failed for ${mem.id}:`, err),
      );
    }

    return memories;
  } catch (err) {
    console.error('[memoryService] retrieveRelevantMemories failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. triggerSessionEndExtraction
// ---------------------------------------------------------------------------

export function triggerSessionEndExtraction(
  conversationText: string,
  sessionId: string,
  provider?: LLMProvider,
): void {
  // Fire-and-forget — run the extraction pipeline asynchronously
  runExtractionPipeline(conversationText, sessionId, provider).catch((err) =>
    console.error('[memoryService] triggerSessionEndExtraction failed:', err),
  );
}
