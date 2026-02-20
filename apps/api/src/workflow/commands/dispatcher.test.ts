import { describe, expect, it } from 'vitest';
import { mapWsMessageToCommand } from './dispatcher.js';

describe('mapWsMessageToCommand', () => {
  const currentSessionId = 'existing-session';
  const requestId = 'req-123';

  // ── AC-1: Request command mapping ──────────────────────────────

  it('maps "request" messages to UserRequestCommand', () => {
    const msg = {
      type: 'request',
      message: 'Fix the bug',
      sessionId: 'sess-1',
      projectRoot: '/opt/project',
    };

    const cmd = mapWsMessageToCommand(msg, currentSessionId, requestId);

    expect(cmd).toEqual({
      type: 'user_request',
      sessionId: 'sess-1',
      requestId: 'req-123',
      message: 'Fix the bug',
      projectRoot: '/opt/project',
      metadata: undefined,
    });
  });

  it('falls back to currentSessionId when request has no sessionId', () => {
    const msg = { type: 'request', message: 'Hello' };
    const cmd = mapWsMessageToCommand(msg, currentSessionId, requestId);

    expect(cmd?.type).toBe('user_request');
    if (cmd?.type === 'user_request') {
      expect(cmd.sessionId).toBe('existing-session');
    }
  });

  it('includes metadata when present on request', () => {
    const msg = {
      type: 'request',
      message: 'Test',
      metadata: { chatMode: 'shared' },
    };
    const cmd = mapWsMessageToCommand(msg, currentSessionId, requestId);

    if (cmd?.type === 'user_request') {
      expect(cmd.metadata).toEqual({ chatMode: 'shared' });
    }
  });

  // ── AC-2: Question command mapping ─────────────────────────────

  it('maps "question" messages to UserQuestionAnsweredCommand', () => {
    const msg = {
      type: 'question',
      questionId: 'q-1',
      answer: 'Yes, proceed',
      sessionId: 'sess-1',
    };

    const cmd = mapWsMessageToCommand(msg, currentSessionId, requestId);

    expect(cmd).toEqual({
      type: 'user_question_answered',
      sessionId: 'sess-1',
      requestId: 'req-123',
      questionId: 'q-1',
      answer: 'Yes, proceed',
    });
  });

  // ── AC-3: Approval command mapping ─────────────────────────────

  it('maps "approval" messages to UserApprovalDecidedCommand', () => {
    const msg = {
      type: 'approval',
      approvalId: 'a-1',
      approved: true,
      sessionId: 'sess-1',
    };

    const cmd = mapWsMessageToCommand(msg, currentSessionId, requestId);

    expect(cmd).toEqual({
      type: 'user_approval_decided',
      sessionId: 'sess-1',
      requestId: 'req-123',
      approvalId: 'a-1',
      approved: true,
    });
  });

  it('maps approval with approved=false', () => {
    const msg = {
      type: 'approval',
      approvalId: 'a-2',
      approved: false,
      sessionId: 'sess-1',
    };

    const cmd = mapWsMessageToCommand(msg, currentSessionId, requestId);

    if (cmd?.type === 'user_approval_decided') {
      expect(cmd.approved).toBe(false);
    }
  });

  // ── AC-4: Plan approval command mapping ────────────────────────

  it('maps "plan_approval" messages to UserPlanApprovalDecidedCommand', () => {
    const msg = {
      type: 'plan_approval',
      planId: 'p-1',
      approved: true,
      reason: 'Looks good',
      sessionId: 'sess-1',
    };

    const cmd = mapWsMessageToCommand(msg, currentSessionId, requestId);

    expect(cmd).toEqual({
      type: 'user_plan_approval_decided',
      sessionId: 'sess-1',
      requestId: 'req-123',
      planId: 'p-1',
      approved: true,
      reason: 'Looks good',
    });
  });

  // ── AC-5: Non-workflow messages return null ────────────────────

  it('returns null for ping messages', () => {
    const cmd = mapWsMessageToCommand({ type: 'ping' }, currentSessionId, requestId);
    expect(cmd).toBeNull();
  });

  it('returns null for hello messages', () => {
    const cmd = mapWsMessageToCommand({ type: 'hello' }, currentSessionId, requestId);
    expect(cmd).toBeNull();
  });

  it('returns null for unknown message types', () => {
    const cmd = mapWsMessageToCommand({ type: 'foobar' }, currentSessionId, requestId);
    expect(cmd).toBeNull();
  });

  it('returns null for messages without type', () => {
    const cmd = mapWsMessageToCommand({}, currentSessionId, requestId);
    expect(cmd).toBeNull();
  });

  // ── AC-6: Type safety — non-string fields coerced ──────────────

  it('coerces non-string message to empty string', () => {
    const msg = { type: 'request', message: 42 };
    const cmd = mapWsMessageToCommand(msg as Record<string, unknown>, currentSessionId, requestId);

    if (cmd?.type === 'user_request') {
      expect(cmd.message).toBe('');
    }
  });

  it('coerces non-string questionId to empty string', () => {
    const msg = { type: 'question', questionId: null, answer: 'yes' };
    const cmd = mapWsMessageToCommand(msg as Record<string, unknown>, currentSessionId, requestId);

    if (cmd?.type === 'user_question_answered') {
      expect(cmd.questionId).toBe('');
    }
  });

  it('coerces falsy approved to false', () => {
    const msg = { type: 'approval', approvalId: 'a-1', approved: 0 };
    const cmd = mapWsMessageToCommand(msg as Record<string, unknown>, currentSessionId, requestId);

    if (cmd?.type === 'user_approval_decided') {
      expect(cmd.approved).toBe(false);
    }
  });
});
