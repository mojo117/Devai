import type {
  ChatMessage,
  LLMProvider,
  Action,
  HealthResponse,
  ProjectFilesResponse,
  ProjectFileResponse,
  ProjectSearchResponse,
  ProjectGlobResponse,
  SessionsResponse,
  SessionMessagesResponse,
  SettingResponse,
} from './types';

const API_BASE = '/api';

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

// Auth token is now managed via httpOnly cookie set by the server.
// These functions are kept for backward compatibility but no longer store/read the JWT.
let _authTokenMemory: string | null = null;

export function getAuthToken(): string | null {
  return _authTokenMemory;
}

export function setAuthToken(token: string): void {
  _authTokenMemory = token;
}

export function clearAuthToken(): void {
  _authTokenMemory = null;
}

function withAuthHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const token = getAuthToken();
  if (!token) return headers;
  return { ...headers, Authorization: `Bearer ${token}` };
}

function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: 'include' });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
  return (await res.json()) as T;
}

async function fetchVoid(url: string, init?: RequestInit): Promise<void> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
}

async function parseJsonOrNdjson<T>(
  res: Response,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/x-ndjson')) {
    return (await res.json()) as T;
  }

  if (!res.body) {
    throw new Error('Missing response body');
  }

  return parseNDJSONStream<T>(res.body, onEvent);
}

async function fetchJsonOrNdjson<T>(
  url: string,
  init?: RequestInit,
  onEvent?: (event: ChatStreamEvent) => void
): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
  return parseJsonOrNdjson<T>(res, onEvent);
}

export async function logout(): Promise<void> {
  try {
    await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  } catch {
    // ignore
  }
  clearAuthToken();
}

export async function login(username: string, password: string): Promise<{ token: string }> {
  const data = await fetchJson<{ token: string }>(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { token: data.token };
}

export async function verifyAuth(): Promise<{ valid: boolean; token?: string }> {
  const res = await apiFetch(`${API_BASE}/auth/verify`, {
    headers: withAuthHeaders(),
  });

  if (!res.ok) return { valid: false };

  const data = await res.json();
  return { valid: true, token: data.token };
}

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>(`${API_BASE}/health`);
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
  return fetchJsonOrNdjson<{ message: ChatMessage; pendingActions: Action[]; sessionId?: string; contextStats?: { tokensUsed: number; tokenBudget: number; note?: string } }>(`${API_BASE}/chat`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ messages, provider, projectRoot, skillIds, pinnedFiles, projectContextOverride, sessionId }),
    signal: abortSignal,
  }, onEvent);
}


export async function listProjectFiles(path: string, ignore?: string[]): Promise<ProjectFilesResponse> {
  const params = new URLSearchParams({ path });
  if (ignore && ignore.length > 0) {
    params.set('ignore', ignore.join(','));
  }
  return fetchJson<ProjectFilesResponse>(`${API_BASE}/project/files?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
}

export async function readProjectFile(path: string): Promise<ProjectFileResponse> {
  const params = new URLSearchParams({ path });
  return fetchJson<ProjectFileResponse>(`${API_BASE}/project/file?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
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
  return fetchJson<ProjectSearchResponse>(`${API_BASE}/project/search?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
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
  return fetchJson<ProjectGlobResponse>(`${API_BASE}/project/glob?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
}

export async function fetchSessions(): Promise<SessionsResponse> {
  return fetchJson<SessionsResponse>(`${API_BASE}/sessions`, {
    headers: withAuthHeaders(),
  });
}

export async function createSession(title?: string): Promise<{ session: { id: string } }> {
  return fetchJson<{ session: { id: string } }>(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title }),
  });
}

export async function fetchSessionMessages(sessionId: string): Promise<SessionMessagesResponse> {
  return fetchJson<SessionMessagesResponse>(`${API_BASE}/sessions/${sessionId}/messages`, {
    headers: withAuthHeaders(),
  });
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<{ success: boolean }> {
  return fetchJson<{ success: boolean }>(`${API_BASE}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title }),
  });
}

export async function saveSessionMessage(
  sessionId: string,
  message: { id: string; role: string; content: string; timestamp: string },
): Promise<void> {
  await apiFetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(message),
  }).catch(() => {
    // Non-critical — don't break the UI if persistence fails
  });
}

export async function fetchSetting(key: string): Promise<SettingResponse> {
  return fetchJson<SettingResponse>(`${API_BASE}/settings/${encodeURIComponent(key)}`, {
    headers: withAuthHeaders(),
  });
}

export async function saveSetting(key: string, value: unknown): Promise<SettingResponse> {
  return fetchJson<SettingResponse>(`${API_BASE}/settings`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key, value }),
  });
}

export async function fetchPendingActions(): Promise<{ actions: Action[] }> {
  return fetchJson<{ actions: Action[] }>(`${API_BASE}/actions/pending`, {
    headers: withAuthHeaders(),
  });
}

export async function batchApproveActions(actionIds: string[]): Promise<{ results: Array<{ actionId: string; success: boolean; error?: string; result?: unknown }> }> {
  return fetchJson<{ results: Array<{ actionId: string; success: boolean; error?: string; result?: unknown }> }>(`${API_BASE}/actions/approve-batch`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionIds }),
  });
}

export async function batchRejectActions(actionIds: string[]): Promise<{ results: Array<{ actionId: string; success: boolean; error?: string }> }> {
  return fetchJson<{ results: Array<{ actionId: string; success: boolean; error?: string }> }>(`${API_BASE}/actions/reject-batch`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionIds }),
  });
}

export async function approveAction(actionId: string): Promise<{ action: Action; result?: unknown }> {
  return fetchJson<{ action: Action; result?: unknown }>(`${API_BASE}/actions/approve`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionId }),
  });
}

export async function rejectAction(actionId: string): Promise<{ action: Action }> {
  return fetchJson<{ action: Action }>(`${API_BASE}/actions/reject`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ actionId }),
  });
}

// Multi-Agent API

export interface AgentHistoryEntry {
  entryId: string;
  timestamp: string;
  agent: 'chapo' | 'devo' | 'scout';
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
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  // Token is sent via httpOnly cookie automatically.
  // Keep token param as fallback for in-memory token.
  const token = getAuthToken();
  const params = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${protocol}//${host}/api/ws/chat${params}`;
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
  options?: MultiAgentSessionOptions,
  pinnedUserfileIds?: string[],
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
      ...(pinnedUserfileIds && pinnedUserfileIds.length > 0 ? { pinnedUserfileIds } : {}),
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

  return fetchJsonOrNdjson<MultiAgentResponse>(`${API_BASE}/chat/agents/approval`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sessionId, approvalId, approved }),
  }, onEvent);
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

  return fetchJsonOrNdjson<MultiAgentResponse>(`${API_BASE}/chat/agents/question`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sessionId, questionId, answer }),
  }, onEvent);
}

