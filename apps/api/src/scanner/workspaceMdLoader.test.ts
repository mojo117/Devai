import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { loadWorkspaceMdContext } from './workspaceMdLoader.js';

function formatDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: string): Promise<void> {
  const path = join(workspaceRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

describe('workspaceMdLoader', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'devai-workspace-md-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('loads MEMORY.md only in main mode', async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    await writeWorkspaceFile(workspaceRoot, 'AGENTS.md', '# AGENTS');
    await writeWorkspaceFile(workspaceRoot, 'IDENTITY.md', '# IDENTITY');
    await writeWorkspaceFile(workspaceRoot, 'SOUL.md', '# SOUL');
    await writeWorkspaceFile(workspaceRoot, 'USER.md', '# USER');
    await writeWorkspaceFile(workspaceRoot, 'TOOLS.md', '# TOOLS');
    await writeWorkspaceFile(workspaceRoot, `memory/${formatDateStamp(today)}.md`, 'today memory');
    await writeWorkspaceFile(workspaceRoot, `memory/${formatDateStamp(yesterday)}.md`, 'yesterday memory');
    await writeWorkspaceFile(workspaceRoot, 'MEMORY.md', 'long term memory');

    const mainContext = await loadWorkspaceMdContext({ mode: 'main', workspaceRoot });
    const sharedContext = await loadWorkspaceMdContext({ mode: 'shared', workspaceRoot });

    expect(mainContext.diagnostics.mode).toBe('main');
    expect(sharedContext.diagnostics.mode).toBe('shared');
    expect(mainContext.files.some((file) => file.role === 'Long-Term Memory')).toBe(true);
    expect(sharedContext.files.some((file) => file.role === 'Long-Term Memory')).toBe(false);
    expect(mainContext.combined).toContain('long term memory');
    expect(sharedContext.combined).not.toContain('long term memory');
  });

  it('reports missing required workspace files', async () => {
    await writeWorkspaceFile(workspaceRoot, 'AGENTS.md', '# AGENTS');

    const context = await loadWorkspaceMdContext({ mode: 'main', workspaceRoot });

    expect(context.diagnostics.missingFiles).toEqual(
      expect.arrayContaining(['IDENTITY.md', 'SOUL.md', 'USER.md', 'TOOLS.md'])
    );
  });
});
