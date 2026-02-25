import { resolve, relative, dirname } from 'path';
import { realpath, stat } from 'fs/promises';
import { config, type PreviewWorkspaceConfig } from '../config.js';

export interface ResolvedWorkspacePath {
  workspace: PreviewWorkspaceConfig;
  absolutePath: string;
}

function normalizeRoot(root: string): string {
  const normalized = resolve(root);
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

function ensureSafeRelativePath(path: string): string {
  if (!path || !path.trim()) {
    throw new Error('Path is required');
  }
  if (path.includes('\u0000')) {
    throw new Error('Path must not contain null bytes');
  }
  if (path.startsWith('/')) {
    throw new Error('Path must be relative to workspace root');
  }
  const normalized = resolve('/', path).slice(1);
  if (normalized.startsWith('..')) {
    throw new Error('Path traversal is not allowed');
  }
  return normalized;
}

const registry = new Map<string, PreviewWorkspaceConfig>(
  config.previewWorkspaces.map((entry) => [entry.id, { ...entry, root: normalizeRoot(entry.root) }]),
);

export function listPreviewWorkspaces(): PreviewWorkspaceConfig[] {
  return Array.from(registry.values()).map((entry) => ({ ...entry }));
}

export function getWorkspaceById(workspaceId: string): PreviewWorkspaceConfig | null {
  return registry.get(workspaceId) ?? null;
}

export async function resolveWorkspacePath(workspaceId: string, relativePath: string): Promise<ResolvedWorkspacePath> {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) {
    throw new Error(`Unknown workspace "${workspaceId}"`);
  }

  const safeRelativePath = ensureSafeRelativePath(relativePath);
  const candidate = resolve(workspace.root, safeRelativePath);
  const candidateParent = dirname(candidate);
  const realParent = await realpath(candidateParent).catch(() => candidateParent);
  const resolvedPath = resolve(realParent, candidate.split('/').pop() || '');

  if (!isWithinRoot(workspace.root, resolvedPath)) {
    throw new Error(`Path "${relativePath}" escapes workspace "${workspaceId}"`);
  }

  return {
    workspace,
    absolutePath: resolvedPath,
  };
}

export async function detectWorkspaceForAbsolutePath(path: string): Promise<{
  workspace: PreviewWorkspaceConfig;
  relativePath: string;
} | null> {
  const normalizedInput = resolve(path);
  const realInput = await realpath(normalizedInput).catch(() => normalizedInput);

  for (const workspace of registry.values()) {
    if (!isWithinRoot(workspace.root, realInput)) continue;
    const rel = relative(workspace.root, realInput);
    return {
      workspace,
      relativePath: rel || '.',
    };
  }

  return null;
}

export async function assertWorkspaceFileExists(workspaceId: string, relativePath: string): Promise<void> {
  const resolved = await resolveWorkspacePath(workspaceId, relativePath);
  const fileStat = await stat(resolved.absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Expected file at ${workspaceId}:${relativePath}`);
  }
}

