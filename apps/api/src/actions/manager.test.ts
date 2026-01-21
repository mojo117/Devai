import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveAndExecuteAction,
  clearActionsForTests,
  createAction,
  getAction,
  rejectAction,
} from './manager.js';
import { executeTool } from '../tools/executor.js';

vi.mock('../tools/executor.js', () => ({
  executeTool: vi.fn(),
}));

vi.mock('../audit/logger.js', () => ({
  auditLog: vi.fn(),
}));

describe('actions manager', () => {
  beforeEach(() => {
    clearActionsForTests();
    vi.clearAllMocks();
  });

  it('approves and executes actions successfully', async () => {
    vi.mocked(executeTool).mockResolvedValueOnce({
      success: true,
      result: { ok: true },
    });

    const action = createAction({
      id: 'action-1',
      toolName: 'fs.listFiles',
      toolArgs: { path: '.' },
      description: 'List files',
    });

    const executed = await approveAndExecuteAction(action.id);
    const stored = getAction(action.id);

    expect(executed.status).toBe('done');
    expect(executed.result).toEqual({ ok: true });
    expect(stored?.status).toBe('done');
  });

  it('marks action as failed when tool execution fails', async () => {
    vi.mocked(executeTool).mockResolvedValueOnce({
      success: false,
      error: 'boom',
    });

    const action = createAction({
      id: 'action-2',
      toolName: 'fs.readFile',
      toolArgs: { path: 'README.md' },
      description: 'Read file',
    });

    const executed = await approveAndExecuteAction(action.id);

    expect(executed.status).toBe('failed');
    expect(executed.error).toBe('boom');
  });

  it('rejects pending actions', async () => {
    const action = createAction({
      id: 'action-3',
      toolName: 'git.status',
      toolArgs: {},
      description: 'Status',
    });

    const rejected = await rejectAction(action.id);

    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectedAt).toBeTruthy();
  });
});
