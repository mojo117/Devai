/**
 * Command Dispatcher — unified ingress for all WS workflow commands.
 *
 * Thin facade that routes typed commands to dedicated handlers.
 */

import type { WorkflowCommand } from './types.js';
import { createRequestContext } from '../context/requestContext.js';
import { CommandHandlers } from './commandHandlers.js';
import type { DispatchOptions, DispatchResult } from './commandHandlers.js';

const handlers = new CommandHandlers();

export class CommandDispatcher {
  async dispatch(command: WorkflowCommand, opts: DispatchOptions): Promise<DispatchResult> {
    const ctx = createRequestContext(command.sessionId, command.requestId);

    switch (command.type) {
      case 'user_request':
        return handlers.handleRequest(command, ctx, opts);
      case 'user_question_answered':
        return handlers.handleQuestionAnswer(command, ctx, opts);
      case 'user_approval_decided':
        return handlers.handleApproval(command, ctx, opts);
      case 'user_plan_approval_decided':
        return handlers.handlePlanApproval(command, ctx, opts);
    }
  }
}

/** Singleton command dispatcher. */
export const commandDispatcher = new CommandDispatcher();

/**
 * Maps a raw WS message to a typed WorkflowCommand.
 * Returns null for non-workflow messages (ping, hello, etc.).
 */
export function mapWsMessageToCommand(
  msg: Record<string, unknown>,
  currentSessionId: string | null,
  requestId: string,
): WorkflowCommand | null {
  const msgType = msg?.type;

  if (msgType === 'request') {
    const userMeta = (msg.metadata && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata))
      ? msg.metadata as Record<string, unknown>
      : {};
    return {
      type: 'user_request',
      sessionId: (typeof msg.sessionId === 'string' ? msg.sessionId : currentSessionId) || '',
      requestId,
      message: typeof msg.message === 'string' ? msg.message : '',
      projectRoot: typeof msg.projectRoot === 'string' ? msg.projectRoot : undefined,
      metadata: { platform: 'web', ...userMeta },
      pinnedUserfileIds: Array.isArray(msg.pinnedUserfileIds)
        ? (msg.pinnedUserfileIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : undefined,
    };
  }

  if (msgType === 'question') {
    return {
      type: 'user_question_answered',
      sessionId: (typeof msg.sessionId === 'string' ? msg.sessionId : currentSessionId) || '',
      requestId,
      questionId: typeof msg.questionId === 'string' ? msg.questionId : '',
      answer: typeof msg.answer === 'string' ? msg.answer : '',
    };
  }

  if (msgType === 'approval') {
    return {
      type: 'user_approval_decided',
      sessionId: (typeof msg.sessionId === 'string' ? msg.sessionId : currentSessionId) || '',
      requestId,
      approvalId: typeof msg.approvalId === 'string' ? msg.approvalId : '',
      approved: Boolean(msg.approved),
    };
  }

  if (msgType === 'plan_approval') {
    return {
      type: 'user_plan_approval_decided',
      sessionId: (typeof msg.sessionId === 'string' ? msg.sessionId : currentSessionId) || '',
      requestId,
      planId: typeof msg.planId === 'string' ? msg.planId : '',
      approved: Boolean(msg.approved),
      reason: typeof msg.reason === 'string' ? msg.reason : undefined,
    };
  }

  return null;
}

export type { DispatchOptions, DispatchResult } from './commandHandlers.js';
