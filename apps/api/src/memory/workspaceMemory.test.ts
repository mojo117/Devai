import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  rememberNote,
  searchWorkspaceMemory,
  readDailyMemory,
} from './workspaceMemory.js';

describe('workspaceMemory', () => {
  const originalWorkspacePath = process.env.DEVAI_WORKSPACE_PATH;
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'devai-memory-'));
    process.env.DEVAI_WORKSPACE_PATH = workspaceRoot;
  });

  afterEach(() => {
    if (originalWorkspacePath === undefined) {
      delete process.env.DEVAI_WORKSPACE_PATH;
    } else {
      process.env.DEVAI_WORKSPACE_PATH = originalWorkspacePath;
    }
  });

  it('writes explicit memory notes into daily memory file', async () => {
    const result = await rememberNote('Server runs on Clawd and OpenClaw in parallel.', {
      sessionId: 's-memory-1',
      source: 'test',
    });

    const fileContent = await readFile(result.daily.filePath, 'utf-8');
    expect(fileContent).toContain('Server runs on Clawd and OpenClaw in parallel.');
    expect(fileContent).toContain('session: s-memory-1');
  });

  it('can search daily memory entries', async () => {
    await rememberNote('Persistent memory should survive restarts.', {
      sessionId: 's-memory-2',
      source: 'test',
    });

    const found = await searchWorkspaceMemory('survive restarts');
    expect(found.hits.length).toBeGreaterThan(0);
    expect(found.hits[0].snippet.toLowerCase()).toContain('survive restarts');
  });

  it('returns empty content for missing daily file', async () => {
    const daily = await readDailyMemory('2030-01-01');
    expect(daily.content).toBe('');
    expect(daily.filePath).toContain('2030-01-01.md');
  });
});
