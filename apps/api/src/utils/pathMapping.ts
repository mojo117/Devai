import { access } from 'fs/promises';
import { resolve } from 'path';

// Canonical path on Klyde -> mounted path on Baso (SSHFS)
const PATH_MAPPINGS: Array<{ canonical: string; mounted: string }> = [
  { canonical: '/opt/Klyde/projects', mounted: '/mnt/klyde-projects' },
];

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Prefer the first existing of: original path, translated path.
// This lets the API accept canonical paths (Klyde) while still working on Baso mounts.
export async function toRuntimePath(inputPath: string): Promise<string> {
  const p = resolve(inputPath);
  if (await pathExists(p)) return p;

  const translated = translatePath(p);
  if (translated !== p && await pathExists(translated)) return translated;

  return p;
}

// Normalize any absolute path to the canonical view used in prompts/UI.
export function toCanonicalPath(inputPath: string): string {
  const p = resolve(inputPath);
  return untranslatePath(p);
}
