import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, stat, access, mkdir as fsMkdir, rename, unlink, rmdir, rm } from 'fs/promises';
import { join, resolve, relative, dirname, basename } from 'path';
import fg from 'fast-glob';
import { config } from '../config.js';

// Path mapping for cross-server compatibility
// When running on Baso (77.42.90.193), files from Klyde are mounted at /mnt/klyde-projects
// But the canonical path is /opt/Klyde/projects
const PATH_MAPPINGS: Array<{ canonical: string; mounted: string }> = [
  { canonical: '/opt/Klyde/projects', mounted: '/mnt/klyde-projects' },
];

// Translate canonical path to actual filesystem path
function translatePath(path: string): string {
  for (const mapping of PATH_MAPPINGS) {
    if (path.startsWith(mapping.canonical)) {
      return path.replace(mapping.canonical, mapping.mounted);
    }
  }
  return path;
}

// Translate actual filesystem path back to canonical path (for display)
function untranslatePath(path: string): string {
  for (const mapping of PATH_MAPPINGS) {
    if (path.startsWith(mapping.mounted)) {
      return path.replace(mapping.mounted, mapping.canonical);
    }
  }
  return path;
}

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

// Validate that the path is within allowed roots (config.allowedRoots)
// Handles path translation for cross-server compatibility
async function validatePath(path: string): Promise<string> {
  // Handle empty or root path requests - default to first allowed root
  if (!path || path === '/' || path === '.' || path === './') {
    const defaultRoot = config.allowedRoots[0];
    // Return the translated path (actual filesystem location)
    const translated = translatePath(defaultRoot);
    if (await pathExists(translated)) {
      return translated;
    }
    return defaultRoot;
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
      // Translate to actual filesystem path
      const translatedRoot = translatePath(absoluteRoot);
      const translatedPath = translatePath(normalizedPath);

      // Try case-insensitive resolution for the part after the root
      const relativePart = relative(absoluteRoot, normalizedPath);
      if (relativePart) {
        const resolved = await resolvePathCaseInsensitive(translatedRoot, relativePart);
        return resolved;
      }
      return translatedPath;
    }
  }

  // For relative paths, try each allowed root
  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    const translatedRoot = translatePath(absoluteRoot);
    const rootBasename = absoluteRoot.split('/').pop() || '';
    let cleanPath = path;

    // If the path IS the root's basename (e.g., "projects"), return the root
    if (segments.length === 1 && segments[0].toLowerCase() === rootBasename.toLowerCase()) {
      // Return translated path if it exists
      if (await pathExists(translatedRoot)) {
        return translatedRoot;
      }
      return absoluteRoot;
    }

    // If the path starts with the root's basename, strip it to avoid duplication
    // e.g., "DeviSpace/repros" -> "repros" when root is "/opt/Klyde/projects/DeviSpace"
    if (segments[0]?.toLowerCase() === rootBasename.toLowerCase()) {
      cleanPath = segments.slice(1).join('/');
    }

    // Use case-insensitive resolution with translated root
    const resolvedPath = await resolvePathCaseInsensitive(translatedRoot, cleanPath);
    const relativePath = relative(translatedRoot, resolvedPath);

    // Check for path traversal attacks
    if (!relativePath.startsWith('..') && !relativePath.startsWith('/')) {
      // Verify the path exists before returning
      if (await pathExists(resolvedPath)) {
        return resolvedPath;
      }
    }
  }

  throw new Error(
    `Path "${path}" not found within allowed roots: ${allowedRoots.join(', ')}. ` +
    `Try: fs.listFiles("${allowedRoots[0]}")`
  );
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
    path: untranslatePath(absolutePath), // Return canonical path for display
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

