import { searchMemories, reinforceMemory } from './memoryStore.js';
import { runExtractionPipeline } from './extraction.js';
import { getActiveTopics } from './recentFocus.js';
import type { StoredMemory } from './types.js';
import type { LLMProvider } from '../llm/types.js';
import { config } from '../config.js';
import { normalizeNamespacePrefix, uniqueNormalizedNamespaces } from './namespace.js';

// ---------------------------------------------------------------------------
// Budget constants — keep injected memory context within token limits
// ---------------------------------------------------------------------------

const MEMORY_TOKEN_BUDGET = 3000;
const CHARS_PER_TOKEN = 4;
const MAX_MEMORY_CHARS = MEMORY_TOKEN_BUDGET * CHARS_PER_TOKEN;

// ---------------------------------------------------------------------------
// Type-to-header mapping for formatted output
// ---------------------------------------------------------------------------

const SECTION_HEADERS: Record<StoredMemory['memory_type'], string> = {
  semantic: '### Project Knowledge',
  episodic: '### Past Experiences',
  procedural: '### Patterns & Workflows',
};

// ---------------------------------------------------------------------------
// 1. retrieveRelevantMemories
// ---------------------------------------------------------------------------

interface RetrievalResult {
  block: string;
  memoryIds: string[];
  quality: MemoryQualitySignals;
}

export interface MemoryQualitySignals {
  namespaces: string[];
  totalHits: number;
  duplicateContentHits: number;
  weakStrengthHits: number;
  lowSimilarityHits: number;
}

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

function buildMemoryQualitySignals(
  memories: StoredMemory[],
  namespaces: string[],
): MemoryQualitySignals {
  const normalizedContent = memories.map((memory) => memory.content.trim().toLowerCase());
  const uniqueContent = new Set(normalizedContent);

  return {
    namespaces,
    totalHits: memories.length,
    duplicateContentHits: Math.max(0, memories.length - uniqueContent.size),
    weakStrengthHits: memories.filter((memory) => memory.strength < 0.2).length,
    lowSimilarityHits: memories.filter((memory) => memory.similarity < 0.35).length,
  };
}

function toPercent(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export function formatMemoryQualityBlock(quality: MemoryQualitySignals): string {
  const namespacePreview = quality.namespaces.slice(0, 4).join(', ');
  const namespaceLine = quality.namespaces.length > 4
    ? `${namespacePreview}, ...`
    : namespacePreview;

  if (quality.totalHits === 0) {
    return [
      '## Memory Quality Signals',
      '- Retrieved hits: 0',
      `- Namespace scope: ${namespaceLine || 'n/a'}`,
      '- Action hint: Keine Treffer. Nutze bei Unsicherheit lieber frische Tools als alte Memory-Annahmen.',
    ].join('\n');
  }

  return [
    '## Memory Quality Signals',
    `- Retrieved hits: ${quality.totalHits}`,
    `- Duplicate content hits: ${quality.duplicateContentHits} (${toPercent(quality.duplicateContentHits, quality.totalHits)})`,
    `- Weak-strength hits (<0.2): ${quality.weakStrengthHits} (${toPercent(quality.weakStrengthHits, quality.totalHits)})`,
    `- Low-similarity hits (<0.35): ${quality.lowSimilarityHits} (${toPercent(quality.lowSimilarityHits, quality.totalHits)})`,
    `- Namespace scope: ${namespaceLine || 'n/a'}`,
    '- Action hint: Bei hohen Weak-/Low-Similarity-Werten Fakten per Tool verifizieren.',
  ].join('\n');
}

async function augmentQueryWithRecentTopics(query: string): Promise<string> {
  try {
    const topics = await getActiveTopics(3);
    if (topics.length === 0) return query;
    const topicNames = topics.map((t) => t.topic).join(', ');
    return `${query} [recent focus: ${topicNames}]`;
  } catch {
    return query;
  }
}

export async function retrieveRelevantMemories(
  query: string,
  projectName?: string,
): Promise<RetrievalResult> {
  try {
    const namespaces = buildMemorySearchNamespaces(projectName);
    const thresholds = buildRetrievalThresholds();
    const limit = 10;
    const minimumHitsBeforeStop = Math.min(limit, Math.max(1, config.memoryMinHitsBeforeStop));
    const mergedById = new Map<string, StoredMemory>();
    const augmentedQuery = await augmentQueryWithRecentTopics(query);

    for (const threshold of thresholds) {
      const retrieved = await searchMemories(augmentedQuery, namespaces, limit, threshold);
      for (const memory of retrieved) {
        mergedById.set(memory.id, memory);
      }

      const mergedRanked = rankMemories(Array.from(mergedById.values())).slice(0, limit);
      if (mergedRanked.length >= minimumHitsBeforeStop) break;
    }

    const memories = rankMemories(Array.from(mergedById.values())).slice(0, limit);
    const quality = buildMemoryQualitySignals(memories, namespaces);
    if (memories.length === 0) {
      return { block: '', memoryIds: [], quality };
    }

    const { block, included } = formatMemoriesBlock(memories);
    const memoryIds = memories.slice(0, included).map((m) => m.id);

    // Fire-and-forget: reinforce each accessed memory so recency stays fresh
    for (const id of memoryIds) {
      reinforceMemory(id).catch((err) =>
        console.error(`[memoryService] reinforceMemory fire-and-forget failed for ${id}:`, err),
      );
    }

    return { block, memoryIds, quality };
  } catch (err) {
    console.error('[memoryService] retrieveRelevantMemories failed:', err);
    return {
      block: '',
      memoryIds: [],
      quality: {
        namespaces: buildMemorySearchNamespaces(projectName),
        totalHits: 0,
        duplicateContentHits: 0,
        weakStrengthHits: 0,
        lowSimilarityHits: 0,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// 2. formatMemoriesBlock
// ---------------------------------------------------------------------------

interface FormatResult {
  block: string;
  included: number;
  dropped: number;
}

export function formatMemoriesBlock(memories: StoredMemory[]): FormatResult {
  if (memories.length === 0) {
    return { block: '', included: 0, dropped: 0 };
  }

  // Group memories by type
  const groups: Record<StoredMemory['memory_type'], StoredMemory[]> = {
    semantic: [],
    episodic: [],
    procedural: [],
  };

  for (const mem of memories) {
    const bucket = groups[mem.memory_type];
    if (bucket) {
      bucket.push(mem);
    }
  }

  let totalChars = 0;
  let included = 0;
  let dropped = 0;
  const sections: string[] = [];

  // Iterate in a stable order: semantic -> episodic -> procedural
  const typeOrder: StoredMemory['memory_type'][] = ['semantic', 'episodic', 'procedural'];

  for (const type of typeOrder) {
    const items = groups[type];
    if (items.length === 0) continue;

    const header = SECTION_HEADERS[type];
    const lines: string[] = [];

    for (const mem of items) {
      const line = `- ${mem.content}`;
      const lineLen = line.length + 1; // +1 for newline

      if (totalChars + lineLen > MAX_MEMORY_CHARS) {
        dropped++;
        continue;
      }

      lines.push(line);
      totalChars += lineLen;
      included++;
    }

    if (lines.length > 0) {
      // Account for the header itself in the budget
      const headerLine = `${header}\n`;
      totalChars += headerLine.length;
      sections.push(`${header}\n${lines.join('\n')}`);
    }
  }

  if (sections.length === 0) {
    return { block: '', included: 0, dropped: memories.length };
  }

  const block = sections.join('\n\n');
  return { block, included, dropped };
}

// ---------------------------------------------------------------------------
// 3. triggerSessionEndExtraction
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
