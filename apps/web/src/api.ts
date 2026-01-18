import type { ChatMessage, LLMProvider, Action, HealthResponse } from './types';

const API_BASE = '/api';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Failed to fetch health');
  return res.json();
}

export async function sendMessage(
  messages: ChatMessage[],
  provider: LLMProvider,
  projectRoot?: string
): Promise<{ message: ChatMessage; pendingActions: Action[] }> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, provider, projectRoot }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to send message');
  }

  return res.json();
}

export async function fetchActions(): Promise<{ actions: Action[] }> {
  const res = await fetch(`${API_BASE}/actions`);
  if (!res.ok) throw new Error('Failed to fetch actions');
  return res.json();
}

export async function approveAction(actionId: string): Promise<{ action: Action; result?: unknown }> {
  const res = await fetch(`${API_BASE}/actions/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to approve action');
  }

  return res.json();
}
