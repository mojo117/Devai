import { searchMemories, reinforceMemory } from './memoryStore.js';
import { runExtractionPipeline } from './extraction.js';
import type { StoredMemory, MemorySource } from './types.js';
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

// ---------------------------------------------------------------------------
// Scoring: sourceWeight × agePenalty
// ---------------------------------------------------------------------------

const SOURCE_WEIGHTS: Partial<Record<MemorySource, number>> = {
  user_stated: 1.3,
  error_resolution: 1.1,
  pattern: 1.1,
  episodic_turn: 0.6,
  episodic_tool: 0.6,
};

function getSourceWeight(source?: MemorySource): number {
  if (!source) return 1.0;
  return SOURCE_WEIGHTS[source] ?? 1.0;
}

function getAgePenalty(mem: StoredMemory): number {
  if (!mem.created_at) return 1.0;
  // Only apply age penalty to episodic memories
  if (mem.source !== 'episodic_turn' && mem.source !== 'episodic_tool') return 1.0;
  const daysSince = (Date.now() - new Date(mem.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 1) return 1.0;
  return Math.max(0.3, 1.0 - 0.05 * daysSince);
}

function scoreMemory(mem: StoredMemory): number {
  return mem.similarity * mem.strength * getSourceWeight(mem.source) * getAgePenalty(mem);
}

// ---------------------------------------------------------------------------
// Token-overlap deduplication
// ---------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / Math.min(a.size, b.size);
}

function deduplicateByContent(memories: StoredMemory[], overlapThreshold = 0.75): StoredMemory[] {
  const accepted: StoredMemory[] = [];
  const acceptedTokens: Set<string>[] = [];

  for (const mem of memories) {
    const tokens = tokenize(mem.content);
    const isDuplicate = acceptedTokens.some(
      (existing) => tokenOverlap(tokens, existing) > overlapThreshold,
    );
    if (!isDuplicate) {
      accepted.push(mem);
      acceptedTokens.push(tokens);
    }
  }
  return accepted;
}

// ---------------------------------------------------------------------------
// Rank with scoring + dedup
// ---------------------------------------------------------------------------

function rankMemories(memories: StoredMemory[]): StoredMemory[] {
  const scored = [...memories].sort((a, b) => scoreMemory(b) - scoreMemory(a));
  return deduplicateByContent(scored);
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
