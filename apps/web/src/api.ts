import type {
  ChatMessage,
  LLMProvider,
  Action,
  HealthResponse,
  SkillsResponse,
  ProjectResponse,
  ProjectFilesResponse,
  ProjectFileResponse,
  ProjectSearchResponse,
  ProjectGlobResponse,
  SessionsResponse,
  SessionMessagesResponse,
  SettingResponse,
} from './types';

const API_BASE = '/api';
const TOKEN_KEY = 'devai_auth_token';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function withAuthHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const token = getAuthToken();
  if (!token) return headers;
  return { ...headers, Authorization: `Bearer ${token}` };
}

export async function login(username: string, password: string): Promise<{ token: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Login failed');
  }

  const data = await res.json();
  return { token: data.token };
}

export async function verifyAuth(): Promise<boolean> {
  const token = getAuthToken();
  if (!token) return false;

  const res = await fetch(`${API_BASE}/auth/verify`, {
    headers: withAuthHeaders(),
  });

  return res.ok;
}

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
  pinnedFiles?: string[],
  projectContextOverride?: { enabled: boolean; summary: string },
  sessionId?: string,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<{ message: ChatMessage; pendingActions: Action[]; sessionId?: string; contextStats?: { tokensUsed: number; tokenBudget: number; note?: string } }> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ messages, provider, projectRoot, skillIds, pinnedFiles, projectContextOverride, sessionId }),
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
  let finalResponse: { message: ChatMessage; pendingActions: Action[]; sessionId?: string; contextStats?: { tokensUsed: number; tokenBudget: number; note?: string } } | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
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
      } catch (e) {
        console.warn('Failed to parse NDJSON line:', line, e);
      }
    }
  }

  // Process any remaining buffer content after stream ends
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer) as { type?: string; response?: unknown };
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
    } catch (e) {
      console.warn('Failed to parse final NDJSON buffer:', buffer, e);
    }
  }

  if (!finalResponse) {
    throw new Error('No response received from server');
  }

  return finalResponse;
}

