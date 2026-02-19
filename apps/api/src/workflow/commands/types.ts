/**
 * Workflow Commands — typed union for all incoming user actions.
 *
 * Commands are NOT domain events. They represent user intent
 * arriving via WebSocket. The workflow engine processes them
 * and emits domain events.
 */

export type WorkflowCommand =
  | UserRequestCommand
  | UserQuestionAnsweredCommand
  | UserApprovalDecidedCommand
  | UserPlanApprovalDecidedCommand;

export interface UserRequestCommand {
  type: 'user_request';
  sessionId: string;
  requestId: string;
  message: string;
  projectRoot?: string;
  metadata?: Record<string, unknown>;
}

export interface UserQuestionAnsweredCommand {
  type: 'user_question_answered';
  sessionId: string;
  requestId: string;
  questionId: string;
  answer: string;
}

export interface UserApprovalDecidedCommand {
  type: 'user_approval_decided';
  sessionId: string;
  requestId: string;
  approvalId: string;
  approved: boolean;
}

export interface UserPlanApprovalDecidedCommand {
  type: 'user_plan_approval_decided';
  sessionId: string;
  requestId: string;
  planId: string;
  approved: boolean;
  reason?: string;
}
