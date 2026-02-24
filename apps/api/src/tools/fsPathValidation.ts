import { readdir, access, realpath as fsRealpath } from 'fs/promises';
import { join, resolve, relative } from 'path';
import { config } from '../config.js';

export interface FsOptions {
  selfInspection?: boolean;
}

const PATH_MAPPINGS: Array<{ canonical: string; mounted: string }> = [];

export function translatePath(path: string): string {
  for (const mapping of PATH_MAPPINGS) {
    if (path.startsWith(mapping.canonical)) {
      return path.replace(mapping.canonical, mapping.mounted);
    }
  }
  return path;
}

export function untranslatePath(path: string): string {
  for (const mapping of PATH_MAPPINGS) {
    if (path.startsWith(mapping.mounted)) {
      return path.replace(mapping.mounted, mapping.canonical);
    }
  }
  return path;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (_err) {
    return false;
  }
}

async function findCaseInsensitiveMatch(parentDir: string, targetName: string): Promise<string | null> {
  try {
    const entries = await readdir(parentDir);
    const match = entries.find(entry => entry.toLowerCase() === targetName.toLowerCase());
    return match || null;
  } catch (_err) {
    return null;
  }
}

export async function resolvePathCaseInsensitive(basePath: string, relativePath: string): Promise<string> {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  let currentPath = basePath;

  for (const segment of segments) {
    const exactPath = join(currentPath, segment);

    if (await pathExists(exactPath)) {
      currentPath = exactPath;
      continue;
    }

    const match = await findCaseInsensitiveMatch(currentPath, segment);
    if (match) {
      currentPath = join(currentPath, match);
    } else {
      currentPath = exactPath;
    }
  }

  return currentPath;
}

export async function validateRealPath(filePath: string, allowedRoots: readonly string[]): Promise<string> {
  try {
    const realPath = await fsRealpath(filePath);
    for (const root of allowedRoots) {
      const absoluteRoot = resolve(root);
      const translatedRoot = translatePath(absoluteRoot);
      if (realPath.startsWith(translatedRoot + '/') || realPath === translatedRoot ||
          realPath.startsWith(absoluteRoot + '/') || realPath === absoluteRoot) {
        return realPath;
      }
    }
    for (const denied of config.deniedPaths) {
      const absoluteDenied = resolve(denied);
      if (realPath.startsWith(absoluteDenied + '/') || realPath === absoluteDenied) {
        throw new Error(`Access denied: symlink target "${realPath}" is in a restricted area`);
      }
    }
    throw new Error(`Access denied: symlink target "${realPath}" is outside allowed roots`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return filePath;
    }
    throw err;
  }
}

