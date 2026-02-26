import { getSupabase } from './index.js';
import type { ChatMessage } from '@devai/shared';

export interface StoredMessage extends ChatMessage {
  sessionId: string;
  toolEvents?: unknown[];
}

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('id, session_id, role, content, timestamp, tool_events')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: true });

  if (error) {
    console.error('Failed to get messages:', error);
    return [];
  }

  const roleOrder: Record<ChatMessage['role'], number> = {
    user: 0,
    assistant: 1,
    system: 2,
  };

  return (data || []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatMessage['role'],
    content: row.content,
    timestamp: row.timestamp,
    toolEvents: row.tool_events || undefined,
  })).sort((a, b) => {
    const ta = Date.parse(a.timestamp);
    const tb = Date.parse(b.timestamp);
    if (ta !== tb) return ta - tb;
    const ra = roleOrder[a.role] ?? 99;
    const rb = roleOrder[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
}

export async function saveMessage(
  sessionId: string,
  message: ChatMessage,
  toolEvents?: unknown[]
): Promise<void> {
  const { error } = await getSupabase()
    .from('messages')
    .insert({
      id: message.id,
      session_id: sessionId,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      ...(toolEvents ? { tool_events: toolEvents } : {}),
    });

  if (error) {
    console.error('Failed to save message:', error);
  }
}
