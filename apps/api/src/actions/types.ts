export type ActionStatus = 'pending' | 'approved' | 'executing' | 'done' | 'failed' | 'rejected';

export interface ActionPreview {
  kind: 'diff';
  path: string;
  diff: string;
}

export interface Action {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  status: ActionStatus;
  createdAt: string;
  preview?: ActionPreview;
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
  preview?: ActionPreview;
}
