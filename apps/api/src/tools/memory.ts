import {
  rememberNote,
  searchWorkspaceMemory,
  readDailyMemory,
} from '../memory/workspaceMemory.js';

export async function memoryRemember(
  content: string,
  options?: { promoteToLongTerm?: boolean; sessionId?: string; source?: string }
): Promise<{
  saved: true;
  dailyPath: string;
  longTermPath?: string;
}> {
  const result = await rememberNote(content, {
    promoteToLongTerm: options?.promoteToLongTerm,
    sessionId: options?.sessionId,
    source: options?.source || 'tool.memory_remember',
  });

  return {
    saved: true,
    dailyPath: result.daily.filePath,
    longTermPath: result.longTerm?.filePath,
  };
}

export async function memorySearch(
  query: string,
  options?: { limit?: number; includeLongTerm?: boolean }
): Promise<{
  query: string;
  count: number;
  hits: Array<{ filePath: string; line: number; snippet: string }>;
}> {
  const result = await searchWorkspaceMemory(query, {
    limit: options?.limit,
    includeLongTerm: options?.includeLongTerm,
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
