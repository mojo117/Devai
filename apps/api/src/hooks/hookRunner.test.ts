import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./hookConfig.js', () => ({
  getHooksForSession: vi.fn(),
  matchHooks: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { runHooks } from './hookRunner.js';
import { getHooksForSession, matchHooks } from './hookConfig.js';
import { exec } from 'child_process';

describe('runHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns immediately when no hooks match', async () => {
    vi.mocked(getHooksForSession).mockResolvedValueOnce([]);
    vi.mocked(matchHooks).mockReturnValueOnce([]);

    const result = await runHooks('after:tool', { toolName: 'fs_writeFile', projectRoot: null });
    expect(result.blocked).toBe(false);
    expect(result.executedCount).toBe(0);
  });

  it('executes matching hooks and counts them', async () => {
    const rules = [{ event: 'after:tool' as const, command: 'echo ok', timeout: 5000 }];
    vi.mocked(getHooksForSession).mockResolvedValueOnce(rules);
    vi.mocked(matchHooks).mockReturnValueOnce(rules);
    vi.mocked(exec).mockImplementation((_cmd: any, _opts: any, cb: any) => {
      cb(null, 'ok', '');
      return {} as any;
    });

    const result = await runHooks('after:tool', { toolName: 'fs_writeFile', projectRoot: '/tmp' });
    expect(result.blocked).toBe(false);
    expect(result.executedCount).toBe(1);
  });

  it('blocks on blocking before:tool hook failure', async () => {
    const rules = [{ event: 'before:tool' as const, command: 'exit 1', timeout: 5000, blocking: true }];
    vi.mocked(getHooksForSession).mockResolvedValueOnce(rules);
    vi.mocked(matchHooks).mockReturnValueOnce(rules);
    vi.mocked(exec).mockImplementation((_cmd: any, _opts: any, cb: any) => {
      cb(new Error('hook failed'), '', 'error');
      return {} as any;
    });

    const result = await runHooks('before:tool', { toolName: 'bash_execute', projectRoot: '/tmp' });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('hook failed');
  });

  it('does not block on non-blocking hook failure', async () => {
    const rules = [{ event: 'after:tool' as const, command: 'exit 1', timeout: 5000 }];
    vi.mocked(getHooksForSession).mockResolvedValueOnce(rules);
    vi.mocked(matchHooks).mockReturnValueOnce(rules);
    vi.mocked(exec).mockImplementation((_cmd: any, _opts: any, cb: any) => {
      cb(new Error('hook failed'), '', 'error');
      return {} as any;
    });

    const result = await runHooks('after:tool', { toolName: 'fs_writeFile', projectRoot: '/tmp' });
    expect(result.blocked).toBe(false);
  });
});
