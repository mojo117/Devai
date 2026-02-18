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
  LooperPromptsResponse,
} from './types';

const API_BASE = '/api';
const TOKEN_KEY = 'devai_auth_token';

/**
 * Parse an NDJSON stream and return the final response.
 * Emits events via onEvent callback as they arrive.
 */
async function parseNDJSONStream<T>(
  body: ReadableStream<Uint8Array>,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: T | null = null;

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
        onEvent?.(event as ChatStreamEvent);
        if (event.type === 'response') {
          finalResponse = event.response as T;
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
      onEvent?.(event as ChatStreamEvent);
      if (event.type === 'response') {
        finalResponse = event.response as T;
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

async function readApiError(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') || '';
  const fallback = `HTTP ${res.status} ${res.statusText || ''}`.trim();

  if (contentType.includes('application/json')) {
    try {
      const data = (await res.json()) as any;
      const parts: string[] = [];
      if (data?.error) parts.push(String(data.error));
      if (data?.details) parts.push(String(data.details));
      if (Array.isArray(data?.details)) parts.push(JSON.stringify(data.details));
      const msg = parts.filter(Boolean).join(': ').trim();
      return msg || fallback;
    } catch {
      // fall through
    }
  }

  try {
    const text = (await res.text()).trim();
    if (!text) return fallback;
    // Avoid dumping an entire HTML document.
    if (text.startsWith('<!doctype') || text.startsWith('<html')) return fallback;
    return `${fallback}: ${text}`.trim();
  } catch {
    return fallback;
  }
}

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
    throw new Error(await readApiError(res));
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
  onEvent?: (event: ChatStreamEvent) => void,
  abortSignal?: AbortSignal
): Promise<{ message: ChatMessage; pendingActions: Action[]; sessionId?: string; contextStats?: { tokensUsed: number; tokenBudget: number; note?: string } }> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ messages, provider, projectRoot, skillIds, pinnedFiles, projectContextOverride, sessionId }),
    signal: abortSignal,
  });

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/x-ndjson')) {
    return res.json();
  }

  if (!res.body) {
    throw new Error('Missing response body');
  }

  return parseNDJSONStream<{ message: ChatMessage; pendingActions: Action[]; sessionId?: string; contextStats?: { tokensUsed: number; tokenBudget: number; note?: string } }>(res.body, onEvent);
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
    throw new Error(await readApiError(res));
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
    throw new Error(await readApiError(res));
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
    throw new Error(await readApiError(res));
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
    throw new Error(await readApiError(res));
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
    throw new Error(await readApiError(res));
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

