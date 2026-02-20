import { getSupabase } from '../db/index.js';
import { generateEmbedding } from './embeddings.js';
import type { StoredMemory, MemoryInsert } from './types.js';

// ---------------------------------------------------------------------------
// 1. searchMemories — vector search across one or more namespaces
// ---------------------------------------------------------------------------

export async function searchMemories(
  query: string,
  namespaces: string[],
  limit: number = 10,
  threshold: number = 0.5,
): Promise<StoredMemory[]> {
  try {
    const embedding = await generateEmbedding(query);
    const embeddingJson = JSON.stringify(embedding);
    const supabase = getSupabase();

    const allResults: StoredMemory[] = [];

    for (const ns of namespaces) {
      const { data, error } = await supabase.rpc('match_memories', {
        query_embedding: embeddingJson,
        match_namespace: ns,
        match_count: limit,
        similarity_threshold: threshold,
      });

      if (error) {
        console.error(`[memoryStore] searchMemories RPC failed for namespace "${ns}":`, error);
        continue;
      }

      if (data) {
        for (const row of data as StoredMemory[]) {
          allResults.push(row);
        }
      }
    }

    // Deduplicate by id (same memory could theoretically appear across calls)
    const seen = new Set<string>();
    const unique: StoredMemory[] = [];
    for (const mem of allResults) {
      if (!seen.has(mem.id)) {
        seen.add(mem.id);
        unique.push(mem);
      }
    }

    // Sort by similarity * strength descending
    unique.sort((a, b) => b.similarity * b.strength - a.similarity * a.strength);

    return unique.slice(0, limit);
  } catch (err) {
    console.error('[memoryStore] searchMemories failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. reinforceMemory — bump access_count and last_accessed_at
// ---------------------------------------------------------------------------

export async function reinforceMemory(id: string): Promise<void> {
  try {
    const supabase = getSupabase();

    const { data, error: readError } = await supabase
      .from('devai_memories')
      .select('access_count')
      .eq('id', id)
      .single();

    if (readError || !data) {
      console.error('[memoryStore] reinforceMemory read failed:', readError);
      return;
    }

    const currentCount = (data as { access_count: number }).access_count;

    const { error: updateError } = await supabase
      .from('devai_memories')
      .update({
        access_count: currentCount + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('[memoryStore] reinforceMemory update failed:', updateError);
    }
  } catch (err) {
    console.error('[memoryStore] reinforceMemory failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 3. insertMemory — insert a new row into devai_memories
// ---------------------------------------------------------------------------

export async function insertMemory(memory: MemoryInsert): Promise<string | null> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('devai_memories')
      .insert({
        content: memory.content,
        embedding: JSON.stringify(memory.embedding),
        memory_type: memory.memory_type,
        namespace: memory.namespace,
        priority: memory.priority,
        source: memory.source,
        session_id: memory.session_id ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[memoryStore] insertMemory failed:', error);
      return null;
    }

    return (data as { id: string }).id;
  } catch (err) {
    console.error('[memoryStore] insertMemory failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4. findSimilarMemories — high-threshold search for deduplication
// ---------------------------------------------------------------------------

export async function findSimilarMemories(
  content: string,
  namespace: string,
): Promise<StoredMemory[]> {
  try {
    const embedding = await generateEmbedding(content);
    const embeddingJson = JSON.stringify(embedding);
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: embeddingJson,
      match_namespace: namespace,
      match_count: 5,
      similarity_threshold: 0.8,
    });

    if (error) {
      console.error('[memoryStore] findSimilarMemories RPC failed:', error);
      return [];
    }

    return (data as StoredMemory[]) ?? [];
  } catch (err) {
    console.error('[memoryStore] findSimilarMemories failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 5. supersedeMemory — mark old memory as superseded by a new one
// ---------------------------------------------------------------------------

export async function supersedeMemory(oldId: string, newId: string): Promise<void> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('devai_memories')
      .update({
        is_valid: false,
        superseded_by: newId,
      })
      .eq('id', oldId);

    if (error) {
      console.error('[memoryStore] supersedeMemory failed:', error);
    }
  } catch (err) {
    console.error('[memoryStore] supersedeMemory failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 6. invalidateMemory — soft-delete by setting is_valid = false
// ---------------------------------------------------------------------------

export async function invalidateMemory(id: string): Promise<void> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('devai_memories')
      .update({ is_valid: false })
      .eq('id', id);

    if (error) {
      console.error('[memoryStore] invalidateMemory failed:', error);
    }
  } catch (err) {
    console.error('[memoryStore] invalidateMemory failed:', err);
  }
}

// ---------------------------------------------------------------------------
// 7. runDecay — time-based strength decay with pruning
// ---------------------------------------------------------------------------

interface DecayResult {
  decayed: number;
  pruned: number;
}

export async function runDecay(): Promise<DecayResult> {
  const result: DecayResult = { decayed: 0, pruned: 0 };

  try {
    const supabase = getSupabase();

    const { data: memories, error } = await supabase
      .from('devai_memories')
      .select('id, strength, last_accessed_at, priority')
      .eq('is_valid', true);

    if (error) {
      console.error('[memoryStore] runDecay query failed:', error);
      return result;
    }

    if (!memories || memories.length === 0) {
      return result;
    }

    const now = Date.now();

    for (const mem of memories as Array<{
      id: string;
      strength: number;
      last_accessed_at: string;
      priority: string;
    }>) {
      const lastAccessed = new Date(mem.last_accessed_at).getTime();
      const daysSince = (now - lastAccessed) / (1000 * 60 * 60 * 24);

      if (daysSince <= 0) continue;

      const newStrength = mem.strength * Math.pow(0.95, daysSince);

      // Prune weak memories (but never prune highest priority)
      if (newStrength < 0.05 && mem.priority !== 'highest') {
        const { error: delError } = await supabase
          .from('devai_memories')
          .update({ is_valid: false })
          .eq('id', mem.id);

        if (delError) {
          console.error(`[memoryStore] runDecay prune failed for ${mem.id}:`, delError);
        } else {
          result.pruned++;
        }
        continue;
      }

      // Apply decay
      if (Math.abs(newStrength - mem.strength) > 0.001) {
        const { error: updateError } = await supabase
          .from('devai_memories')
          .update({ strength: newStrength })
          .eq('id', mem.id);

        if (updateError) {
          console.error(`[memoryStore] runDecay update failed for ${mem.id}:`, updateError);
        } else {
          result.decayed++;
        }
      }
    }

    return result;
  } catch (err) {
    console.error('[memoryStore] runDecay failed:', err);
    return result;
  }
}
