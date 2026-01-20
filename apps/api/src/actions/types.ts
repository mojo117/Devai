export type ActionStatus = 'pending' | 'approved' | 'executing' | 'done' | 'failed' | 'rejected';

export interface Action {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  status: ActionStatus;
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  executedAt?: string;
  result?: unknown;
  error?: string;
}

export interface CreateActionParams {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
}
