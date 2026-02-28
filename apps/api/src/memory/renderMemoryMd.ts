import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getSupabase } from '../db/index.js';
import { resolveWorkspaceRoot } from './workspaceMemory.js';
import { normalizeNamespacePrefix } from './namespace.js';
import type { MemoryType, MemoryPriority } from './types.js';

// ---------------------------------------------------------------------------
// Category types and ordering
// ---------------------------------------------------------------------------

export type MemoryCategory = 'User' | 'Projekte' | 'Workflows' | 'Termine & Events' | 'Erkenntnisse';

export const CATEGORY_ORDER: readonly MemoryCategory[] = [
  'User',
  'Projekte',
  'Workflows',
  'Termine & Events',
  'Erkenntnisse',
] as const;

// ---------------------------------------------------------------------------
// Budget constants
// ---------------------------------------------------------------------------

export const MAX_ENTRY_CHARS = 200;
export const MAX_TOTAL_CHARS = 12_000;

// ---------------------------------------------------------------------------
// DB row shape (only the columns we SELECT)
// ---------------------------------------------------------------------------

interface MemoryRow {
  id: string;
  content: string;
  memory_type: MemoryType;
  namespace: string;
  strength: number;
  priority: MemoryPriority;
  is_valid: boolean;
}

// ---------------------------------------------------------------------------
// Namespace → Category mapping
// ---------------------------------------------------------------------------

/**
 * Maps a memory's namespace (and optionally its type) to a render category.
 * Returns `null` for memories that should not appear in memory.md (e.g. persona).
 */
export function mapNamespaceToCategory(
  namespace: string,
  memoryType: MemoryType,
): MemoryCategory | null {
  const ns = normalizeNamespacePrefix(namespace);

  // Procedural memories always map to Workflows, regardless of namespace
  if (memoryType === 'procedural') {
    return 'Workflows';
  }

  // persona/* → null (identity lives in SOUL.md)
  if (ns === 'persona' || ns.startsWith('persona/')) {
    return null;
  }

  // devai/user, personal → User
  if (ns === 'devai/user' || ns === 'personal') {
    return 'User';
  }

  // devai/project/*, devai/global, architecture → Projekte
  if (
    ns === 'devai/global' ||
    ns === 'architecture' ||
    ns.startsWith('devai/project/')
  ) {
    return 'Projekte';
  }

  // devai/episodic/* with episodic type → Termine & Events
  if (
    (ns === 'devai/episodic' || ns.startsWith('devai/episodic/')) &&
    memoryType === 'episodic'
  ) {
    return 'Termine & Events';
  }

  // Everything else → Erkenntnisse
  return 'Erkenntnisse';
}

// ---------------------------------------------------------------------------
// Text overlap deduplication
// ---------------------------------------------------------------------------

function normalizeForOverlap(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns a simple overlap ratio (0..1) between two strings based on
 * the length of the shorter string that appears verbatim in the longer.
 * For efficiency this uses a directional bigram containment ratio
 * (fraction of shorter's bigrams found in longer's bigram set).
 */
export function textOverlap(a: string, b: string): number {
  const na = normalizeForOverlap(a);
  const nb = normalizeForOverlap(b);

  if (na.length === 0 && nb.length === 0) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length < nb.length ? na : nb;

  // Simple ratio: how much of the shorter string overlaps character-by-character
  // with the longer. We count matching characters at each position of the shorter
  // string as it slides across the longer. But for performance and simplicity we
  // use the ratio of matching bigrams.
  const bigramsA = new Set<string>();
  for (let i = 0; i < longer.length - 1; i++) {
    bigramsA.add(longer.slice(i, i + 2));
  }

  let matches = 0;
  let total = 0;
  for (let i = 0; i < shorter.length - 1; i++) {
    total++;
    if (bigramsA.has(shorter.slice(i, i + 2))) {
      matches++;
    }
  }

  if (total === 0) return longer.includes(shorter) ? 1 : 0;
  return matches / total;
}

// ---------------------------------------------------------------------------
// Truncation helper
// ---------------------------------------------------------------------------

function truncateEntry(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_ENTRY_CHARS) return trimmed;
  return trimmed.slice(0, MAX_ENTRY_CHARS - 1) + '\u2026';
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Queries valid memories from Supabase, categorizes them, deduplicates,
 * truncates, and writes `workspace/memory.md`.
 *
 * @param workspaceRoot Optional override for workspace root path.
 * @returns Absolute file path of the written memory.md.
 */
export async function renderMemoryMd(workspaceRoot?: string): Promise<string> {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  const filePath = join(root, 'memory.md');

  // 1. Fetch valid memories ordered by strength DESC
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('devai_memories')
    .select('id, content, memory_type, namespace, strength, priority, is_valid')
    .eq('is_valid', true)
    .order('strength', { ascending: false });

  if (error) {
    console.error('[renderMemoryMd] query failed:', error);
    // Write an empty memory file so downstream consumers still have a file
    await mkdir(root, { recursive: true });
    await writeFile(filePath, '# Memory\n', 'utf-8');
    return filePath;
  }

  const rows = (data ?? []) as MemoryRow[];

  // 2. Categorize and filter
  interface CategorizedEntry {
    category: MemoryCategory;
    content: string;
    strength: number;
  }

  const entries: CategorizedEntry[] = [];

  for (const row of rows) {
    const category = mapNamespaceToCategory(row.namespace, row.memory_type);
    if (category === null) continue;

    entries.push({
      category,
      content: row.content,
      strength: row.strength,
    });
  }

  // 3. Deduplicate within each category (>90% text overlap → keep higher strength)
  const deduplicated: CategorizedEntry[] = [];

  for (const entry of entries) {
    const isDuplicate = deduplicated.some(
      (existing) =>
        existing.category === entry.category &&
        textOverlap(existing.content, entry.content) > 0.9,
    );
    if (!isDuplicate) {
      deduplicated.push(entry);
    }
  }

  // 4. Group by category in CATEGORY_ORDER
  const grouped = new Map<MemoryCategory, string[]>();
  for (const cat of CATEGORY_ORDER) {
    grouped.set(cat, []);
  }

  for (const entry of deduplicated) {
    const bucket = grouped.get(entry.category);
    if (bucket) {
      bucket.push(truncateEntry(entry.content));
    }
  }

  // 5. Render markdown with budget
  const lines: string[] = ['# Memory'];
  let totalChars = lines[0].length;

  for (const category of CATEGORY_ORDER) {
    const items = grouped.get(category);
    if (!items || items.length === 0) continue;

    const headerLine = `\n## ${category}`;
    const headerCost = headerLine.length;

    // Check if we can fit at least the header and one item
    if (totalChars + headerCost >= MAX_TOTAL_CHARS) break;

    lines.push(headerLine);
    totalChars += headerCost;

    for (const item of items) {
      const bulletLine = `\n- ${item}`;
      const lineCost = bulletLine.length;

      if (totalChars + lineCost > MAX_TOTAL_CHARS) break;

      lines.push(bulletLine);
      totalChars += lineCost;
    }
  }

  const markdown = lines.join('') + '\n';

  // 6. Write file
  await mkdir(root, { recursive: true });
  await writeFile(filePath, markdown, 'utf-8');

  return filePath;
}