export async function sendMultiAgentMessage(
  message: string,
  projectRoot?: string,
  sessionId?: string,
  onEvent?: (event: ChatStreamEvent) => void,
  options?: MultiAgentSessionOptions,
  pinnedUserfileIds?: string[],
): Promise<MultiAgentResponse> {
  // Prefer WebSocket control plane; fall back to HTTP NDJSON.
  try {
    if (typeof window !== 'undefined' && typeof WebSocket !== 'undefined' && getAuthToken()) {
      return await sendMultiAgentMessageWs(message, projectRoot, sessionId, onEvent, options, pinnedUserfileIds);
    }
  } catch {
    // fall back
  }

  const sessionModePayload = buildSessionModePayload(options);
  return fetchJsonOrNdjson<MultiAgentResponse>(`${API_BASE}/chat/agents`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      message,
      projectRoot,
      sessionId,
      ...sessionModePayload,
      ...(pinnedUserfileIds && pinnedUserfileIds.length > 0 ? { pinnedUserfileIds } : {}),
    }),
  }, onEvent);
}

export async function fetchAgentState(sessionId: string): Promise<{
  sessionId: string;
  currentPhase: string;
  activeAgent: string;
  agentHistory: AgentHistoryEntry[];
  pendingApprovals: unknown[];
  pendingQuestions: unknown[];
}> {
  return fetchJson<{
    sessionId: string;
    currentPhase: string;
    activeAgent: string;
    agentHistory: AgentHistoryEntry[];
    pendingApprovals: unknown[];
    pendingQuestions: unknown[];
  }>(`${API_BASE}/chat/agents/${sessionId}/state`, {
    headers: withAuthHeaders(),
  });
}

export async function getTrustMode(): Promise<{ mode: 'default' | 'trusted' }> {
  return fetchJson<{ mode: 'default' | 'trusted' }>(`${API_BASE}/settings/trust-mode`, {
    headers: withAuthHeaders(),
  });
}

export async function setTrustMode(mode: 'default' | 'trusted'): Promise<void> {
  await fetchVoid(`${API_BASE}/settings/trust-mode`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mode }),
  });
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
  return fetchJson<{
    saved: boolean;
    daily: { date: string; filePath: string };
    longTerm: { filePath: string } | null;
  }>(`${API_BASE}/memory/remember`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      content,
      promoteToLongTerm: options?.promoteToLongTerm ?? false,
      sessionId: options?.sessionId,
      source: options?.source,
    }),
  });
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
  return fetchJson<{
    query: string;
    count: number;
    hits: Array<{ filePath: string; line: number; snippet: string }>;
  }>(`${API_BASE}/memory/search?${params.toString()}`, {
    headers: withAuthHeaders(),
  });
}

export async function fetchDailyWorkspaceMemory(date: string): Promise<{
  date: string;
  filePath: string;
  content: string;
}> {
  return fetchJson<{
    date: string;
    filePath: string;
    content: string;
  }>(`${API_BASE}/memory/daily/${encodeURIComponent(date)}`, {
    headers: withAuthHeaders(),
  });
}

// ============ Userfiles API ============

export interface UserfileInfo {
  id: string;
  name: string;
  original_name: string;
  mime_type: string;
  size: number;
  parse_status: 'parsed' | 'metadata_only' | 'failed' | 'pending';
  uploaded_at: string;
  expires_at: string;
}

export async function listUserfiles(): Promise<{ files: UserfileInfo[] }> {
  return fetchJson<{ files: UserfileInfo[] }>(`${API_BASE}/userfiles`, {
    headers: withAuthHeaders(),
  });
}

export async function uploadUserfile(file: File): Promise<{ success: boolean; file: UserfileInfo }> {
  const formData = new FormData();
  formData.append('file', file);
  return fetchJson<{ success: boolean; file: UserfileInfo }>(`${API_BASE}/userfiles`, {
    method: 'POST',
    headers: withAuthHeaders(),
    body: formData,
  });
}

export async function deleteUserfile(id: string): Promise<void> {
  await fetchVoid(`${API_BASE}/userfiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: withAuthHeaders(),
  });
}

/** Build the download URL for a userfile. */
export function getUserfileDownloadUrl(fileId: string): string {
  return `${API_BASE}/userfiles/${encodeURIComponent(fileId)}/download`;
}

export async function transcribeAudio(audioBlob: Blob): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.webm');
  return fetchJson<{ text: string }>(`${API_BASE}/transcribe`, {
    method: 'POST',
    headers: withAuthHeaders(),
    body: formData,
  });
}
