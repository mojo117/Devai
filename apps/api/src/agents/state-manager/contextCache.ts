// Context cache TTL (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CachedFile {
  content: string;
  size: number;
  cachedAt: number;
}

export interface CachedGitStatus {
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  cachedAt: number;
}

export interface ContextCache {
  files: Map<string, CachedFile>;
  gitStatus?: CachedGitStatus;
  ttlMs: number;
}

// Context cache storage (per session)
const contextCacheStore = new Map<string, ContextCache>();

function getOrCreateContextCache(sessionId: string): ContextCache {
  let cache = contextCacheStore.get(sessionId);
  if (!cache) {
    cache = {
      files: new Map(),
      ttlMs: CACHE_TTL_MS,
    };
    contextCacheStore.set(sessionId, cache);
  }
  return cache;
}

/**
 * Get a cached file if it exists and is not expired
 */
export function getCachedFile(sessionId: string, path: string): CachedFile | undefined {
  const cache = contextCacheStore.get(sessionId);
  if (!cache) return undefined;

  const cached = cache.files.get(path);
  if (!cached) return undefined;

  // Check TTL
  if (Date.now() - cached.cachedAt > cache.ttlMs) {
    cache.files.delete(path);
    return undefined;
  }

  return cached;
}

/**
 * Cache a file for future use
 */
export function cacheFile(
  sessionId: string,
  path: string,
  content: string,
  size: number,
): void {
  const cache = getOrCreateContextCache(sessionId);
  cache.files.set(path, {
    content,
    size,
    cachedAt: Date.now(),
  });
}

/**
 * Get cached git status if exists and not expired
 */
export function getCachedGitStatus(sessionId: string): CachedGitStatus | undefined {
  const cache = contextCacheStore.get(sessionId);
  if (!cache?.gitStatus) return undefined;

  // Check TTL (shorter for git status - 1 minute)
  if (Date.now() - cache.gitStatus.cachedAt > 60 * 1000) {
    cache.gitStatus = undefined;
    return undefined;
  }

  return cache.gitStatus;
}

/**
 * Cache git status for future use
 */
export function cacheGitStatus(
  sessionId: string,
  status: { branch: string; staged: string[]; modified: string[]; untracked: string[] },
): void {
  const cache = getOrCreateContextCache(sessionId);
  cache.gitStatus = {
    ...status,
    cachedAt: Date.now(),
  };
}

/**
 * Clear all cached context for a session
 */
export function clearContextCache(sessionId: string): void {
  contextCacheStore.delete(sessionId);
}

/**
 * Get cache statistics for a session
 */
export function getCacheStats(sessionId: string): {
  fileCount: number;
  hasGitStatus: boolean;
  oldestFile?: number;
} {
  const cache = contextCacheStore.get(sessionId);
  if (!cache) {
    return { fileCount: 0, hasGitStatus: false };
  }

  let oldestFile: number | undefined;
  for (const [, file] of cache.files) {
    if (!oldestFile || file.cachedAt < oldestFile) {
      oldestFile = file.cachedAt;
    }
  }

  return {
    fileCount: cache.files.size,
    hasGitStatus: !!cache.gitStatus,
    oldestFile,
  };
}
