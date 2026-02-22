import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, extname } from 'path';

// Context documents folder path (relative to project that DevAI is working on)
const CONTEXT_FOLDER = 'context/documents';

// Allowed extensions for context documents
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md']);

export interface DocumentInfo {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface DocumentContent {
  name: string;
  path: string;
  content: string;
  size: number;
}

export interface SearchResult {
  name: string;
  path: string;
  matches: Array<{
    line: number;
    content: string;
  }>;
}

/**
 * Get the absolute path to the context documents folder
 */
function getContextPath(projectRoot: string): string {
  return join(projectRoot, CONTEXT_FOLDER);
}

/**
 * Check if a file has an allowed extension
 */
function isAllowedFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * List all documents in the context folder
 */
export async function listDocuments(projectRoot: string): Promise<{
  documents: DocumentInfo[];
  folder: string;
}> {
  const contextPath = getContextPath(projectRoot);

  try {
    const entries = await readdir(contextPath, { withFileTypes: true });
    const documents: DocumentInfo[] = [];

    for (const entry of entries) {
      if (entry.isFile() && isAllowedFile(entry.name)) {
        const filePath = join(contextPath, entry.name);
        const stats = await stat(filePath);

        documents.push({
          name: entry.name,
          path: relative(projectRoot, filePath),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      }
    }

    // Sort by name
    documents.sort((a, b) => a.name.localeCompare(b.name));

    return {
      documents,
      folder: CONTEXT_FOLDER,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        documents: [],
        folder: CONTEXT_FOLDER,
      };
    }
    throw error;
  }
}

/**
 * Read a specific document from the context folder
 */
export async function readDocument(
  projectRoot: string,
  documentPath: string
): Promise<DocumentContent> {
  // Normalize the path - accept both full path and just filename
  const filename = documentPath.includes('/')
    ? documentPath.split('/').pop()!
    : documentPath;

  if (!isAllowedFile(filename)) {
    throw new Error(`File type not allowed. Only .txt and .md files are supported.`);
  }

  const contextPath = getContextPath(projectRoot);
  const filePath = join(contextPath, filename);

  // Security: ensure the resolved path is within the context folder
  if (!filePath.startsWith(contextPath)) {
    throw new Error('Access denied: path traversal detected');
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);

    return {
      name: filename,
      path: relative(projectRoot, filePath),
      content,
      size: stats.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Document not found: ${filename}`);
    }
    throw error;
  }
}

/**
 * Search for text across all documents in the context folder
 */
export async function searchDocuments(
  projectRoot: string,
  query: string
): Promise<{
  query: string;
  results: SearchResult[];
  totalMatches: number;
}> {
  const { documents } = await listDocuments(projectRoot);
  const results: SearchResult[] = [];
  let totalMatches = 0;

  const queryLower = query.toLowerCase();

  for (const doc of documents) {
    try {
      const { content } = await readDocument(projectRoot, doc.name);
      const lines = content.split('\n');
      const matches: Array<{ line: number; content: string }> = [];

      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(queryLower)) {
          matches.push({
            line: index + 1,
            content: line.trim().substring(0, 200), // Limit line length
          });
        }
      });

      if (matches.length > 0) {
        results.push({
          name: doc.name,
          path: doc.path,
          matches: matches.slice(0, 10), // Limit matches per file
        });
        totalMatches += matches.length;
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return {
    query,
    results,
    totalMatches,
  };
}