export async function fetchLooperPrompts(): Promise<LooperPromptsResponse> {
  const res = await fetch(`${API_BASE}/looper/prompts`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch looper prompts');
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

export type WorkspaceChatMode = 'main' | 'shared';

export interface MultiAgentSessionOptions {
  workspaceContextMode?: WorkspaceChatMode;
  chatMode?: WorkspaceChatMode;
  sessionMode?: WorkspaceChatMode;
  visibility?: WorkspaceChatMode;
}

function buildSessionModePayload(
  options?: MultiAgentSessionOptions
): {
  workspaceContextMode: WorkspaceChatMode;
  chatMode: WorkspaceChatMode;
  metadata: Record<string, unknown>;
  sessionMode?: WorkspaceChatMode;
  visibility?: WorkspaceChatMode;
} {
  const workspaceContextMode = options?.workspaceContextMode ?? 'main';
  const chatMode = options?.chatMode ?? workspaceContextMode;
  const sessionMode = options?.sessionMode;
  const visibility = options?.visibility;

  const metadata: Record<string, unknown> = {
    workspaceContextMode,
    chatMode,
  };
  if (sessionMode) metadata.sessionMode = sessionMode;
  if (visibility) metadata.visibility = visibility;

  return {
    workspaceContextMode,
    chatMode,
    metadata,
    ...(sessionMode ? { sessionMode } : {}),
    ...(visibility ? { visibility } : {}),
  };
}

// ===========================================
// WebSocket Control Plane (Multi-Agent)
// ===========================================

type PendingWsRequest = {
  resolve: (value: MultiAgentResponse) => void;
  reject: (err: Error) => void;
  onEvent?: (event: ChatStreamEvent) => void;
  timeoutId: number;
};

let chatWs: WebSocket | null = null;
let chatWsConnecting: Promise<WebSocket> | null = null;
let chatWsPingTimer: number | null = null;
let chatWsReconnectTimer: number | null = null;
let chatWsReconnectAttempts = 0;
const pendingWsRequests = new Map<string, PendingWsRequest>();
const lastSeqBySession = new Map<string, number>();
const sessionListeners = new Map<string, Set<(event: ChatStreamEvent) => void>>();
const actionListeners = new Set<(event: ChatStreamEvent) => void>();

function getSeqStorageKey(sessionId: string): string {
  return `devai_chat_seq_${sessionId}`;
}

function loadLastSeq(sessionId: string): number {
  const mem = lastSeqBySession.get(sessionId);
  if (typeof mem === 'number') return mem;
  try {
    const raw = localStorage.getItem(getSeqStorageKey(sessionId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function storeLastSeq(sessionId: string, seq: number): void {
  lastSeqBySession.set(sessionId, seq);
  try {
    localStorage.setItem(getSeqStorageKey(sessionId), String(seq));
  } catch {
    // ignore
  }
}

function addSessionListener(sessionId: string, fn: (event: ChatStreamEvent) => void): () => void {
  const set = sessionListeners.get(sessionId) ?? new Set();
  set.add(fn);
  sessionListeners.set(sessionId, set);
  return () => {
    const cur = sessionListeners.get(sessionId);
    if (!cur) return;
    cur.delete(fn);
    if (cur.size === 0) sessionListeners.delete(sessionId);
  };
}

function getChatWsUrl(): string {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/api/ws/chat?token=${encodeURIComponent(token)}`;
}

function cleanupChatWs(): void {
  if (chatWsPingTimer) {
    window.clearInterval(chatWsPingTimer);
    chatWsPingTimer = null;
  }
  if (chatWsReconnectTimer) {
    window.clearTimeout(chatWsReconnectTimer);
    chatWsReconnectTimer = null;
  }
  chatWs = null;
  chatWsConnecting = null;
}

function hasAnyControlPlaneSubscribers(): boolean {
  if (actionListeners.size > 0) return true;
  for (const set of sessionListeners.values()) {
    if (set.size > 0) return true;
  }
  return false;
}

function scheduleControlPlaneReconnect(): void {
  if (!hasAnyControlPlaneSubscribers()) return;
  // No auth token means WS can't connect; avoid spinning.
  if (!getAuthToken()) return;
  if (chatWsReconnectTimer) return;

  const delay = Math.min(1000 * Math.pow(2, chatWsReconnectAttempts), 30000);
  chatWsReconnectAttempts += 1;
  chatWsReconnectTimer = window.setTimeout(() => {
    chatWsReconnectTimer = null;
    ensureChatWsConnected().catch(() => {
      scheduleControlPlaneReconnect();
    });
  }, delay);
}

function failPendingWsRequests(message: string): void {
  for (const [id, req] of pendingWsRequests.entries()) {
    window.clearTimeout(req.timeoutId);
    req.reject(new Error(message));
    pendingWsRequests.delete(id);
  }
}

async function ensureChatWsConnected(): Promise<WebSocket> {
  if (chatWs && chatWs.readyState === WebSocket.OPEN) return chatWs;
  if (chatWsConnecting) return chatWsConnecting;

  chatWsConnecting = new Promise<WebSocket>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(getChatWsUrl());
    } catch (err) {
      cleanupChatWs();
      reject(err instanceof Error ? err : new Error('Failed to create WebSocket'));
      return;
    }

    ws.onopen = () => {
      chatWs = ws;
      chatWsConnecting = null;
      chatWsReconnectAttempts = 0;

      // Keep alive (best-effort).
      chatWsPingTimer = window.setInterval(() => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        } catch {
          // ignore
        }
      }, 30000);

      resolve(ws);
    };

    ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      // Action events are global and do not include sessionId/seq.
      if (msg && typeof msg.type === 'string') {
        if (msg.type === 'action_pending' || msg.type === 'action_updated' || msg.type === 'action_created' || msg.type === 'initial_sync') {
          for (const fn of actionListeners) fn(msg as ChatStreamEvent);
          // Don't return; these can still be request-scoped in the future.
        }
      }

      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : undefined;
      const seq = typeof msg.seq === 'number' ? msg.seq : undefined;
      if (sessionId && typeof seq === 'number') {
        const prev = loadLastSeq(sessionId);
        if (seq > prev) storeLastSeq(sessionId, seq);
      }

      const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
      if (requestId && pendingWsRequests.has(requestId)) {
        const pending = pendingWsRequests.get(requestId)!;
        pending.onEvent?.(msg as ChatStreamEvent);
        if (msg.type === 'response' && msg.response) {
          window.clearTimeout(pending.timeoutId);
          pendingWsRequests.delete(requestId);
          pending.resolve(msg.response as MultiAgentResponse);
        }
        return;
      }

      // Broadcast non-request-scoped events (including replay) to listeners for that session.
      if (sessionId) {
        const set = sessionListeners.get(sessionId);
        if (set) {
          for (const fn of set) fn(msg as ChatStreamEvent);
        }
      }
    };

    ws.onclose = () => {
      cleanupChatWs();
      failPendingWsRequests('Chat WebSocket disconnected');
      scheduleControlPlaneReconnect();
    };

    ws.onerror = () => {
      // onclose will handle cleanup.
      failPendingWsRequests('Chat WebSocket error');
      scheduleControlPlaneReconnect();
    };
  });

  return chatWsConnecting;
}

export async function ensureControlPlaneConnected(): Promise<void> {
  await ensureChatWsConnected();
}

export function isControlPlaneConnected(): boolean {
  return !!chatWs && chatWs.readyState === WebSocket.OPEN;
}

export function subscribeActionEvents(fn: (event: ChatStreamEvent) => void): () => void {
  actionListeners.add(fn);
  // Make sure the control plane is up while we have subscribers.
  ensureChatWsConnected().catch(() => {
    // ignore
  });
  return () => {
    actionListeners.delete(fn);
  };
}

async function wsHello(sessionId: string): Promise<void> {
  const ws = await ensureChatWsConnected();
  const sinceSeq = loadLastSeq(sessionId);
  try {
    ws.send(JSON.stringify({ type: 'hello', sessionId, sinceSeq }));
  } catch {
    // ignore
  }
}

async function sendWsCommand(
  payload: Record<string, unknown>,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<MultiAgentResponse> {
  const ws = await ensureChatWsConnected();
  const requestId = crypto.randomUUID();

  const timeoutId = window.setTimeout(() => {
    const pending = pendingWsRequests.get(requestId);
    if (pending) {
      pendingWsRequests.delete(requestId);
      pending.reject(new Error('Chat WebSocket request timed out'));
    }
  }, 180000);

  const p = new Promise<MultiAgentResponse>((resolve, reject) => {
    pendingWsRequests.set(requestId, { resolve, reject, onEvent, timeoutId });
  });

  ws.send(JSON.stringify({ ...payload, requestId }));
  return p;
}

async function sendMultiAgentMessageWs(
  message: string,
  projectRoot?: string,
  sessionId?: string,
  onEvent?: (event: ChatStreamEvent) => void,
  options?: MultiAgentSessionOptions
): Promise<MultiAgentResponse> {
  let remove: (() => void) | null = null;
  if (sessionId && onEvent) {
    remove = addSessionListener(sessionId, onEvent);
  }
  try {
    if (sessionId) await wsHello(sessionId);
    return await sendWsCommand({
      type: 'request',
      message,
      projectRoot,
      sessionId,
      ...buildSessionModePayload(options),
    }, onEvent);
  } finally {
    remove?.();
  }
}

async function sendAgentApprovalWs(
  sessionId: string,
  approvalId: string,
  approved: boolean,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<MultiAgentResponse> {
  const remove = onEvent ? addSessionListener(sessionId, onEvent) : null;
  try {
    await wsHello(sessionId);
    return await sendWsCommand({ type: 'approval', sessionId, approvalId, approved }, onEvent);
  } finally {
    remove?.();
  }
}

async function sendAgentQuestionResponseWs(
  sessionId: string,
  questionId: string,
  answer: string,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<MultiAgentResponse> {
  const remove = onEvent ? addSessionListener(sessionId, onEvent) : null;
  try {
    await wsHello(sessionId);
    return await sendWsCommand({ type: 'question', sessionId, questionId, answer }, onEvent);
  } finally {
    remove?.();
  }
}

export async function sendAgentApproval(
  sessionId: string,
  approvalId: string,
  approved: boolean,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<MultiAgentResponse> {
  // Prefer WebSocket control plane; fall back to HTTP NDJSON.
  try {
    if (typeof window !== 'undefined' && typeof WebSocket !== 'undefined' && getAuthToken()) {
      return await sendAgentApprovalWs(sessionId, approvalId, approved, onEvent);
    }
  } catch {
    // fall back
  }

  const res = await fetch(`${API_BASE}/chat/agents/approval`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sessionId, approvalId, approved }),
  });

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/x-ndjson')) {
    return res.json();
  }

  if (!res.body) {
    throw new Error('Missing response body');
  }

  return parseNDJSONStream<MultiAgentResponse>(res.body, onEvent);
}

export async function sendAgentQuestionResponse(
  sessionId: string,
  questionId: string,
  answer: string,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<MultiAgentResponse> {
  // Prefer WebSocket control plane; fall back to HTTP NDJSON.
  try {
    if (typeof window !== 'undefined' && typeof WebSocket !== 'undefined' && getAuthToken()) {
      return await sendAgentQuestionResponseWs(sessionId, questionId, answer, onEvent);
    }
  } catch {
    // fall back
  }

  const res = await fetch(`${API_BASE}/chat/agents/question`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sessionId, questionId, answer }),
  });

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/x-ndjson')) {
    return res.json();
  }

  if (!res.body) {
    throw new Error('Missing response body');
  }

  return parseNDJSONStream<MultiAgentResponse>(res.body, onEvent);
}

export async function sendMultiAgentMessage(
  message: string,
  projectRoot?: string,
  sessionId?: string,
  onEvent?: (event: ChatStreamEvent) => void,
  options?: MultiAgentSessionOptions
): Promise<MultiAgentResponse> {
  // Prefer WebSocket control plane; fall back to HTTP NDJSON.
  try {
    if (typeof window !== 'undefined' && typeof WebSocket !== 'undefined' && getAuthToken()) {
      return await sendMultiAgentMessageWs(message, projectRoot, sessionId, onEvent, options);
    }
  } catch {
    // fall back
  }

  const sessionModePayload = buildSessionModePayload(options);
  const res = await fetch(`${API_BASE}/chat/agents`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      message,
      projectRoot,
      sessionId,
      ...sessionModePayload,
    }),
  });

  if (!res.ok) {
    throw new Error(await readApiError(res));
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/x-ndjson')) {
    return res.json();
  }

  if (!res.body) {
    throw new Error('Missing response body');
  }

  return parseNDJSONStream<MultiAgentResponse>(res.body, onEvent);
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

// Global Context API

export interface GlobalContext {
  content: string;
  enabled: boolean;
}

export async function fetchGlobalContext(): Promise<GlobalContext> {
  const res = await fetch(`${API_BASE}/settings/global-context`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Failed to fetch global context');
  return res.json();
}

export async function saveGlobalContext(context: GlobalContext): Promise<GlobalContext> {
  const res = await fetch(`${API_BASE}/settings/global-context`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(context),
  });
  if (!res.ok) throw new Error('Failed to save global context');
  return res.json();
}

export async function getTrustMode(): Promise<{ mode: 'default' | 'trusted' }> {
  const response = await fetch(`${API_BASE}/settings/trust-mode`, {
    headers: withAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error('Failed to get trust mode');
  }
  return response.json();
}

export async function setTrustMode(mode: 'default' | 'trusted'): Promise<void> {
  const response = await fetch(`${API_BASE}/settings/trust-mode`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) {
    throw new Error('Failed to set trust mode');
  }
}

// Workspace Memory API

export async function rememberWorkspaceNote(
  content: string,
  options?: { promoteToLongTerm?: boolean; sessionId?: string; source?: string }
): Promise<{
  saved: boolean;
  daily: { date: string; filePath: string };
  longTerm: { filePath: string } | null;
}> {
  const res = await fetch(`${API_BASE}/memory/remember`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      content,
      promoteToLongTerm: options?.promoteToLongTerm ?? false,
      sessionId: options?.sessionId,
      source: options?.source,
    }),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export async function searchWorkspaceMemory(
  query: string,
  options?: { limit?: number; includeLongTerm?: boolean }
): Promise<{
  query: string;
  count: number;
  hits: Array<{ filePath: string; line: number; snippet: string }>;
}> {
  const params = new URLSearchParams({
    query,
    limit: String(options?.limit ?? 10),
    includeLongTerm: String(options?.includeLongTerm ?? true),
  });
  const res = await fetch(`${API_BASE}/memory/search?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export async function fetchDailyWorkspaceMemory(date: string): Promise<{
  date: string;
  filePath: string;
  content: string;
}> {
  const res = await fetch(`${API_BASE}/memory/daily/${encodeURIComponent(date)}`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

// ============ Userfiles API ============

export interface UserfileInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export async function listUserfiles(): Promise<{ files: UserfileInfo[] }> {
  const res = await fetch(`${API_BASE}/userfiles`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export async function uploadUserfile(file: File): Promise<{ success: boolean; file: UserfileInfo }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/userfiles`, {
    method: 'POST',
    headers: withAuthHeaders(),
    body: formData,
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json();
}

export async function deleteUserfile(filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}/userfiles/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error(await readApiError(res));
}
