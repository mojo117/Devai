import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, stat, mkdir as fsMkdir, rename, unlink, rmdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import fg from 'fast-glob';
import {
  translatePath,
  untranslatePath,
  pathExists,
  validatePath,
  validateTargetPath,
  isAllowedExtension,
  type FsOptions,
} from './fsPathValidation.js';

export type { FsOptions } from './fsPathValidation.js';

export interface ListFilesResult {
  path: string;
  files: Array<{
    name: string;
    type: 'file' | 'directory';
    size?: number;
  }>;
  truncated?: boolean;
}

export async function listFiles(path: string, options?: FsOptions): Promise<ListFilesResult> {
  const absolutePath = await validatePath(path, options);

  const entries = await readdir(absolutePath, { withFileTypes: true });

  const entriesLimited = entries.slice(0, 100);
  const files = await Promise.all(
    entriesLimited.map(async (entry) => {
      const entryPath = join(absolutePath, entry.name);
      let size: number | undefined;

      if (entry.isFile()) {
        try {
          const stats = await stat(entryPath);
          size = stats.size;
        } catch (err) {
          console.warn('[fs] stat failed for entry:', err instanceof Error ? err.message : err);
        }
      }

      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' as const : 'file' as const,
        size,
      };
    })
  );

  return {
    path: untranslatePath(absolutePath),
    files: files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    }),
    truncated: entries.length > entriesLimited.length,
  };
}

export interface ReadFileResult {
  path: string;
  content: string;
  size: number;
}

