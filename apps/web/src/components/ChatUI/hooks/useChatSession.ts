import { useState, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { fetchSessions, fetchSessionMessages, updateSessionTitle, deleteSession } from '../../../api';
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
  // New tab = no sessionStorage entry = start with a blank slate (session
  // gets created server-side when the first message is sent).
  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setSessionsLoading(true);
      try {
        let storedId: string | null = null;
        try {
          storedId = sessionStorage.getItem('devai_activeSessionId');
        } catch { /* ignore */ }

        if (storedId) {
          await refreshSessions(storedId);
        } else {
          // New tab — just load the session list, don't create one yet.
          // A session will be created automatically when the user sends
          // their first message.
          const sessionList = await fetchSessions();
          if (isMounted) setSessions(sessionList.sessions);
          // If there are existing sessions, select the first one
          if (sessionList.sessions.length > 0) {
            await refreshSessions(sessionList.sessions[0].id);
          } else {
            if (isMounted) {
              setSessionId(null);
              setMessages([]);
            }
          }
        }
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
    // Don't create a session in the DB yet — just reset local state.
    // The session will be created server-side when the user sends their
    // first message (sendMultiAgentMessage with no sessionId).
    setSessionId(null);
    setMessages([]);
    setToolEvents([]);
    onClearPinnedUserfiles?.();
  }, [setSessionId, setMessages, setToolEvents, onClearPinnedUserfiles]);

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
      handleNewChat();
      return;
    }

    setSessionsLoading(true);
    try {
      if (sessionId) {
        const currentSession = sessions.find((s) => s.id === sessionId);
        const baseTitle = (currentSession?.title || 'Untitled').replace(/^\[Restarted[^\]]*\]\s*/g, '');
        const timestamp = new Date().toLocaleTimeString();
        await updateSessionTitle(sessionId, `${baseTitle} [${timestamp}]`);
      }
      // Reset to blank — session will be created when first message is sent
      setSessionId(null);
      setMessages([]);
      setToolEvents([]);
      onClearPinnedUserfiles?.();
    } catch {
      // Ignore restart errors
    } finally {
      setSessionsLoading(false);
    }
  }, [messages.length, sessionId, sessions, handleNewChat, setSessionId, setMessages, setToolEvents, onClearPinnedUserfiles]);

  const handleDeleteSession = useCallback(async () => {
    if (!sessionId) return;
    setSessionsLoading(true);
    try {
      await deleteSession(sessionId);
      const sessionList = await fetchSessions();
      setSessions(sessionList.sessions);
      if (sessionList.sessions.length > 0) {
        await refreshSessions(sessionList.sessions[0].id);
      } else {
        // No sessions left — reset to blank
        setSessionId(null);
        setMessages([]);
      }
      setToolEvents([]);
      onClearPinnedUserfiles?.();
    } catch {
      // Ignore delete errors
    } finally {
      setSessionsLoading(false);
    }
  }, [sessionId, refreshSessions, setSessionId, setMessages, setToolEvents, onClearPinnedUserfiles]);

  const refreshSessionList = useCallback(async () => {
    const sessionList = await fetchSessions();
    setSessions(sessionList.sessions);
  }, []);

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
    } else if (cmd.type === 'delete') {
      void handleDeleteSession();
    } else if (cmd.type === 'rename') {
      void (async () => {
        try {
          await updateSessionTitle(cmd.sessionId, cmd.title);
          await refreshSessionList();
        } catch {
          // Ignore rename errors
        }
      })();
    }
  }, [sessionCommand, handleSelectSession, handleNewChat, handleRestartChat, handleDeleteSession, refreshSessionList]);

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
    handleDeleteSession,
  };
}
