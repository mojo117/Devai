import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchSessions,
  createSession,
  fetchSessionMessages,
  saveSetting,
  fetchSetting,
} from '../../../api';
import type { ChatMessage, SessionSummary } from '../../../types';
import type { ToolEvent } from '../types';

export interface SessionRegistryEntry {
  id: string;
  title: string | null;
  messages: ChatMessage[];
  toolEvents: Record<string, ToolEvent[]>;
  isLoading: boolean;
  hasUnread: boolean;
  lastActivity: number;
  createdAt: string;
}

export interface SessionRegistry {
  sessions: Map<string, SessionRegistryEntry>;
  sessionList: SessionSummary[];
  activeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseSessionRegistryReturn extends SessionRegistry {
  activateSession: (id: string) => Promise<void>;
  createNewSession: () => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  markAsRead: (id: string) => void;
  updateSessionMessages: (id: string, messages: ChatMessage[]) => void;
  appendSessionMessage: (id: string, message: ChatMessage) => void;
  updateSessionToolEvents: (id: string, messageId: string, events: ToolEvent[]) => void;
  setSessionLoading: (id: string, loading: boolean) => void;
  updateSessionTitle: (id: string, title: string) => void;
  refreshSessionList: () => Promise<void>;
  getActiveSession: () => SessionRegistryEntry | null;
}

export function useSessionRegistry(
  onClearPinnedUserfiles?: () => void
): UseSessionRegistryReturn {
  const [sessions, setSessions] = useState<Map<string, SessionRegistryEntry>>(new Map());
  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initialLoadRef = useRef(false);

  const loadSessionIntoCache = useCallback(async (sessionId: string): Promise<SessionRegistryEntry | null> => {
    try {
      const history = await fetchSessionMessages(sessionId);
      const toolEventsMap: Record<string, ToolEvent[]> = {};
      
      for (const msg of history.messages) {
        if (msg.toolEvents && Array.isArray(msg.toolEvents) && msg.toolEvents.length > 0) {
          toolEventsMap[msg.id] = msg.toolEvents as ToolEvent[];
        }
      }

      const entry: SessionRegistryEntry = {
        id: sessionId,
        title: null,
        messages: history.messages,
        toolEvents: toolEventsMap,
        isLoading: false,
        hasUnread: false,
        lastActivity: Date.now(),
        createdAt: new Date().toISOString(),
      };

      return entry;
    } catch (err) {
      console.error(`[useSessionRegistry] Failed to load session ${sessionId}:`, err);
      return null;
    }
  }, []);

  const refreshSessionList = useCallback(async () => {
    try {
      const result = await fetchSessions();
      setSessionList(result.sessions);
      
      setSessions((prev) => {
        const next = new Map(prev);
        for (const summary of result.sessions) {
          const existing = next.get(summary.id);
          if (existing) {
            existing.title = summary.title;
            existing.createdAt = summary.createdAt;
          } else {
            next.set(summary.id, {
              id: summary.id,
              title: summary.title,
              messages: [],
              toolEvents: {},
              isLoading: false,
              hasUnread: false,
              lastActivity: 0,
              createdAt: summary.createdAt,
            });
          }
        }
        return next;
      });
    } catch (err) {
      console.error('[useSessionRegistry] Failed to refresh session list:', err);
    }
  }, []);

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        let storedId: string | null = null;
        try {
          const stored = await fetchSetting('lastSessionId');
          storedId = typeof stored.value === 'string' ? stored.value : null;
        } catch {
          // Ignore
        }

        const result = await fetchSessions();
        setSessionList(result.sessions);

        if (result.sessions.length === 0) {
          const response = await createSession();
          const newSession: SessionRegistryEntry = {
            id: response.session.id,
            title: null,
            messages: [],
            toolEvents: {},
            isLoading: false,
            hasUnread: false,
            lastActivity: Date.now(),
            createdAt: new Date().toISOString(),
          };
          setSessions(new Map([[response.session.id, newSession]]));
          setActiveSessionId(response.session.id);
          await saveSetting('lastSessionId', response.session.id);
        } else {
          const targetId = storedId && result.sessions.some(s => s.id === storedId)
            ? storedId
            : result.sessions[0].id;

          const initialSessions = new Map<string, SessionRegistryEntry>();
          for (const summary of result.sessions) {
            initialSessions.set(summary.id, {
              id: summary.id,
              title: summary.title,
              messages: [],
              toolEvents: {},
              isLoading: true,
              hasUnread: false,
              lastActivity: 0,
              createdAt: summary.createdAt,
            });
          }
          setSessions(initialSessions);
          setActiveSessionId(targetId);

          const entry = await loadSessionIntoCache(targetId);
          if (entry) {
            const summary = result.sessions.find(s => s.id === targetId);
            entry.title = summary?.title || null;
            setSessions((prev) => {
              const next = new Map(prev);
              next.set(targetId, entry);
              return next;
            });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [loadSessionIntoCache]);

  const activateSession = useCallback(async (id: string) => {
    setActiveSessionId(id);
    await saveSetting('lastSessionId', id);

    setSessions((prev) => {
      const entry = prev.get(id);
      if (entry) {
        entry.hasUnread = false;
        const next = new Map(prev);
        next.set(id, { ...entry });
        return next;
      }
      return prev;
    });

    const entry = sessions.get(id);
    if (!entry || entry.messages.length === 0) {
      setSessions((prev) => {
        const existing = prev.get(id);
        if (existing) {
          const next = new Map(prev);
          next.set(id, { ...existing, isLoading: true });
          return next;
        }
        return prev;
      });

      const loaded = await loadSessionIntoCache(id);
      if (loaded) {
        const summary = sessionList.find(s => s.id === id);
        loaded.title = summary?.title || null;
        setSessions((prev) => {
          const next = new Map(prev);
          next.set(id, loaded);
          return next;
        });
      } else {
        setSessions((prev) => {
          const existing = prev.get(id);
          if (existing) {
            const next = new Map(prev);
            next.set(id, { ...existing, isLoading: false });
            return next;
          }
          return prev;
        });
      }
    }
  }, [sessions, sessionList, loadSessionIntoCache]);

  const createNewSession = useCallback(async (): Promise<string> => {
    const response = await createSession();
    const newSession: SessionRegistryEntry = {
      id: response.session.id,
      title: null,
      messages: [],
      toolEvents: {},
      isLoading: false,
      hasUnread: false,
      lastActivity: Date.now(),
      createdAt: new Date().toISOString(),
    };

    setSessions((prev) => {
      const next = new Map(prev);
      next.set(response.session.id, newSession);
      return next;
    });
    setSessionList((prev) => [{ id: response.session.id, title: null, createdAt: newSession.createdAt }, ...prev]);
    setActiveSessionId(response.session.id);
    await saveSetting('lastSessionId', response.session.id);
    onClearPinnedUserfiles?.();

    return response.session.id;
  }, [onClearPinnedUserfiles]);

  const deleteSession = useCallback(async (id: string) => {
    // For now just remove from local state
    // TODO: Add DELETE API endpoint
    setSessions((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setSessionList((prev) => prev.filter(s => s.id !== id));

    if (activeSessionId === id) {
      const remaining = sessionList.filter(s => s.id !== id);
      if (remaining.length > 0) {
        await activateSession(remaining[0].id);
      } else {
        await createNewSession();
      }
    }
  }, [activeSessionId, sessionList, activateSession, createNewSession]);

  const markAsRead = useCallback((id: string) => {
    setSessions((prev) => {
      const entry = prev.get(id);
      if (entry && entry.hasUnread) {
        const next = new Map(prev);
        next.set(id, { ...entry, hasUnread: false });
        return next;
      }
      return prev;
    });
  }, []);

  const updateSessionMessages = useCallback((id: string, messages: ChatMessage[]) => {
    setSessions((prev) => {
      const entry = prev.get(id);
      if (entry) {
        const next = new Map(prev);
        next.set(id, { ...entry, messages, lastActivity: Date.now() });
        return next;
      }
      return prev;
    });
  }, []);

  const appendSessionMessage = useCallback((id: string, message: ChatMessage) => {
    setSessions((prev) => {
      const entry = prev.get(id);
      if (entry) {
        const next = new Map(prev);
        const hasUnread = id !== activeSessionId;
        next.set(id, {
          ...entry,
          messages: [...entry.messages, message],
          lastActivity: Date.now(),
          hasUnread: entry.hasUnread || hasUnread,
        });
        return next;
      }
      return prev;
    });
  }, [activeSessionId]);

  const updateSessionToolEvents = useCallback((id: string, messageId: string, events: ToolEvent[]) => {
    setSessions((prev) => {
      const entry = prev.get(id);
      if (entry) {
        const next = new Map(prev);
        next.set(id, {
          ...entry,
          toolEvents: { ...entry.toolEvents, [messageId]: events },
        });
        return next;
      }
      return prev;
    });
  }, []);

  const setSessionLoading = useCallback((id: string, loading: boolean) => {
    setSessions((prev) => {
      const entry = prev.get(id);
      if (entry) {
        const next = new Map(prev);
        next.set(id, { ...entry, isLoading: loading });
        return next;
      }
      return prev;
    });
  }, []);

  const updateSessionTitleLocal = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const entry = prev.get(id);
      if (entry) {
        const next = new Map(prev);
        next.set(id, { ...entry, title });
        return next;
      }
      return prev;
    });
    setSessionList((prev) => prev.map(s => s.id === id ? { ...s, title } : s));
  }, []);

  const getActiveSession = useCallback((): SessionRegistryEntry | null => {
    if (!activeSessionId) return null;
    return sessions.get(activeSessionId) || null;
  }, [sessions, activeSessionId]);

  return {
    sessions,
    sessionList,
    activeSessionId,
    isLoading,
    error,
    activateSession,
    createNewSession,
    deleteSession,
    markAsRead,
    updateSessionMessages,
    appendSessionMessage,
    updateSessionToolEvents,
    setSessionLoading,
    updateSessionTitle: updateSessionTitleLocal,
    refreshSessionList,
    getActiveSession,
  };
}
