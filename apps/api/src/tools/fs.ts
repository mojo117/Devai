import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, stat, access } from 'fs/promises';
import { join, resolve, relative, dirname, basename } from 'path';
import fg from 'fast-glob';
import { config } from '../config.js';

// Check if a path exists
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Find case-insensitive match for a path segment in a directory
async function findCaseInsensitiveMatch(parentDir: string, targetName: string): Promise<string | null> {
  try {
    const entries = await readdir(parentDir);
    const match = entries.find(entry => entry.toLowerCase() === targetName.toLowerCase());
    return match || null;
  } catch {
    return null;
  }
}

// Resolve a path with case-insensitive matching
async function resolvePathCaseInsensitive(basePath: string, relativePath: string): Promise<string> {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  let currentPath = basePath;

  for (const segment of segments) {
    const exactPath = join(currentPath, segment);

    // Try exact match first
    if (await pathExists(exactPath)) {
      currentPath = exactPath;
      continue;
    }

    // Try case-insensitive match
    const match = await findCaseInsensitiveMatch(currentPath, segment);
    if (match) {
      currentPath = join(currentPath, match);
    } else {
      // No match found - return the path as-is (will fail later with proper error)
      currentPath = exactPath;
    }
  }

  return currentPath;
}

// Validate that the path is within allowed roots
// File access is restricted to /opt/Klyde/projects and /workingtrees
async function validatePath(path: string): Promise<string> {
  // Handle empty or root path requests - default to first allowed root
  if (!path || path === '/' || path === '.' || path === './') {
    return config.allowedRoots[0];
  }

  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.includes('.git')) {
    throw new Error('Access denied: .git paths are not allowed');
  }

  // Use only the hardcoded allowed roots from config
  const allowedRoots = [...config.allowedRoots];

  if (allowedRoots.length === 0) {
    throw new Error('No allowed roots configured');
  }

  // Check if it's already an absolute path within allowed roots
  const normalizedPath = resolve(path);
  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    if (normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot) {
      // Try case-insensitive resolution for the part after the root
      const relativePart = relative(absoluteRoot, normalizedPath);
      if (relativePart) {
        return await resolvePathCaseInsensitive(absoluteRoot, relativePart);
      }
      return normalizedPath;
    }
  }

  // For relative paths, try each allowed root
  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    const rootBasename = absoluteRoot.split('/').pop() || '';
    let cleanPath = path;

    // If the path IS the root's basename (e.g., "projects"), return the root
    if (segments.length === 1 && segments[0].toLowerCase() === rootBasename.toLowerCase()) {
      return absoluteRoot;
    }

    // If the path starts with the root's basename, strip it to avoid duplication
    // e.g., "projects/Test" -> "Test" when root is "/opt/Klyde/projects"
    if (segments[0]?.toLowerCase() === rootBasename.toLowerCase()) {
      cleanPath = segments.slice(1).join('/');
    }

    // Use case-insensitive resolution
    const resolvedPath = await resolvePathCaseInsensitive(absoluteRoot, cleanPath);
    const relativePath = relative(absoluteRoot, resolvedPath);

    // Check for path traversal attacks
    if (!relativePath.startsWith('..') && !relativePath.startsWith('/')) {
      // Verify the path exists before returning
      if (await pathExists(resolvedPath)) {
        return resolvedPath;
      }
    }
  }

  throw new Error(`Path not found. Available roots: ${allowedRoots.join(', ')}. Try listing "projects" or a specific project like "projects/Devai".`);
}

function isAllowedExtension(path: string): boolean {
  const fileName = path.split(/[\\/]/).pop() || '';
  if (!fileName.includes('.')) return false;
  const lowered = fileName.toLowerCase();
  return config.toolAllowedExtensions.some((ext) => lowered.endsWith(ext));
}

export interface ListFilesResult {
  path: string;
  files: Array<{
    name: string;
    type: 'file' | 'directory';
    size?: number;
  }>;
  truncated?: boolean;
}

