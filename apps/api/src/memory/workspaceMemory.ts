import { access, appendFile, mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface MemoryAppendResult {
  workspaceRoot: string;
  filePath: string;
  date: string;
  entry: string;
}

export interface MemorySearchHit {
  filePath: string;
  snippet: string;
  line: number;
}

export interface MemorySearchResult {
  workspaceRoot: string;
  query: string;
  hits: MemorySearchHit[];
}

const MAX_MEMORY_ENTRY_CHARS = 4000;

function getRepoRoot(): string {
  // apps/api/src/memory -> repo root
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '../../../..');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeDate(date?: string): string {
  if (!date) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }
  return date;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function buildMemoryEntry(content: string, metadata?: { source?: string; sessionId?: string }): string {
  const timestamp = formatTimestamp();
  const source = (metadata?.source || 'chat').trim();
  const sessionLine = metadata?.sessionId ? `\n- session: ${metadata.sessionId}` : '';
  return [
    `### ${timestamp}`,
    `- note: ${content}`,
    `- source: ${source}${sessionLine}`,
    '',
  ].join('\n');
}

function buildLongTermEntry(content: string): string {
  const timestamp = formatTimestamp();
  return [
    `### ${timestamp}`,
    `- ${content}`,
    '',
  ].join('\n');
}

export async function resolveWorkspaceRoot(override?: string | null): Promise<string> {
  const repoRoot = getRepoRoot();
  const candidates = [
    override ? resolve(override) : null,
    process.env.DEVAI_WORKSPACE_PATH ? resolve(process.env.DEVAI_WORKSPACE_PATH) : null,
    '/opt/Devai/workspace',
    '/opt/Klyde/projects/Devai/workspace',
    join(repoRoot, 'workspace'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }

  return candidates[candidates.length - 1] || join(repoRoot, 'workspace');
}

export async function ensureWorkspaceMemoryStructure(workspaceRoot?: string | null): Promise<string> {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  await mkdir(root, { recursive: true });
  await mkdir(join(root, 'memory'), { recursive: true });
  return root;
}

export async function appendDailyMemoryEntry(
  content: string,
  options: {
    date?: string;
    workspaceRoot?: string | null;
    source?: string;
    sessionId?: string;
  } = {}
): Promise<MemoryAppendResult> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Memory content must not be empty');
  if (trimmed.length > MAX_MEMORY_ENTRY_CHARS) {
    throw new Error(`Memory content too long. Max ${MAX_MEMORY_ENTRY_CHARS} chars`);
  }

  const date = normalizeDate(options.date);
  const root = await ensureWorkspaceMemoryStructure(options.workspaceRoot);
  const filePath = join(root, 'memory', `${date}.md`);
  const entry = buildMemoryEntry(trimmed, { source: options.source, sessionId: options.sessionId });

  await appendFile(filePath, entry, 'utf-8');

  return {
    workspaceRoot: root,
    filePath,
    date,
    entry,
  };
}

export async function appendLongTermMemoryEntry(
  content: string,
  options: { workspaceRoot?: string | null } = {}
): Promise<{ workspaceRoot: string; filePath: string; entry: string }> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Memory content must not be empty');
  if (trimmed.length > MAX_MEMORY_ENTRY_CHARS) {
    throw new Error(`Memory content too long. Max ${MAX_MEMORY_ENTRY_CHARS} chars`);
  }

  const root = await ensureWorkspaceMemoryStructure(options.workspaceRoot);
  const filePath = join(root, 'MEMORY.md');
  const exists = await pathExists(filePath);

  if (!exists) {
    await writeFile(
      filePath,
      '# MEMORY.md - Long-Term Memory\n\nUse this file for durable context.\n\n',
      'utf-8'
    );
  }

  const entry = buildLongTermEntry(trimmed);
  await appendFile(filePath, entry, 'utf-8');
  return { workspaceRoot: root, filePath, entry };
}

export async function rememberNote(
  content: string,
  options: {
    date?: string;
    workspaceRoot?: string | null;
    source?: string;
    sessionId?: string;
    promoteToLongTerm?: boolean;
  } = {}
): Promise<{
  daily: MemoryAppendResult;
  longTerm?: { workspaceRoot: string; filePath: string; entry: string };
}> {
  const daily = await appendDailyMemoryEntry(content, options);
  let longTerm: { workspaceRoot: string; filePath: string; entry: string } | undefined;

  if (options.promoteToLongTerm) {
    longTerm = await appendLongTermMemoryEntry(content, { workspaceRoot: options.workspaceRoot });
  }

  return { daily, longTerm };
}

export async function readDailyMemory(
  date?: string,
  options: { workspaceRoot?: string | null } = {}
): Promise<{ workspaceRoot: string; filePath: string; date: string; content: string }> {
  const normalized = normalizeDate(date);
  const root = await ensureWorkspaceMemoryStructure(options.workspaceRoot);
  const filePath = join(root, 'memory', `${normalized}.md`);
  const exists = await pathExists(filePath);
  if (!exists) {
    return { workspaceRoot: root, filePath, date: normalized, content: '' };
  }
  const content = await readFile(filePath, 'utf-8');
  return { workspaceRoot: root, filePath, date: normalized, content };
}

function lineFromIndex(content: string, index: number): number {
  if (index <= 0) return 1;
  return content.slice(0, index).split('\n').length;
}

function buildSnippet(content: string, index: number, queryLength: number): string {
  const left = Math.max(0, index - 120);
  const right = Math.min(content.length, index + queryLength + 120);
  return content.slice(left, right).replace(/\s+/g, ' ').trim();
}

async function collectMemoryFiles(workspaceRoot: string, includeLongTerm: boolean): Promise<string[]> {
  const memoryDir = join(workspaceRoot, 'memory');
  const files: string[] = [];

  if (await pathExists(memoryDir)) {
    const entries = await readdir(memoryDir, { withFileTypes: true });
    const dailyFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(memoryDir, entry.name))
      .sort((a, b) => b.localeCompare(a));
    files.push(...dailyFiles);
  }

  if (includeLongTerm) {
    const longTerm = join(workspaceRoot, 'MEMORY.md');
    if (await pathExists(longTerm)) files.push(longTerm);
  }

  return files;
}

export async function searchWorkspaceMemory(
  query: string,
  options: {
    workspaceRoot?: string | null;
    limit?: number;
    includeLongTerm?: boolean;
  } = {}
): Promise<MemorySearchResult> {
  const needle = query.trim().toLowerCase();
  if (!needle) throw new Error('Search query must not be empty');

  const root = await ensureWorkspaceMemoryStructure(options.workspaceRoot);
  const limit = Math.max(1, Math.min(50, options.limit || 10));
  const includeLongTerm = options.includeLongTerm !== false;
  const files = await collectMemoryFiles(root, includeLongTerm);
  const hits: MemorySearchHit[] = [];

  for (const filePath of files) {
    if (hits.length >= limit) break;
    const content = await readFile(filePath, 'utf-8');
    const lowered = content.toLowerCase();

    let idx = lowered.indexOf(needle);
    while (idx !== -1 && hits.length < limit) {
      hits.push({
        filePath,
        snippet: buildSnippet(content, idx, needle.length),
        line: lineFromIndex(content, idx),
      });
      idx = lowered.indexOf(needle, idx + needle.length);
    }
  }

  return {
    workspaceRoot: root,
    query,
    hits,
  };
}
