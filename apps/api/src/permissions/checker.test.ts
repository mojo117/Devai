import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPermission } from './checker.js';
import { getSetting, getTrustMode } from '../db/queries.js';
import { getToolDefinition } from '../tools/registry.js';

vi.mock('../db/queries.js', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getTrustMode: vi.fn(),
}));

vi.mock('../tools/registry.js', () => ({
  getToolDefinition: vi.fn(),
}));

describe('permission checker trust mode behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getToolDefinition).mockReturnValue({
      name: 'fs_writeFile',
      description: 'write',
      inputSchema: { type: 'object', properties: {} },
      requiresConfirmation: true,
    } as any);
  });

  it('skips confirmation in trusted mode when no pattern exists', async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null);
    vi.mocked(getTrustMode).mockResolvedValueOnce('trusted');

    const result = await checkPermission('fs_writeFile', { path: 'notes.txt' });

    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.reason).toContain('trust mode: trusted');
  });

  it('keeps confirmation in default mode when no pattern exists', async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(null);
    vi.mocked(getTrustMode).mockResolvedValueOnce('default');

    const result = await checkPermission('fs_writeFile', { path: 'notes.txt' });

    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.reason).toContain('trust mode: default');
  });

  it('denied pattern still blocks in trusted mode', async () => {
    vi.mocked(getSetting).mockResolvedValueOnce(JSON.stringify([
      {
        id: 'deny-1',
        toolName: 'fs_writeFile',
        argPattern: '*',
        granted: false,
        createdAt: new Date().toISOString(),
      },
    ]));
    vi.mocked(getTrustMode).mockResolvedValueOnce('trusted');

    const result = await checkPermission('fs_writeFile', { path: 'notes.txt' });

    expect(result.allowed).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.reason).toContain('Denied by pattern');
  });
});