export async function listFiles(path: string): Promise<ListFilesResult> {
  const absolutePath = await validatePath(path);

  const entries = await readdir(absolutePath, { withFileTypes: true });

  const entriesLimited = entries.slice(0, config.toolMaxListEntries);
  const files = await Promise.all(
    entriesLimited.map(async (entry) => {
      const entryPath = join(absolutePath, entry.name);
      let size: number | undefined;

      if (entry.isFile()) {
        try {
          const stats = await stat(entryPath);
          size = stats.size;
        } catch {
          // Ignore stat errors
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
    path,
    files: files.sort((a, b) => {
      // Directories first, then files
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

export async function readFile(path: string): Promise<ReadFileResult> {
  const absolutePath = await validatePath(path);
  if (!isAllowedExtension(path)) {
    throw new Error('Read denied: file extension is not allowed');
  }

  const stats = await stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${path}`);
  }

  if (stats.size > config.toolMaxReadBytes) {
    throw new Error(`File too large: ${stats.size} bytes (max: ${config.toolMaxReadBytes} bytes)`);
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
  if (bytes > config.toolMaxWriteBytes) {
    throw new Error(`Write too large: ${bytes} bytes (max: ${config.toolMaxWriteBytes} bytes)`);
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

// ============ GLOB - Pattern-based file search ============

export interface GlobResult {
  pattern: string;
  basePath: string;
  files: string[];
  count: number;
  truncated: boolean;
}

export async function globFiles(pattern: string, basePath?: string): Promise<GlobResult> {
  // Validate basePath is within allowed roots, or use first allowed root
  const searchPath = basePath ? await validatePath(basePath) : config.allowedRoots[0];

  const files = await fg(pattern, {
    cwd: searchPath,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
    absolute: false,
  });

  const truncated = files.length > config.toolMaxListEntries;

  return {
    pattern,
    basePath: searchPath,
    files: files.slice(0, config.toolMaxListEntries),
    count: files.length,
    truncated,
  };
}

// ============ GREP - Content search ============

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
  fileGlob?: string
): Promise<GrepResult> {
  const validatedPath = await validatePath(searchPath);
  const regex = new RegExp(pattern, 'gi');

  // Get files to search
  const globPattern = fileGlob || '**/*';
  const files = await fg(globPattern, {
    cwd: validatedPath,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
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
            content: lines[i].trim().slice(0, 200), // Limit line length
          });
          regex.lastIndex = 0; // Reset regex state

          if (matches.length >= maxMatches) break;
        }
      }
    } catch {
      // Skip files that can't be read
    }

    if (matches.length >= maxMatches) break;
  }

  return {
    pattern,
    basePath: validatedPath,
    matches,
    filesSearched,
    truncated: matches.length >= maxMatches,
  };
}

// ============ EDIT - Targeted file edits ============

export interface EditResult {
  path: string;
  replacements: number;
}

export async function editFile(
  path: string,
  oldString: string,
  newString: string
): Promise<EditResult> {
  const absolutePath = await validatePath(path);
  if (!isAllowedExtension(path)) {
    throw new Error('Edit denied: file extension is not allowed');
  }

  const content = await fsReadFile(absolutePath, 'utf-8');

  if (!content.includes(oldString)) {
    throw new Error('Edit failed: old_string not found in file');
  }

  // Count occurrences to ensure uniqueness
  const occurrences = content.split(oldString).length - 1;
  if (occurrences > 1) {
    throw new Error(
      `Edit failed: old_string found ${occurrences} times. Provide more context to make it unique.`
    );
  }

  const newContent = content.replace(oldString, newString);

  // Size check for the new content
  const bytes = Buffer.byteLength(newContent, 'utf-8');
  if (bytes > config.toolMaxWriteBytes) {
    throw new Error(`Edit would exceed max file size: ${bytes} bytes (max: ${config.toolMaxWriteBytes} bytes)`);
  }

  await fsWriteFile(absolutePath, newContent, 'utf-8');

  return {
    path,
    replacements: 1,
  };
}
