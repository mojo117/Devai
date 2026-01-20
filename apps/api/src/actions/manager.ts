import type { Action, ActionStatus, CreateActionParams } from './types.js';
import { executeTool } from '../tools/executor.js';
import { auditLog } from '../audit/logger.js';

// In-memory action store
const actions = new Map<string, Action>();

export function createAction(params: CreateActionParams): Action {
  const action: Action = {
    id: params.id,
    toolName: params.toolName,
    toolArgs: params.toolArgs,
    description: params.description,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  actions.set(action.id, action);

  // Log the action creation
  auditLog({
    action: 'action.created',
    toolName: action.toolName,
    actionId: action.id,
    args: sanitizeArgs(action.toolArgs),
  });

  return action;
}

export function getAction(id: string): Action | undefined {
  return actions.get(id);
}

export function getAllActions(): Action[] {
  return Array.from(actions.values());
}

export function getPendingActions(): Action[] {
  return Array.from(actions.values()).filter((a) => a.status === 'pending');
}

export function updateActionStatus(id: string, status: ActionStatus): Action | undefined {
  const action = actions.get(id);
  if (!action) return undefined;

  action.status = status;

  if (status === 'approved') {
    action.approvedAt = new Date().toISOString();
  } else if (status === 'executing' || status === 'done' || status === 'failed') {
    action.executedAt = new Date().toISOString();
  }

  actions.set(id, action);
  return action;
}

export async function rejectAction(id: string): Promise<Action> {
  const action = actions.get(id);

  if (!action) {
    throw new Error('Action not found');
  }

  if (action.status !== 'pending') {
    throw new Error(`Action cannot be rejected (current status: ${action.status})`);
  }

  // Mark as rejected
  action.status = 'rejected';
  action.rejectedAt = new Date().toISOString();
  actions.set(id, action);

  auditLog({
    action: 'action.rejected',
    toolName: action.toolName,
    actionId: action.id,
  });

  return action;
}

export async function approveAndExecuteAction(id: string): Promise<Action> {
  const action = actions.get(id);

  if (!action) {
    throw new Error('Action not found');
  }

  if (action.status !== 'pending') {
    throw new Error(`Action cannot be approved (current status: ${action.status})`);
  }

  // Mark as approved
  action.status = 'approved';
  action.approvedAt = new Date().toISOString();
  actions.set(id, action);

  auditLog({
    action: 'action.approved',
    toolName: action.toolName,
    actionId: action.id,
  });

  // Mark as executing
  action.status = 'executing';
  actions.set(id, action);

  // Execute the tool
  try {
    const result = await executeTool(action.toolName, action.toolArgs);

    if (result.success) {
      action.status = 'done';
      action.result = result.result;
      action.executedAt = new Date().toISOString();

      auditLog({
        action: 'action.executed',
        toolName: action.toolName,
        actionId: action.id,
        success: true,
        resultSummary: summarizeResult(result.result),
      });
    } else {
      action.status = 'failed';
      action.error = result.error;
      action.executedAt = new Date().toISOString();

      auditLog({
        action: 'action.failed',
        toolName: action.toolName,
        actionId: action.id,
        error: result.error,
      });
    }
  } catch (error) {
    action.status = 'failed';
    action.error = error instanceof Error ? error.message : 'Unknown error';
    action.executedAt = new Date().toISOString();

    auditLog({
      action: 'action.failed',
      toolName: action.toolName,
      actionId: action.id,
      error: action.error,
    });
  }

  actions.set(id, action);
  return action;
}

// Remove sensitive data from args before logging
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    // Skip content for file writes (could be large and contain sensitive data)
    if (key === 'content' && typeof value === 'string') {
      sanitized[key] = `[${value.length} chars]`;
    } else if (typeof value === 'string' && value.length > 200) {
      sanitized[key] = value.substring(0, 200) + '...';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// Summarize result for audit log (avoid logging sensitive data)
function summarizeResult(result: unknown): string {
  if (result === null || result === undefined) {
    return 'null';
  }

  if (typeof result === 'string') {
    return result.length > 100 ? result.substring(0, 100) + '...' : result;
  }

  if (typeof result === 'object') {
    const keys = Object.keys(result);
    return `{${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''}}`;
  }

  return String(result);
}

// Clear old actions (optional cleanup)
export function clearOldActions(maxAge: number = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAge;
  let cleared = 0;

  for (const [id, action] of actions.entries()) {
    const createdAt = new Date(action.createdAt).getTime();
    if (createdAt < cutoff && action.status !== 'pending') {
      actions.delete(id);
      cleared++;
    }
  }

  return cleared;
}
