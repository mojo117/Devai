import { readdir, readFile as fsReadFile, writeFile as fsWriteFile, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';
import { config } from '../config.js';

// Validate that the path is within the project root
function validatePath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.includes('.git')) {
    throw new Error('Access denied: .git paths are not allowed');
  }
  const allowedRoots = [
    ...(config.projectRoot ? [config.projectRoot] : []),
    ...config.allowedRoots,
  ];

  if (allowedRoots.length === 0) {
    throw new Error('No allowed roots configured (set PROJECT_ROOT or ALLOWED_ROOTS)');
  }

  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    const absolutePath = resolve(absoluteRoot, path);
    const relativePath = relative(absoluteRoot, absolutePath);

    // Check for path traversal attacks
    if (!relativePath.startsWith('..') && !relativePath.startsWith('/')) {
      return absolutePath;
    }
  }

  throw new Error('Access denied: Path is outside allowed roots');
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
  const absolutePath = validatePath(path);

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
  const absolutePath = validatePath(path);
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
  const absolutePath = validatePath(path);
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
