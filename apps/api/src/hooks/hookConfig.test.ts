import { describe, expect, it } from 'vitest';
import { matchHooks, type HookRule } from './hookConfig.js';

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
