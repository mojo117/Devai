import { describe, expect, it, vi, beforeEach } from 'vitest';
import { matchHooks, getHooksForSession, clearHookCache, type HookRule } from './hookConfig.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'fs/promises';

const mockedReadFile = vi.mocked(readFile);

const rules: HookRule[] = [
  { event: 'after:tool', toolMatch: 'fs_*', command: 'prettier --write $HOOK_FILE_PATH', timeout: 5000 },
  { event: 'after:tool', command: 'echo "done"', timeout: 5000 },
  { event: 'before:tool', toolMatch: 'bash_execute', command: 'echo "audit"', blocking: true, timeout: 5000 },
  { event: 'after:tool:error', toolMatch: 'git_*', command: 'notify', timeout: 5000 },
];

describe('matchHooks', () => {
  it('matches glob prefix patterns', () => {
    const matched = matchHooks(rules, 'after:tool', 'fs_writeFile');
    expect(matched).toHaveLength(2); // fs_* + no-filter rule
  });

  it('matches exact tool names', () => {
    const matched = matchHooks(rules, 'before:tool', 'bash_execute');
    expect(matched).toHaveLength(1);
    expect(matched[0].blocking).toBe(true);
  });

  it('returns no-filter hooks for any tool', () => {
    const matched = matchHooks(rules, 'after:tool', 'web_search');
    expect(matched).toHaveLength(1); // only the no-filter rule
  });

  it('returns empty for non-matching events', () => {
    const matched = matchHooks(rules, 'on:answer', 'fs_writeFile');
    expect(matched).toHaveLength(0);
  });

  it('returns empty when no rules exist', () => {
    const matched = matchHooks([], 'after:tool', 'fs_writeFile');
    expect(matched).toHaveLength(0);
  });
});

describe('getHooksForSession', () => {
  beforeEach(() => {
    clearHookCache();
    vi.restoreAllMocks();
  });

  it('returns empty array when no hooks file exists', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));
    const result = await getHooksForSession('/tmp/project');
    expect(result).toEqual([]);
  });

  it('loads and parses valid hooks.json', async () => {
    const config = {
      version: 1,
      hooks: [
        { event: 'after:tool', command: 'echo ok', timeout: 5000 },
      ],
    };
    mockedReadFile.mockResolvedValue(JSON.stringify(config));

    const result = await getHooksForSession('/tmp/project');
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe('echo ok');
    expect(result[0].timeout).toBe(5000);
  });

  it('caches results within TTL', async () => {
    const config = {
      version: 1,
      hooks: [{ event: 'after:tool', command: 'echo cached' }],
    };
    mockedReadFile.mockResolvedValue(JSON.stringify(config));

    const first = await getHooksForSession('/tmp/cache-test');
    const second = await getHooksForSession('/tmp/cache-test');

    expect(first).toBe(second); // same reference = cache hit
    expect(mockedReadFile).toHaveBeenCalledTimes(1);
  });

  it('skips invalid version numbers', async () => {
    const config = { version: 99, hooks: [{ event: 'after:tool', command: 'echo bad' }] };
    mockedReadFile.mockResolvedValue(JSON.stringify(config));

    const result = await getHooksForSession('/tmp/bad-version');
    expect(result).toEqual([]);
  });

  it('handles malformed JSON gracefully', async () => {
    mockedReadFile.mockResolvedValue('{ not valid json !!!');

    const result = await getHooksForSession('/tmp/bad-json');
    expect(result).toEqual([]);
  });

  it('clamps timeout to MAX_HOOK_TIMEOUT (30s)', async () => {
    const config = {
      version: 1,
      hooks: [{ event: 'before:tool', command: 'echo slow', timeout: 999_999 }],
    };
    mockedReadFile.mockResolvedValue(JSON.stringify(config));

    const result = await getHooksForSession('/tmp/timeout-test');
    expect(result).toHaveLength(1);
    expect(result[0].timeout).toBe(30_000);
  });

  it('filters out entries missing event or command', async () => {
    const config = {
      version: 1,
      hooks: [
        { event: 'after:tool', command: 'echo valid' },
        { event: 'after:tool' },                       // missing command
        { command: 'echo no-event' },                   // missing event
        null,                                           // null entry
        { event: 123, command: 'echo bad-type' },       // event not a string
      ],
    };
    mockedReadFile.mockResolvedValue(JSON.stringify(config));

    const result = await getHooksForSession('/tmp/filter-test');
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe('echo valid');
  });

  it('skips config where hooks is not an array', async () => {
    const config = { version: 1, hooks: 'not-an-array' };
    mockedReadFile.mockResolvedValue(JSON.stringify(config));

    const result = await getHooksForSession('/tmp/not-array');
    expect(result).toEqual([]);
  });
});
