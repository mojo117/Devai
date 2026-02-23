import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { loadWorkspaceMdContext } from './workspaceMdLoader.js';

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

  it('loads memory.md only in main mode', async () => {
    await writeWorkspaceFile(workspaceRoot, 'AGENTS.md', '# AGENTS');
    await writeWorkspaceFile(workspaceRoot, 'SOUL.md', '# SOUL');
    await writeWorkspaceFile(workspaceRoot, 'USER.md', '# USER');
    await writeWorkspaceFile(workspaceRoot, 'memory.md', '# Memory\n\n## User\n- Jörn');

    const mainContext = await loadWorkspaceMdContext({ mode: 'main', workspaceRoot });
    const sharedContext = await loadWorkspaceMdContext({ mode: 'shared', workspaceRoot });

    expect(mainContext.diagnostics.mode).toBe('main');
    expect(sharedContext.diagnostics.mode).toBe('shared');
    expect(mainContext.files.some((file) => file.role === 'Structured Memory')).toBe(true);
    expect(sharedContext.files.some((file) => file.role === 'Structured Memory')).toBe(false);
    expect(mainContext.combined).toContain('# Memory');
    expect(sharedContext.combined).not.toContain('# Memory');
  });

  it('reports missing required workspace files', async () => {
    await writeWorkspaceFile(workspaceRoot, 'AGENTS.md', '# AGENTS');

    const context = await loadWorkspaceMdContext({ mode: 'main', workspaceRoot });

    expect(context.diagnostics.missingFiles).toEqual(
      expect.arrayContaining(['SOUL.md', 'USER.md'])
    );
  });
});
