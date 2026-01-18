export type ActionStatus = 'pending' | 'approved' | 'executing' | 'done' | 'failed';

export interface Action {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  description: string;
  status: ActionStatus;
  createdAt: string;
  approvedAt?: string;
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
