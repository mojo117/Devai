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

export interface ApproveRequest {
  actionId: string;
}

export interface ApproveResponse {
  action: Action;
  result?: unknown;
  error?: string;
}

export interface RejectRequest {
  actionId: string;
}

export interface RejectResponse {
  action: Action;
}
