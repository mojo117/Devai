import { describe, expect, it } from 'vitest';
import { executeTool } from './executor.js';

describe('executeTool confirmation gate', () => {
  it('blocks confirmation-required tools without explicit bypass', async () => {
    const result = await executeTool('fs_writeFile', {
      path: 'notes.txt',
      content: 'hello',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires user confirmation before execution');
  });

  it('also blocks legacy dotted tool names', async () => {
    const result = await executeTool('fs.writeFile', {
      path: 'notes.txt',
      content: 'hello',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires user confirmation before execution');
  });

  it('blocks devo_exec_session_start without explicit bypass', async () => {
    const result = await executeTool('devo_exec_session_start', {
      command: 'npm test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires user confirmation before execution');
  });
});
