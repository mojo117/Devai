import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeToolWithApprovalBridge } from './approvalBridge.js';
import { checkPermission } from '../permissions/checker.js';
import { buildActionPreview } from './preview.js';
import { createAction } from './manager.js';
import { executeTool } from '../tools/executor.js';

vi.mock('../permissions/checker.js', () => ({
  checkPermission: vi.fn(),
}));

vi.mock('./preview.js', () => ({
  buildActionPreview: vi.fn(),
}));

vi.mock('./manager.js', () => ({
  createAction: vi.fn(),
}));

vi.mock('../tools/executor.js', () => ({
  executeTool: vi.fn(),
}));

describe('approvalBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes non-confirmation tool directly', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({
      allowed: true,
      requiresConfirmation: false,
      reason: 'Tool does not require confirmation',
    });
    vi.mocked(executeTool).mockResolvedValueOnce({
      success: true,
      result: { files: [] },
    });

    const result = await executeToolWithApprovalBridge('fs_listFiles', { path: '.' });

    expect(executeTool).toHaveBeenCalledWith('fs_listFiles', { path: '.' });
    expect(result.success).toBe(true);
    expect(result.pendingApproval).toBeUndefined();
  });

  it('creates pending action when confirmation is required', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({
      allowed: true,
      requiresConfirmation: true,
      reason: 'No matching permission pattern',
    });
    vi.mocked(buildActionPreview).mockResolvedValueOnce({
      kind: 'summary',
      path: 'notes.txt',
      summary: 'Will write 5 lines',
    });

    const action = {
      id: 'action-1',
      toolName: 'fs_writeFile',
      toolArgs: { path: 'notes.txt', content: 'hello' },
      description: 'Write to file: notes.txt',
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      preview: {
        kind: 'summary' as const,
        path: 'notes.txt',
        summary: 'Will write 5 lines',
      },
    };
    vi.mocked(createAction).mockResolvedValueOnce(action);

    const onActionPending = vi.fn();
    const result = await executeToolWithApprovalBridge(
      'fs_writeFile',
      { path: 'notes.txt', content: 'hello' },
      { onActionPending }
    );

    expect(createAction).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'fs_writeFile',
      toolArgs: { path: 'notes.txt', content: 'hello' },
    }));
    expect(onActionPending).toHaveBeenCalledWith(action);
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.pendingApproval).toBe(true);
    expect(result.actionId).toBe('action-1');
  });

  it('uses bypass for allow-pattern-approved risky tools', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({
      allowed: true,
      requiresConfirmation: false,
      reason: 'Matched permission pattern: allow fs writes in docs',
      matchedPattern: {
        id: 'p1',
        toolName: 'fs_writeFile',
        argPattern: 'docs/*',
        granted: true,
        createdAt: new Date().toISOString(),
      },
    });
    vi.mocked(executeTool).mockResolvedValueOnce({
      success: true,
      result: { ok: true },
    });

    const result = await executeToolWithApprovalBridge('fs_writeFile', {
      path: 'docs/notes.txt',
      content: 'allowed',
    });

    expect(executeTool).toHaveBeenCalledWith(
      'fs_writeFile',
      { path: 'docs/notes.txt', content: 'allowed' },
      { bypassConfirmation: true }
    );
    expect(result.success).toBe(true);
  });

  it('blocks denied tools from permission patterns', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce({
      allowed: false,
      requiresConfirmation: true,
      reason: 'Denied by pattern: deny dangerous writes',
      matchedPattern: {
        id: 'p2',
        toolName: 'fs_writeFile',
        argPattern: '*',
        granted: false,
        createdAt: new Date().toISOString(),
      },
    });

    const result = await executeToolWithApprovalBridge('fs_writeFile', {
      path: 'secret.txt',
      content: 'blocked',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Denied by pattern');
    expect(createAction).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
  });
});
