import {
  rememberNote,
  searchWorkspaceMemory,
  readDailyMemory,
} from '../memory/workspaceMemory.js';
import { generateEmbedding } from '../memory/embeddings.js';
import { insertMemory } from '../memory/memoryStore.js';
import { renderMemoryMd } from '../memory/renderMemoryMd.js';

export async function memoryRemember(
  content: string,
  options?: { sessionId?: string; source?: string }
): Promise<{
  saved: true;
  dailyPath: string;
}> {
  const result = await rememberNote(content, {
    sessionId: options?.sessionId,
    source: options?.source || 'tool.memory_remember',
  });

  // Also store in Supabase for structured memory.md rendering
  try {
    const embedding = await generateEmbedding(content);
    await insertMemory({
      content,
      embedding,
      memory_type: 'semantic',
      namespace: 'devai/user',
      priority: 'high',
      source: 'user_stated',
      session_id: options?.sessionId,
    });
    // Re-render memory.md immediately with the new entry
    await renderMemoryMd();
  } catch (err) {
    console.error('[memoryRemember] DB storage failed (workspace file saved):', err);
  }

  return {
    saved: true,
    dailyPath: result.daily.filePath,
  };
}

export async function memorySearch(
  query: string,
  options?: { limit?: number }
): Promise<{
  query: string;
  count: number;
  hits: Array<{ filePath: string; line: number; snippet: string }>;
}> {
  const result = await searchWorkspaceMemory(query, {
    limit: options?.limit,
  });

  return {
    query: result.query,
    count: result.hits.length,
    hits: result.hits,
  };
}

export async function memoryReadToday(): Promise<{
  date: string;
  filePath: string;
  content: string;
}> {
  const result = await readDailyMemory();
  return {
    date: result.date,
    filePath: result.filePath,
    content: result.content,
  };
}
