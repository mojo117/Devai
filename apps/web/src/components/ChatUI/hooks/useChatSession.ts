import { useState, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { fetchSessions, createSession, fetchSessionMessages, updateSessionTitle } from '../../../api';
import type { ChatMessage, SessionSummary } from '../../../types';
import type { ChatSessionState, ChatSessionCommandEnvelope, ToolEvent } from '../types';

interface UseChatSessionOptions {
  sessionCommand?: ChatSessionCommandEnvelope | null;
  onSessionStateChange?: (state: ChatSessionState) => void;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setToolEvents: Dispatch<SetStateAction<unknown[]>>;
  onEventsLoaded?: (events: Record<string, ToolEvent[]>) => void;
  onClearPinnedUserfiles?: () => void;
}

export function useChatSession({
  sessionCommand,
  onSessionStateChange,
  messages,
  setMessages,
  setToolEvents,
  onEventsLoaded,
  onClearPinnedUserfiles,
}: UseChatSessionOptions) {
  const [sessionId, setSessionIdRaw] = useState<string | null>(null);
  const setSessionId = useCallback((id: string | null) => {
    setSessionIdRaw(id);
    try {
      if (id) sessionStorage.setItem('devai_activeSessionId', id);
      else sessionStorage.removeItem('devai_activeSessionId');
    } catch { /* ignore */ }
  }, []);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const refreshSessions = useCallback(async (selectId?: string | null) => {
    const sessionList = await fetchSessions();
    setSessions(sessionList.sessions);
    const targetId = selectId || sessionList.sessions[0]?.id || null;
    if (targetId) {
      setSessionId(targetId);
      const history = await fetchSessionMessages(targetId);
      setMessages(history.messages);

      // Extract tool events from server-persisted messages
      if (onEventsLoaded) {
        const eventsMap: Record<string, ToolEvent[]> = {};
        for (const msg of history.messages) {
          if (msg.toolEvents && Array.isArray(msg.toolEvents) && msg.toolEvents.length > 0) {
            eventsMap[msg.id] = msg.toolEvents as ToolEvent[];
          }
        }
        if (Object.keys(eventsMap).length > 0) {
          onEventsLoaded(eventsMap);
        }
      }
    } else {
      setSessionId(null);
      setMessages([]);
    }
  }, [setSessionId, setMessages, onEventsLoaded]);

  // Initial session load — use sessionStorage (tab-scoped) so each tab
  // tracks its own active session independently.
  // New tab = no sessionStorage entry = create a fresh session.
  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setSessionsLoading(true);
      try {
        let storedId: string | null = null;
        try {
          storedId = sessionStorage.getItem('devai_activeSessionId');
        } catch { /* ignore */ }

        if (!storedId) {
          // New tab — create a fresh session
          const response = await createSession();
          storedId = response.session.id;
          try { sessionStorage.setItem('devai_activeSessionId', storedId); } catch { /* ignore */ }
        }

        await refreshSessions(storedId);
      } catch {
        // Ignore load errors
      } finally {
        if (isMounted) setSessionsLoading(false);
      }
    };
    load();
    return () => { isMounted = false; };
  }, [refreshSessions]);

  // Emit session state to parent
  useEffect(() => {
    onSessionStateChange?.({
      sessionId,
      sessions,
      sessionsLoading,
      hasMessages: messages.length > 0,
    });
  }, [sessionId, sessions, sessionsLoading, messages.length, onSessionStateChange]);

  const handleNewChat = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const response = await createSession();
      await refreshSessions(response.session.id);
      onClearPinnedUserfiles?.();
    } catch {
      // Ignore create errors
    } finally {
      setSessionsLoading(false);
    }
  }, [refreshSessions, onClearPinnedUserfiles]);

  const handleSelectSession = useCallback(async (selectedId: string) => {
    setSessionsLoading(true);
    try {
      await refreshSessions(selectedId);
    } catch {
      // Ignore select errors
    } finally {
      setSessionsLoading(false);
    }
  }, [refreshSessions]);

  const handleRestartChat = useCallback(async () => {
    if (messages.length === 0) {
      await handleNewChat();
      return;
    }

    setSessionsLoading(true);
    try {
      if (sessionId) {
        const currentSession = sessions.find((s) => s.id === sessionId);
        const currentTitle = currentSession?.title || 'Untitled';
        const timestamp = new Date().toLocaleString();
        await updateSessionTitle(sessionId, `[Restarted ${timestamp}] ${currentTitle}`);
      }
      const response = await createSession();
      await refreshSessions(response.session.id);
      setToolEvents([]);
      onClearPinnedUserfiles?.();
    } catch {
      // Ignore restart errors
    } finally {
      setSessionsLoading(false);
    }
  }, [messages.length, sessionId, sessions, handleNewChat, refreshSessions, setToolEvents, onClearPinnedUserfiles]);

  // Accept session commands from the global header
  const lastSessionCommandNonceRef = useRef<number>(0);
  useEffect(() => {
    if (!sessionCommand) return;
    if (sessionCommand.nonce === lastSessionCommandNonceRef.current) return;
    lastSessionCommandNonceRef.current = sessionCommand.nonce;

    const cmd = sessionCommand.command;
    if (cmd.type === 'select') {
      void handleSelectSession(cmd.sessionId);
    } else if (cmd.type === 'new') {
      void handleNewChat();
    } else if (cmd.type === 'restart') {
      void handleRestartChat();
    }
  }, [sessionCommand, handleSelectSession, handleNewChat, handleRestartChat]);

  const refreshSessionList = useCallback(async () => {
    const sessionList = await fetchSessions();
    setSessions(sessionList.sessions);
  }, []);

  return {
    sessionId,
    setSessionId,
    sessions,
    sessionsLoading,
    refreshSessions,
    refreshSessionList,
    handleNewChat,
    handleSelectSession,
    handleRestartChat,
  };
}
