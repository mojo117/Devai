import { searchMemories, reinforceMemory } from './memoryStore.js';
import { runExtractionPipeline } from './extraction.js';
import type { StoredMemory } from './types.js';
import type { LLMProvider } from '../llm/types.js';

// ---------------------------------------------------------------------------
// Budget constants — keep injected memory context within token limits
// ---------------------------------------------------------------------------

const MEMORY_TOKEN_BUDGET = 2000;
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
}

export async function retrieveRelevantMemories(
  query: string,
  projectName?: string,
): Promise<RetrievalResult> {
  try {
    // Build namespace scopes — always include global and user; add project if given
    const namespaces = ['devai/global/', 'devai/user/'];
    if (projectName) {
      namespaces.push(`devai/project/${projectName}/`);
    }

    const memories = await searchMemories(query, namespaces);

    if (memories.length === 0) {
      return { block: '', memoryIds: [] };
    }

    const { block, included } = formatMemoriesBlock(memories);
    const memoryIds = memories.slice(0, included).map((m) => m.id);

    // Fire-and-forget: reinforce each accessed memory so recency stays fresh
    for (const id of memoryIds) {
      reinforceMemory(id).catch((err) =>
        console.error(`[memoryService] reinforceMemory fire-and-forget failed for ${id}:`, err),
      );
    }

    return { block, memoryIds };
  } catch (err) {
    console.error('[memoryService] retrieveRelevantMemories failed:', err);
    return { block: '', memoryIds: [] };
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
