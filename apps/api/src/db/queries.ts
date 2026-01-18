import { nanoid } from 'nanoid';
import { getDb } from './index.js';
import type { ChatMessage } from '@devai/shared';

const DEFAULT_USER_ID = 'local';

export interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
}

export interface StoredMessage extends ChatMessage {
  sessionId: string;
}

export function getDefaultUserId(): string {
  return DEFAULT_USER_ID;
}

export function listSessions(userId: string = DEFAULT_USER_ID): SessionSummary[] {
  const rows = getDb()
    .prepare('SELECT id, title, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Array<{ id: string; title: string | null; created_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
  }));
}

export function createSession(title?: string, userId: string = DEFAULT_USER_ID): SessionSummary {
  const id = nanoid();
  const now = new Date().toISOString();
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, title, created_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, title || null, now);

  return { id, title: title || null, createdAt: now };
}

export function getSessionTitle(sessionId: string): string | null {
  const row = getDb()
    .prepare('SELECT title FROM sessions WHERE id = ?')
    .get(sessionId) as { title: string | null } | undefined;

  return row?.title ?? null;
}

export function updateSessionTitle(sessionId: string, title: string): void {
  getDb()
    .prepare('UPDATE sessions SET title = ? WHERE id = ?')
    .run(title, sessionId);
}

export function updateSessionTitleIfEmpty(sessionId: string, title: string): void {
  const existing = getSessionTitle(sessionId);
  if (existing) return;
  updateSessionTitle(sessionId, title);
}

export function getMessages(sessionId: string): StoredMessage[] {
  const rows = getDb()
    .prepare('SELECT id, session_id, role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC')
    .all(sessionId) as Array<{
      id: string;
      session_id: string;
      role: ChatMessage['role'];
      content: string;
      timestamp: string;
    }>;

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
  }));
}

export function saveMessage(sessionId: string, message: ChatMessage): void {
  getDb()
    .prepare('INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(message.id, sessionId, message.role, message.content, message.timestamp);
}

export function getSetting(key: string, userId: string = DEFAULT_USER_ID): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?')
    .get(userId, key) as { value: string } | undefined;

  return row?.value ?? null;
}

export function setSetting(key: string, value: string, userId: string = DEFAULT_USER_ID): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(`
      INSERT INTO settings (user_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .run(userId, key, value, now);
}

export function saveAuditLog(
  action: string,
  data: Record<string, unknown>,
  userId: string = DEFAULT_USER_ID
): void {
  const id = nanoid();
  const timestamp = new Date().toISOString();
  getDb()
    .prepare('INSERT INTO audit_logs (id, timestamp, user_id, action, data) VALUES (?, ?, ?, ?, ?)')
    .run(id, timestamp, userId, action, JSON.stringify(data));
}
