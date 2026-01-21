import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import { config } from '../config.js';
import { access } from 'fs/promises';
import { join, resolve, dirname, relative } from 'path';

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findGitRoot(startDir: string): Promise<string | null> {
  let current = resolve(startDir);

  while (true) {
    if (await pathExists(join(current, '.git'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function getGit(): Promise<SimpleGit> {
  // Use only the hardcoded allowed roots
  const allowedRoots = [...config.allowedRoots];

  if (allowedRoots.length === 0) {
    throw new Error('No allowed roots configured for git operations');
  }

  // Try to find a git repo starting from the first allowed root
  const baseDir = allowedRoots[0];
  const gitRoot = await findGitRoot(baseDir);

  if (!gitRoot) {
    throw new Error(
      `No git repository found from ${baseDir}. Ensure a git repo exists within allowed paths.`
    );
  }

  // Verify git root is within allowed paths
  const gitRootResolved = resolve(gitRoot);
  const allowed = allowedRoots.some((root) => {
    const absoluteRoot = resolve(root);
    return gitRootResolved.startsWith(absoluteRoot + '/') || gitRootResolved === absoluteRoot;
  });

  if (!allowed) {
    throw new Error(`Access denied: Git repository must be within ${allowedRoots.join(' or ')}`);
  }

  return simpleGit(gitRoot);
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  deleted: string[];
  untracked: string[];
  conflicted: string[];
}

export async function gitStatus(): Promise<GitStatusResult> {
  const git = await getGit();
  const status: StatusResult = await git.status();

  return {
    branch: status.current || 'unknown',
    ahead: status.ahead,
    behind: status.behind,
    staged: status.staged,
    modified: status.modified,
    deleted: status.deleted,
    untracked: status.not_added,
    conflicted: status.conflicted,
  };
}

export interface GitDiffResult {
  diff: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export async function gitDiff(staged: boolean = false): Promise<GitDiffResult> {
  const git = await getGit();

  const diffOptions = staged ? ['--staged'] : [];
  let diff = await git.diff(diffOptions);

  // Parse diff stats
  const diffStat = await git.diffSummary(diffOptions);
  if (diff.length > config.toolMaxDiffChars) {
    diff = `${diff.slice(0, config.toolMaxDiffChars)}\n... (diff truncated)`;
  }

  return {
    diff: diff || '(no changes)',
    filesChanged: diffStat.files.length,
    insertions: diffStat.insertions,
    deletions: diffStat.deletions,
  };
}

export interface GitCommitResult {
  hash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
}

export async function gitCommit(message: string): Promise<GitCommitResult> {
  const git = await getGit();

  // Check if there are staged changes
  const status = await git.status();
  if (status.staged.length === 0) {
    throw new Error('No staged changes to commit. Use git add first.');
  }

  const result = await git.commit(message);

  return {
    hash: result.commit,
    message,
    author: result.author?.name || 'unknown',
    date: new Date().toISOString(),
    filesChanged: result.summary.changes,
  };
}