export async function validatePath(path: string, options?: FsOptions): Promise<string> {
  if (!path || path === '/' || path === '.' || path === './') {
    const defaultRoot = config.allowedRoots[0];
    const translated = translatePath(defaultRoot);
    if (await pathExists(translated)) {
      return await validateRealPath(translated, config.allowedRoots);
    }
    return await validateRealPath(defaultRoot, config.allowedRoots);
  }

  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.includes('.git')) {
    throw new Error('Access denied: .git paths are not allowed');
  }

  const allowedRoots = [...config.allowedRoots];

  if (allowedRoots.length === 0) {
    throw new Error('No allowed roots configured');
  }

  const normalizedPath = resolve(path);

  for (const denied of config.deniedPaths) {
    const absoluteDenied = resolve(denied);
    if (normalizedPath.startsWith(absoluteDenied + '/') || normalizedPath === absoluteDenied) {
      const selfRoot = resolve(config.selfInspectionRoot);
      if (options?.selfInspection && absoluteDenied === selfRoot) {
        const relativeToSelf = normalizedPath.slice(selfRoot.length + 1);
        const isExcluded = config.selfInspectionExclude.some((exclude) => {
          return relativeToSelf === exclude ||
                 relativeToSelf.startsWith(exclude + '/') ||
                 relativeToSelf.endsWith('/' + exclude) ||
                 relativeToSelf.includes('/' + exclude + '/');
        });
        if (isExcluded) {
          throw new Error(`Access denied: "${path}" is excluded from self-inspection`);
        }
        continue;
      }
      throw new Error(`Access denied: "${path}" is in a restricted area`);
    }
  }

  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    if (normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot) {
      const translatedRoot = translatePath(absoluteRoot);
      const translatedPath = translatePath(normalizedPath);

      const relativePart = relative(absoluteRoot, normalizedPath);
      if (relativePart) {
        const resolved = await resolvePathCaseInsensitive(translatedRoot, relativePart);
        return await validateRealPath(resolved, allowedRoots);
      }
      return await validateRealPath(translatedPath, allowedRoots);
    }
  }

  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    const translatedRoot = translatePath(absoluteRoot);
    const rootBasename = absoluteRoot.split('/').pop() || '';
    let cleanPath = path;

    if (segments.length === 1 && segments[0].toLowerCase() === rootBasename.toLowerCase()) {
      if (await pathExists(translatedRoot)) {
        return await validateRealPath(translatedRoot, allowedRoots);
      }
      return await validateRealPath(absoluteRoot, allowedRoots);
    }

    if (segments[0]?.toLowerCase() === rootBasename.toLowerCase()) {
      cleanPath = segments.slice(1).join('/');
    }

    const resolvedPath = await resolvePathCaseInsensitive(translatedRoot, cleanPath);
    const relativePath = relative(translatedRoot, resolvedPath);

    if (!relativePath.startsWith('..') && !relativePath.startsWith('/')) {
      if (await pathExists(resolvedPath)) {
        return await validateRealPath(resolvedPath, allowedRoots);
      }
    }
  }

  throw new Error(
    `Path "${path}" not found within allowed roots: ${allowedRoots.join(', ')}. ` +
    `Try: fs_listFiles("${allowedRoots[0]}")`
  );
}

export async function validateTargetPath(path: string): Promise<string> {
  if (!path || path === '/' || path === '.' || path === './') {
    throw new Error('Invalid path: cannot use root directory');
  }

  const segments = path.split(/[\\/]/).filter(Boolean);
  if (segments.includes('.git')) {
    throw new Error('Access denied: .git paths are not allowed');
  }

  const allowedRoots = [...config.allowedRoots];
  const normalizedPath = resolve(path);

  for (const denied of config.deniedPaths) {
    const absoluteDenied = resolve(denied);
    if (normalizedPath.startsWith(absoluteDenied + '/') || normalizedPath === absoluteDenied) {
      throw new Error(`Access denied: "${path}" is in a restricted area`);
    }
  }

  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    if (normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot) {
      const translatedRoot = translatePath(absoluteRoot);
      const translatedPath = translatePath(normalizedPath);
      if (await pathExists(translatedRoot)) {
        return translatedPath;
      }
    }
  }

  let cleanSegments = [...segments];

  for (const root of allowedRoots) {
    const absoluteRoot = resolve(root);
    const translatedRoot = translatePath(absoluteRoot);

    if (!await pathExists(translatedRoot)) {
      continue;
    }

    const rootBasename = absoluteRoot.split('/').pop() || '';

    if (cleanSegments[0]?.toLowerCase() === rootBasename.toLowerCase()) {
      cleanSegments = cleanSegments.slice(1);
    }

    const firstSegment = cleanSegments[0];
    if (firstSegment) {
      const entries = await readdir(translatedRoot).catch(() => [] as string[]);
      const match = entries.find(e => e.toLowerCase() === firstSegment.toLowerCase());
      if (match) {
        cleanSegments[0] = match;
      }
    }

    const cleanPath = cleanSegments.join('/');
    const fullPath = join(translatedRoot, cleanPath);
    const relativePath = relative(translatedRoot, fullPath);

    if (!relativePath.startsWith('..') && !relativePath.startsWith('/')) {
      return fullPath;
    }
  }

  throw new Error(`Path must be within allowed roots: ${allowedRoots.join(', ')}`);
}

export function isAllowedExtension(path: string): boolean {
  const fileName = path.split(/[\\/]/).pop() || '';
  if (!fileName.includes('.')) return false;
  const lowered = fileName.toLowerCase();
  return config.toolAllowedExtensions.some((ext) => lowered.endsWith(ext));
}