export async function globFiles(
  pattern: string,
  basePath?: string,
  ignore?: string[]
): Promise<GlobResult> {
  // Validate basePath is within allowed roots, or use first allowed root (translated)
  let searchPath: string;
  if (basePath) {
    searchPath = await validatePath(basePath);
  } else {
    const defaultRoot = config.allowedRoots[0];
    const translated = translatePath(defaultRoot);
    searchPath = await pathExists(translated) ? translated : defaultRoot;
  }

  const files = await fg(pattern, {
    cwd: searchPath,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/.git/**', ...(ignore || [])],
    absolute: false,
  });

  const truncated = files.length > config.toolMaxListEntries;

  return {
    pattern,
    basePath: untranslatePath(searchPath), // Return canonical path for display
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
  fileGlob?: string,
  ignore?: string[]
): Promise<GrepResult> {
  const validatedPath = await validatePath(searchPath);
  const regex = new RegExp(pattern, 'gi');

  // Get files to search
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
    basePath: untranslatePath(validatedPath), // Return canonical path for display
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
  newString: string,
  replaceAll: boolean = false
): Promise<EditResult> {
  const absolutePath = await validatePath(path);
  if (!isAllowedExtension(path)) {
    throw new Error('Edit denied: file extension is not allowed');
  }

  const content = await fsReadFile(absolutePath, 'utf-8');

  if (!content.includes(oldString)) {
    // Provide helpful context on failure
    const lines = content.split('\n');
    const preview = lines.slice(0, 10).join('\n');
    throw new Error(
      `Edit failed: old_string not found in file.\n` +
      `File preview (first 10 lines):\n${preview}${lines.length > 10 ? '\n...' : ''}`
    );
  }

  // Count occurrences
  const occurrences = content.split(oldString).length - 1;

  // If not replaceAll, require unique match
  if (!replaceAll && occurrences > 1) {
    throw new Error(
      `Edit failed: old_string found ${occurrences} times. ` +
      `Provide more context to make it unique, or set replace_all=true.`
    );
  }

  const newContent = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);

  // Size check for the new content
  const bytes = Buffer.byteLength(newContent, 'utf-8');
  if (bytes > config.toolMaxWriteBytes) {
    throw new Error(`Edit would exceed max file size: ${bytes} bytes (max: ${config.toolMaxWriteBytes} bytes)`);
  }

  await fsWriteFile(absolutePath, newContent, 'utf-8');

  return {
    path,
    replacements: replaceAll ? occurrences : 1,
  };
}

// ============ Helper for validating target paths (may not exist yet) ============

async function validateTargetPath(path: string): Promise<string> {
  // Handle empty path
  if (!path || path === '/' || path === '.' || path === './') {
    throw new Error('Invalid path: cannot use root directory');
  }

  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.includes('.git')) {
    throw new Error('Access denied: .git paths are not allowed');
  }

  const allowedRoots = [...config.allowedRoots];

  // Check if it's already an absolute path within allowed roots
  const normalizedPath = resolve(path);
  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    if (normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot) {
      // Translate to actual filesystem path
      const translatedRoot = translatePath(absoluteRoot);
      const translatedPath = translatePath(normalizedPath);
      // Verify the root actually exists on this system
      if (await pathExists(translatedRoot)) {
        return translatedPath;
      }
    }
  }

  // For paths that look absolute but aren't under allowed roots (e.g., "/test/...")
  // treat them as relative paths by stripping the leading slash
  let cleanSegments = [...segments];

  // For relative paths, try each allowed root (only if root exists)
  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    const translatedRoot = translatePath(absoluteRoot);

    // Skip roots that don't exist on this system (check translated path)
    if (!await pathExists(translatedRoot)) {
      continue;
    }

    const rootBasename = absoluteRoot.split('/').pop() || '';

    // If the path starts with the root's basename, strip it
    if (cleanSegments[0]?.toLowerCase() === rootBasename.toLowerCase()) {
      cleanSegments = cleanSegments.slice(1);
    }

    // Try to match the first segment case-insensitively against existing directories
    const firstSegment = cleanSegments[0];
    if (firstSegment) {
      const match = await findCaseInsensitiveMatch(translatedRoot, firstSegment);
      if (match) {
        // Replace first segment with correctly-cased version
        cleanSegments[0] = match;
      }
    }

    const cleanPath = cleanSegments.join('/');
    const fullPath = join(translatedRoot, cleanPath);
    const relativePath = relative(translatedRoot, fullPath);

    // Check for path traversal attacks
    if (!relativePath.startsWith('..') && !relativePath.startsWith('/')) {
      return fullPath;
    }
  }

  throw new Error(`Path must be within allowed roots: ${allowedRoots.join(', ')}`);
}

// ============ MKDIR - Create directory ============

export interface MkdirResult {
  path: string;
  created: boolean;
}

export async function makeDirectory(path: string): Promise<MkdirResult> {
  const absolutePath = await validateTargetPath(path);

  // Check if directory already exists
  if (await pathExists(absolutePath)) {
    const stats = await stat(absolutePath);
    if (stats.isDirectory()) {
      return { path: absolutePath, created: false }; // Already exists
    }
    throw new Error('Path already exists as a file');
  }

  // Create the directory (recursive to create parent dirs if needed)
  await fsMkdir(absolutePath, { recursive: true });

  return {
    path: absolutePath,
    created: true,
  };
}

// ============ MOVE - Move/rename files and directories ============

export interface MoveResult {
  source: string;
  destination: string;
  moved: boolean;
}

export async function moveFile(source: string, destination: string): Promise<MoveResult> {
  const absoluteSource = await validatePath(source);
  const absoluteDest = await validateTargetPath(destination);

  // Check source exists
  if (!await pathExists(absoluteSource)) {
    throw new Error(`Source does not exist: ${source}`);
  }

  // Check destination doesn't already exist
  if (await pathExists(absoluteDest)) {
    throw new Error(`Destination already exists: ${destination}`);
  }

  // Ensure parent directory of destination exists
  const destParent = dirname(absoluteDest);
  if (!await pathExists(destParent)) {
    await fsMkdir(destParent, { recursive: true });
  }

  // Perform the move/rename
  await rename(absoluteSource, absoluteDest);

  return {
    source: absoluteSource,
    destination: absoluteDest,
    moved: true,
  };
}

// ============ DELETE - Delete files and directories ============

export interface DeleteResult {
  path: string;
  deleted: boolean;
  type: 'file' | 'directory';
  itemsDeleted?: number;
}

export async function deleteFile(path: string, recursive: boolean = false): Promise<DeleteResult> {
  const absolutePath = await validatePath(path);

  // Check if path exists
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
