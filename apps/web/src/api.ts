import type {
  ChatMessage,
  LLMProvider,
  Action,
  HealthResponse,
  SkillsResponse,
  ProjectResponse,
  ProjectFilesResponse,
  SessionsResponse,
  SessionMessagesResponse,
  SettingResponse,
} from './types';

const API_BASE = '/api';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Failed to fetch health');
  return res.json();
}

export interface ChatStreamEvent {
  type: string;
  [key: string]: unknown;
}

export async function sendMessage(
  messages: ChatMessage[],
  provider: LLMProvider,
  projectRoot?: string,
  skillIds?: string[],
  sessionId?: string,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<{ message: ChatMessage; pendingActions: Action[]; sessionId?: string }> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, provider, projectRoot, skillIds, sessionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to send message');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/x-ndjson')) {
    return res.json();
  }

  if (!res.body) {
    throw new Error('Missing response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: { message: ChatMessage; pendingActions: Action[]; sessionId?: string } | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type?: string; response?: unknown };
      if (onEvent) {
        onEvent(event as ChatStreamEvent);
      }
      if (event.type === 'response') {
        finalResponse = event.response as {
          message: ChatMessage;
          pendingActions: Action[];
          sessionId?: string;
        };
      }
    }
  }

  if (!finalResponse) {
    throw new Error('No response received from server');
  }

  return finalResponse;
}

export async function fetchSkills(): Promise<SkillsResponse> {
  const res = await fetch(`${API_BASE}/skills`);
  if (!res.ok) throw new Error('Failed to fetch skills');
  return res.json();
}

export async function reloadSkills(): Promise<SkillsResponse> {
  const res = await fetch(`${API_BASE}/skills/reload`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reload skills');
  return res.json();
}

export async function fetchProject(): Promise<ProjectResponse> {
  const res = await fetch(`${API_BASE}/project`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to fetch project' }));
    throw new Error(error.error || 'Failed to fetch project');
  }
  return res.json();
}

export async function refreshProject(): Promise<ProjectResponse> {
  const res = await fetch(`${API_BASE}/project/refresh`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to refresh project' }));
    throw new Error(error.error || 'Failed to refresh project');
  }
  return res.json();
}

export async function listProjectFiles(path: string): Promise<ProjectFilesResponse> {
  const params = new URLSearchParams({ path });
  const res = await fetch(`${API_BASE}/project/files?${params.toString()}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to list files' }));
    throw new Error(error.error || 'Failed to list files');
  }
  return res.json();
}

export async function fetchSessions(): Promise<SessionsResponse> {
  const res = await fetch(`${API_BASE}/sessions`);
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

export async function createSession(title?: string): Promise<{ session: { id: string } }> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to create session');
  return res.json();
}

export async function fetchSessionMessages(sessionId: string): Promise<SessionMessagesResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`);
  if (!res.ok) throw new Error('Failed to fetch session messages');
  return res.json();
}

export async function fetchSetting(key: string): Promise<SettingResponse> {
  const res = await fetch(`${API_BASE}/settings/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('Failed to fetch setting');
  return res.json();
}

export async function saveSetting(key: string, value: unknown): Promise<SettingResponse> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error('Failed to save setting');
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
