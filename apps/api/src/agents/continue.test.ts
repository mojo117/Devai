import { describe, expect, it, vi, beforeEach } from 'vitest';

// Force router to use the new capability-based router for these tests.
process.env.USE_NEW_AGENT_ROUTER = 'true';

// Mock DB layer used by state persistence so tests don't require Supabase.
vi.mock('../db/queries.js', () => {
  return {
    getAgentState: vi.fn().mockResolvedValue(null),
    upsertAgentState: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('./analyzer/index.js', () => ({
  analyzeRequest: vi.fn().mockResolvedValue({
    analysis: {
      needs: {
        web_search: false,
        code_read: true,
        code_write: false,
        devops: false,
        clarification: false,
      },
      tasks: [{ description: 'do thing', capability: 'code_read' }],
      confidence: 'high',
    },
    rawResponse: '',
    model: 'test',
    durationMs: 0,
  }),
}));

vi.mock('./deterministicRouter/index.js', () => ({
  routeAnalysis: vi.fn().mockReturnValue({
    type: 'execute',
    tasks: [
      {
        index: 0,
        agent: 'koda',
        description: 'do thing',
        capability: 'code_read',
      },
    ],
  }),
}));

const executeAgentTaskMock = vi.fn();
vi.mock('./executor.js', () => ({
  executeAgentTask: executeAgentTaskMock,
}));

vi.mock('./synthesizer/index.js', () => ({
  synthesizeResponse: vi.fn().mockResolvedValue('SYNTH'),
}));

describe('continue flow', () => {
  beforeEach(async () => {
    vi.resetModules();
    executeAgentTaskMock.mockReset();
    const stateManager = await import('./stateManager.js');
    stateManager.deleteState('s1');
    stateManager.deleteState('s2');
  });

  it('new router budget hit emits approval_request (continue gate)', async () => {
    executeAgentTaskMock.mockResolvedValue({
      success: false,
      uncertain: true,
      uncertaintyReason: 'The task required more steps than allowed. Should I continue?',
      budgetHit: { type: 'turns', limit: 20, used: 20 },
    });

    const { processRequestNew } = await import('./newRouter.js');
    const stateManager = await import('./stateManager.js');

    const events: any[] = [];
    const sendEvent = (e: any) => events.push(e);

    const answer = await processRequestNew({
      sessionId: 's1',
      userMessage: 'do something',
      projectRoot: null,
      sendEvent,
      conversationHistory: [],
    });

    expect(typeof answer).toBe('string');
    expect(events.some((e) => e.type === 'approval_request')).toBe(true);

    const state = stateManager.getState('s1');
    expect(state?.pendingApprovals.length).toBe(1);
    expect(state?.pendingApprovals[0]?.context).toMatchObject({ kind: 'new_router_continue' });
  });

  it('typing yes while an approval is pending triggers approval handler and continues original request', async () => {
    executeAgentTaskMock.mockResolvedValue({
      success: true,
      data: 'OK',
    });

    const stateManager = await import('./stateManager.js');
    const { processRequest } = await import('./router.js');

    await stateManager.ensureStateLoaded('s2');
    stateManager.setOriginalRequest('s2', 'original request');
    stateManager.addPendingApproval('s2', {
      approvalId: 'a1',
      description: 'continue?',
      riskLevel: 'low',
      actions: [],
      fromAgent: 'chapo',
      timestamp: new Date().toISOString(),
      context: { kind: 'new_router_continue', maxTurns: 40 },
    });

    const result = await processRequest('s2', 'yes', [], null, (() => {}) as any);
    expect(result).toBe('SYNTH');

    const state = stateManager.getState('s2');
    expect(state?.pendingApprovals.length).toBe(0);
    // Override is one-shot and consumed by the next new-router run.
    expect(executeAgentTaskMock).toHaveBeenCalled();
    const call = executeAgentTaskMock.mock.calls[0];
    const options = call?.[2] as { maxTurns?: number } | undefined;
    expect(options?.maxTurns).toBe(40);
  });
});
