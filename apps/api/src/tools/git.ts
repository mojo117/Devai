import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import { config } from '../config.js';
import { access } from 'fs/promises';
import { join, resolve, dirname } from 'path';

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
  const projectRoot = config.projectRoot;
  const baseDir = projectRoot || process.cwd();
  const gitRoot = await findGitRoot(baseDir);

  if (!gitRoot) {
    throw new Error(
      `No git repository found from ${baseDir}. Set PROJECT_ROOT to a git repo.`
    );
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
  const diff = await git.diff(diffOptions);

  // Parse diff stats
  const diffStat = await git.diffSummary(diffOptions);

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
