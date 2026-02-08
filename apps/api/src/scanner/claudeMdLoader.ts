import { readFile, access } from 'fs/promises';
import { resolve, dirname, join } from 'path';

export interface ClaudeMdFile {
  path: string;
  content: string;
}

export interface ClaudeMdContext {
  files: ClaudeMdFile[];
  combined: string;
}

const CLAUDE_MD_NAMES = ['CLAUDE.md', 'claude.md', '.claude.md'];
const MAX_PARENT_LEVELS = 5;
const MAX_CONTENT_SIZE = 32000; // ~8k tokens

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findClaudeMd(dir: string): Promise<string | null> {
  for (const name of CLAUDE_MD_NAMES) {
    const path = join(dir, name);
    if (await fileExists(path)) {
      return path;
    }
  }
  // Also check .claude subdirectory
  const claudeDir = join(dir, '.claude');
  if (await fileExists(claudeDir)) {
    for (const name of CLAUDE_MD_NAMES) {
      const path = join(claudeDir, name);
      if (await fileExists(path)) {
        return path;
      }
    }
  }
  return null;
}

/**
 * Load CLAUDE.md files from project root and parent directories.
 * Files are combined with parent files first, so project-specific
 * instructions can override or add to parent instructions.
 */
export async function loadClaudeMdContext(projectRoot: string): Promise<ClaudeMdContext> {
  const files: ClaudeMdFile[] = [];
  let currentDir = resolve(projectRoot);
  let level = 0;

  // Walk up directory tree
  while (level < MAX_PARENT_LEVELS) {
    const claudeMdPath = await findClaudeMd(currentDir);

    if (claudeMdPath) {
      try {
        const content = await readFile(claudeMdPath, 'utf-8');
        // Parent files first (unshift), so project file is last
        files.unshift({ path: claudeMdPath, content });
      } catch (err) {
        // Skip unreadable files
        console.warn(`[claudeMdLoader] Could not read ${claudeMdPath}:`, err);
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break; // Reached filesystem root
    }

    currentDir = parentDir;
    level++;
  }

  // Combine with size limit
  let combined = '';
  let totalSize = 0;

  for (const file of files) {
    const header = `\n\n<!-- From: ${file.path} -->\n\n`;
    const addition = header + file.content;

    if (totalSize + addition.length > MAX_CONTENT_SIZE) {
      combined += `\n\n[Truncated: Additional CLAUDE.md files exceeded ${MAX_CONTENT_SIZE} character limit]`;
      break;
    }

    combined += addition;
    totalSize += addition.length;
  }

  return { files, combined: combined.trim() };
}

/**
 * Format CLAUDE.md content as a system prompt block.
 */
export function formatClaudeMdBlock(context: ClaudeMdContext): string {
  if (!context.combined) {
    return '';
  }
  return `\n\n## Project Instructions (from CLAUDE.md)\n\n${context.combined}`;
}