export async function fetchSkills(): Promise<SkillsResponse> {
  const res = await fetch(`${API_BASE}/skills`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch skills');
  return res.json();
}

export async function reloadSkills(): Promise<SkillsResponse> {
  const res = await fetch(`${API_BASE}/skills/reload`, {
    method: 'POST',
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to reload skills');
  return res.json();
}

export async function fetchProject(projectPath: string): Promise<ProjectResponse> {
  const params = new URLSearchParams({ path: projectPath });
  const res = await fetch(`${API_BASE}/project?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to fetch project' }));
    throw new Error(error.error || 'Failed to fetch project');
  }
  return res.json();
}

export async function refreshProject(projectPath: string): Promise<ProjectResponse> {
  const params = new URLSearchParams({ path: projectPath });
  const res = await fetch(`${API_BASE}/project/refresh?${params.toString()}`, {
    method: 'POST',
    headers: withAuthHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to refresh project' }));
    throw new Error(error.error || 'Failed to refresh project');
  }
  return res.json();
}

export async function listProjectFiles(path: string, ignore?: string[]): Promise<ProjectFilesResponse> {
  const params = new URLSearchParams({ path });
  if (ignore && ignore.length > 0) {
    params.set('ignore', ignore.join(','));
  }
  const res = await fetch(`${API_BASE}/project/files?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to list files' }));
    throw new Error(error.error || 'Failed to list files');
  }
  return res.json();
}

export async function readProjectFile(path: string): Promise<ProjectFileResponse> {
  const params = new URLSearchParams({ path });
  const res = await fetch(`${API_BASE}/project/file?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to read file' }));
    throw new Error(error.error || 'Failed to read file');
  }
  return res.json();
}

export async function searchProjectFiles(
  pattern: string,
  path: string,
  glob?: string,
  ignore?: string[]
): Promise<ProjectSearchResponse> {
  const params = new URLSearchParams({ pattern, path });
  if (glob && glob.trim().length > 0) {
    params.set('glob', glob);
  }
  if (ignore && ignore.length > 0) {
    params.set('ignore', ignore.join(','));
  }
  const res = await fetch(`${API_BASE}/project/search?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to search files' }));
    throw new Error(error.error || 'Failed to search files');
  }
  return res.json();
}

export async function globProjectFiles(
  pattern: string,
  path?: string,
  ignore?: string[]
): Promise<ProjectGlobResponse> {
  const params = new URLSearchParams({ pattern });
  if (path) {
    params.set('path', path);
  }
  if (ignore && ignore.length > 0) {
    params.set('ignore', ignore.join(','));
  }
  const res = await fetch(`${API_BASE}/project/glob?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to glob files' }));
    throw new Error(error.error || 'Failed to glob files');
  }
  return res.json();
}

export async function fetchSessions(): Promise<SessionsResponse> {
  const res = await fetch(`${API_BASE}/sessions`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

export async function createSession(title?: string): Promise<{ session: { id: string } }> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to create session');
  return res.json();
}

export async function fetchSessionMessages(sessionId: string): Promise<SessionMessagesResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch session messages');
  return res.json();
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to update session title');
  return res.json();
}

export async function fetchSetting(key: string): Promise<SettingResponse> {
  const res = await fetch(`${API_BASE}/settings/${encodeURIComponent(key)}`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch setting');
  return res.json();
}

export async function saveSetting(key: string, value: unknown): Promise<SettingResponse> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error('Failed to save setting');
  return res.json();
}

export async function fetchActions(): Promise<{ actions: Action[] }> {
  const res = await fetch(`${API_BASE}/actions`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch actions');
  return res.json();
}

export async function fetchPendingActions(): Promise<{ actions: Action[] }> {
  const res = await fetch(`${API_BASE}/actions/pending`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch pending actions');
  return res.json();
}

export async function batchApproveActions(actionIds: string[]): Promise<{ results: Array<{ actionId: string; success: boolean; error?: string; result?: unknown }> }> {
  const res = await fetch(`${API_BASE}/actions/approve-batch`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionIds }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to batch approve actions');
  }

  return res.json();
}

export async function batchRejectActions(actionIds: string[]): Promise<{ results: Array<{ actionId: string; success: boolean; error?: string }> }> {
  const res = await fetch(`${API_BASE}/actions/reject-batch`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionIds }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to batch reject actions');
  }

  return res.json();
}

export async function approveAction(actionId: string): Promise<{ action: Action; result?: unknown }> {
  const res = await fetch(`${API_BASE}/actions/approve`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to approve action');
  }

  return res.json();
}

export async function rejectAction(actionId: string): Promise<{ action: Action }> {
  const res = await fetch(`${API_BASE}/actions/reject`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to reject action');
  }

  return res.json();
}

export async function retryAction(actionId: string): Promise<{ action: Action; originalActionId: string }> {
  const res = await fetch(`${API_BASE}/actions/retry`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to retry action');
  }

  return res.json();
}

export async function fetchSystemPrompt(): Promise<{ prompt: string }> {
  const res = await fetch(`${API_BASE}/system-prompt`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch system prompt');
  return res.json();
}

// Multi-Agent API

export interface AgentHistoryEntry {
  entryId: string;
  timestamp: string;
  agent: 'chapo' | 'koda' | 'devo';
  action: string;
  input?: unknown;
  output?: unknown;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: string;
  }>;
  duration: number;
  status: 'success' | 'error' | 'escalated' | 'waiting';
}

export interface MultiAgentResponse {
  message: ChatMessage;
  pendingActions: Action[];
  sessionId?: string;
  agentHistory?: AgentHistoryEntry[];
}

export async function sendMultiAgentMessage(
  message: string,
  projectRoot?: string,
  sessionId?: string,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<MultiAgentResponse> {
  const res = await fetch(`${API_BASE}/chat/agents`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, projectRoot, sessionId }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Failed to send multi-agent message');
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
  let finalResponse: MultiAgentResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { type?: string; response?: unknown };
        if (onEvent) {
          onEvent(event as ChatStreamEvent);
        }
        if (event.type === 'response') {
          finalResponse = event.response as MultiAgentResponse;
        }
      } catch (e) {
        console.warn('Failed to parse NDJSON line:', line, e);
      }
    }
  }

  // Process any remaining buffer content after stream ends
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer) as { type?: string; response?: unknown };
      if (onEvent) {
        onEvent(event as ChatStreamEvent);
      }
      if (event.type === 'response') {
        finalResponse = event.response as MultiAgentResponse;
      }
    } catch (e) {
      console.warn('Failed to parse final NDJSON buffer:', buffer, e);
    }
  }

  if (!finalResponse) {
    throw new Error('No response received from server');
  }

  return finalResponse;
}

export async function fetchAgentState(sessionId: string): Promise<{
  sessionId: string;
  currentPhase: string;
  activeAgent: string;
  agentHistory: AgentHistoryEntry[];
  pendingApprovals: unknown[];
  pendingQuestions: unknown[];
}> {
  const res = await fetch(`${API_BASE}/chat/agents/${sessionId}/state`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch agent state');
  return res.json();
}