export async function readFile(path: string, options?: FsOptions): Promise<ReadFileResult> {
  const absolutePath = await validatePath(path, options);
  if (!isAllowedExtension(path)) {
    throw new Error('Read denied: file extension is not allowed');
  }

  const stats = await stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${path}`);
  }

  if (stats.size > 2 * 1024 * 1024) {
    throw new Error(`File too large: ${stats.size} bytes (max: 2MB)`);
  }

  const content = await fsReadFile(absolutePath, 'utf-8');

  return {
    path,
    content,
    size: stats.size,
  };
}

export interface WriteFileResult {
  path: string;
  bytesWritten: number;
}

export async function writeFile(path: string, content: string): Promise<WriteFileResult> {
  const absolutePath = await validatePath(path);
  if (!isAllowedExtension(path)) {
    throw new Error('Write denied: file extension is not allowed');
  }
  const bytes = Buffer.byteLength(content, 'utf-8');
  if (bytes > 100 * 1024) {
    throw new Error(`Write too large: ${bytes} bytes (max: 100KB)`);
  }
  if (content.includes('\u0000')) {
    throw new Error('Write denied: content appears to be binary');
  }

  await fsWriteFile(absolutePath, content, 'utf-8');

  return {
    path,
    bytesWritten: bytes,
  };
}

export interface GlobResult {
  pattern: string;
  basePath: string;
  files: string[];
  count: number;
  truncated: boolean;
}

export async function globFiles(
  pattern: string,
  basePath?: string,
  ignore?: string[],
  options?: FsOptions
): Promise<GlobResult> {
  let searchPath: string;
  if (basePath) {
    searchPath = await validatePath(basePath, options);
  } else {
    const defaultRoot = '/opt/Klyde/projects';
    searchPath = await pathExists(defaultRoot) ? defaultRoot : '/opt/Klyde/projects';
  }

  const files = await fg(pattern, {
    cwd: searchPath,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/.git/**', ...(ignore || [])],
    absolute: false,
  });

  const truncated = files.length > 100;

  return {
    pattern,
    basePath: untranslatePath(searchPath),
    files: files.slice(0, 100),
    count: files.length,
    truncated,
  };
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export interface GrepResult {
  pattern: string;
  basePath: string;
  matches: GrepMatch[];
  filesSearched: number;
  truncated: boolean;
}

export async function grepFiles(
  pattern: string,
  searchPath: string,
  fileGlob?: string,
  ignore?: string[],
  options?: FsOptions
): Promise<GrepResult> {
  const validatedPath = await validatePath(searchPath, options);
  const regex = new RegExp(pattern, 'gi');

  const globPattern = fileGlob || '**/*';
  const files = await fg(globPattern, {
    cwd: validatedPath,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/.git/**', ...(ignore || [])],
  });

  const matches: GrepMatch[] = [];
  let filesSearched = 0;
  const maxFiles = 100;
  const maxMatches = 50;

  for (const file of files) {
    if (filesSearched >= maxFiles) break;
    if (!isAllowedExtension(file)) continue;

    filesSearched++;
    const fullPath = join(validatedPath, file);

    try {
      const content = await fsReadFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({
            file,
            line: i + 1,
            content: lines[i].trim().slice(0, 200),
          });
          regex.lastIndex = 0;

          if (matches.length >= maxMatches) break;
        }
      }
    } catch (err) {
      console.warn('[fs] Failed to read file during grep:', err instanceof Error ? err.message : err);
    }

    if (matches.length >= maxMatches) break;
  }

  return {
    pattern,
    basePath: untranslatePath(validatedPath),
    matches,
    filesSearched,
    truncated: matches.length >= maxMatches,
  };
}

export interface EditResult {
  path: string;
  replacements: number;
}

export async function editFile(
  path: string,
  oldString: string,
  newString: string,
  replaceAll: boolean = false
): Promise<EditResult> {
  const absolutePath = await validatePath(path);
  if (!isAllowedExtension(path)) {
    throw new Error('Edit denied: file extension is not allowed');
  }

  const content = await fsReadFile(absolutePath, 'utf-8');

  if (!content.includes(oldString)) {
    const lines = content.split('\n');
    const preview = lines.slice(0, 10).join('\n');
    throw new Error(
      `Edit failed: old_string not found in file.\n` +
      `File preview (first 10 lines):\n${preview}${lines.length > 10 ? '\n...' : ''}`
    );
  }

  const occurrences = content.split(oldString).length - 1;

  if (!replaceAll && occurrences > 1) {
    throw new Error(
      `Edit failed: old_string found ${occurrences} times. ` +
      `Provide more context to make it unique, or set replace_all=true.`
    );
  }

  const newContent = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);

  const bytes = Buffer.byteLength(newContent, 'utf-8');
  if (bytes > 100 * 1024) {
    throw new Error(`Edit would exceed max file size: ${bytes} bytes (max: 100KB)`);
  }

  await fsWriteFile(absolutePath, newContent, 'utf-8');

  return {
    path,
    replacements: replaceAll ? occurrences : 1,
  };
}

export interface MkdirResult {
  path: string;
  created: boolean;
}

export async function makeDirectory(path: string): Promise<MkdirResult> {
  const absolutePath = await validateTargetPath(path);

  if (await pathExists(absolutePath)) {
    const stats = await stat(absolutePath);
    if (stats.isDirectory()) {
      return { path: absolutePath, created: false };
    }
    throw new Error('Path already exists as a file');
  }

  await fsMkdir(absolutePath, { recursive: true });

  return {
    path: absolutePath,
    created: true,
  };
}

export interface MoveResult {
  source: string;
  destination: string;
  moved: boolean;
}

export async function moveFile(source: string, destination: string): Promise<MoveResult> {
  const absoluteSource = await validatePath(source);
  const absoluteDest = await validateTargetPath(destination);

  if (!await pathExists(absoluteSource)) {
    throw new Error(`Source does not exist: ${source}`);
  }

  if (await pathExists(absoluteDest)) {
    throw new Error(`Destination already exists: ${destination}`);
  }

  const destParent = dirname(absoluteDest);
  if (!await pathExists(destParent)) {
    await fsMkdir(destParent, { recursive: true });
  }

  await rename(absoluteSource, absoluteDest);

  return {
    source: absoluteSource,
    destination: absoluteDest,
    moved: true,
  };
}

export interface DeleteResult {
  path: string;
  deleted: boolean;
  type: 'file' | 'directory';
  itemsDeleted?: number;
}

export async function deleteFile(path: string, recursive: boolean = false): Promise<DeleteResult> {
  const absolutePath = await validatePath(path);

  if (!await pathExists(absolutePath)) {
    throw new Error(`Path does not exist: ${path}`);
  }

  const stats = await stat(absolutePath);

  if (stats.isDirectory()) {
    const entries = await readdir(absolutePath);
    if (entries.length > 0 && !recursive) {
      throw new Error(`Cannot delete non-empty directory: ${path} (contains ${entries.length} items). Set recursive=true to delete all contents.`);
    }
    if (recursive && entries.length > 0) {
      await rm(absolutePath, { recursive: true, force: true });
      return { path, deleted: true, type: 'directory', itemsDeleted: entries.length };
    }
    await rmdir(absolutePath);
    return { path, deleted: true, type: 'directory' };
  } else {
    await unlink(absolutePath);
    return { path, deleted: true, type: 'file' };
  }
}
