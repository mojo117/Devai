import type { Action, ActionStatus, CreateActionParams } from './types.js';
import { executeTool } from '../tools/executor.js';
import { auditLog } from '../audit/logger.js';
import {
  saveAction,
  getActionById,
  getAllActionsFromDb,
  getPendingActionsFromDb,
  updateActionInDb,
  type DbAction,
} from '../db/queries.js';
import { notifyActionPending, notifyActionUpdated } from '../websocket/actionBroadcaster.js';

// In-memory cache for fast access (synced with database)
const actionsCache = new Map<string, Action>();
let cachePromise: Promise<void> | null = null;

// Convert DB action to API action
function dbToAction(db: DbAction): Action {
  return {
    id: db.id,
    toolName: db.tool_name,
    toolArgs: db.tool_args,
    description: db.description,
    status: db.status as ActionStatus,
    createdAt: db.created_at,
    preview: db.preview as unknown as Action['preview'],
    approvedAt: db.approved_at || undefined,
    rejectedAt: db.rejected_at || undefined,
    executedAt: db.executed_at || undefined,
    result: db.result,
    error: db.error || undefined,
  };
}

// Initialize cache from database on first use (Promise pattern prevents race conditions)
async function ensureCache(): Promise<void> {
  if (!cachePromise) {
    cachePromise = (async () => {
      try {
        const dbActions = await getAllActionsFromDb();
        for (const dbAction of dbActions) {
          actionsCache.set(dbAction.id, dbToAction(dbAction));
        }
      } catch (error) {
        console.error('[Action Cache] Failed to initialize from DB:', error);
        // Continue with empty cache - will work in memory-only mode
      }
    })();
  }
  return cachePromise;
}

export async function createAction(params: CreateActionParams): Promise<Action> {
  await ensureCache();

  const action: Action = {
    id: params.id,
    toolName: params.toolName,
    toolArgs: params.toolArgs,
    description: params.description,
    status: 'pending',
    createdAt: new Date().toISOString(),
    preview: params.preview,
  };

  // Save to cache immediately
  actionsCache.set(action.id, action);

  // Persist to database (don't block on this)
  saveAction({
    id: action.id,
    toolName: action.toolName,
    toolArgs: action.toolArgs,
    description: action.description,
    status: action.status,
    preview: action.preview as unknown as Record<string, unknown>,
    createdAt: action.createdAt,
  }).catch((err) => {
    console.error('[Action Persist] Failed to save action:', err);
  });

  // Log the action creation
  auditLog({
    action: 'action.created',
    toolName: action.toolName,
    actionId: action.id,
    args: sanitizeArgs(action.toolArgs),
  });

  // Broadcast via WebSocket
  notifyActionPending(action);

  return action;
}

export async function getAction(id: string): Promise<Action | undefined> {
  await ensureCache();

  // Check cache first
  const cached = actionsCache.get(id);
  if (cached) return cached;

  // Fallback to database
  const dbAction = await getActionById(id);
  if (dbAction) {
    const action = dbToAction(dbAction);
    actionsCache.set(id, action);
    return action;
  }

  return undefined;
}

export async function getAllActions(): Promise<Action[]> {
  await ensureCache();
  return Array.from(actionsCache.values());
}

export async function getPendingActions(): Promise<Action[]> {
  await ensureCache();
  return Array.from(actionsCache.values()).filter((a) => a.status === 'pending');
}

export async function updateActionStatus(id: string, status: ActionStatus): Promise<Action | undefined> {
  await ensureCache();

  const action = actionsCache.get(id);
  if (!action) return undefined;

  action.status = status;

  const updates: Record<string, string> = { status };
  if (status === 'approved') {
    action.approvedAt = new Date().toISOString();
    updates.approvedAt = action.approvedAt;
  } else if (status === 'executing' || status === 'done' || status === 'failed') {
    action.executedAt = new Date().toISOString();
    updates.executedAt = action.executedAt;
  }

  actionsCache.set(id, action);

  // Persist to database
  updateActionInDb(id, updates).catch((err) => {
    console.error('[Action Persist] Failed to update action status:', err);
  });

  return action;
}

export async function rejectAction(id: string): Promise<Action> {
  await ensureCache();

  const action = actionsCache.get(id);

  if (!action) {
    throw new Error('Action not found');
  }

  if (action.status !== 'pending') {
    throw new Error(`Action cannot be rejected (current status: ${action.status})`);
  }

  // Mark as rejected
  action.status = 'rejected';
  action.rejectedAt = new Date().toISOString();
  actionsCache.set(id, action);

  // Persist to database
  updateActionInDb(id, {
    status: 'rejected',
    rejectedAt: action.rejectedAt,
  }).catch((err) => {
    console.error('[Action Persist] Failed to update rejection:', err);
  });

  auditLog({
    action: 'action.rejected',
    toolName: action.toolName,
    actionId: action.id,
  });

  // Broadcast via WebSocket
  notifyActionUpdated(action);

  return action;
}

export async function approveAndExecuteAction(id: string): Promise<Action> {
  await ensureCache();

  const action = actionsCache.get(id);

  if (!action) {
    throw new Error('Action not found');
  }

  if (action.status !== 'pending') {
    throw new Error(`Action cannot be approved (current status: ${action.status})`);
  }

  // Mark as approved
  action.status = 'approved';
  action.approvedAt = new Date().toISOString();
  actionsCache.set(id, action);

  auditLog({
    action: 'action.approved',
    toolName: action.toolName,
    actionId: action.id,
  });

  // Mark as executing
  action.status = 'executing';
  actionsCache.set(id, action);

  // Persist approved status
  updateActionInDb(id, {
    status: 'executing',
    approvedAt: action.approvedAt,
  }).catch((err) => {
    console.error('[Action Persist] Failed to update approval:', err);
  });

  // Execute the tool
  try {
    const result = await executeTool(action.toolName, action.toolArgs, {
      bypassConfirmation: true,
    });

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

  actionsCache.set(id, action);

  // Persist final state
  updateActionInDb(id, {
    status: action.status,
    result: action.result,
    error: action.error,
    executedAt: action.executedAt,
  }).catch((err) => {
    console.error('[Action Persist] Failed to update execution result:', err);
  });

  // Broadcast via WebSocket
  notifyActionUpdated(action);

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

export function clearActionsForTests(): void {
  actionsCache.clear();
  cachePromise = null;
}
