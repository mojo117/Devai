import { useState, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { fetchSessions, createSession, fetchSessionMessages, fetchSetting, saveSetting, updateSessionTitle } from '../../../api';
import type { ChatMessage, SessionSummary } from '../../../types';
import type { ChatSessionState, ChatSessionCommandEnvelope } from '../types';

interface UseChatSessionOptions {
  sessionCommand?: ChatSessionCommandEnvelope | null;
  onSessionStateChange?: (state: ChatSessionState) => void;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setToolEvents: Dispatch<SetStateAction<unknown[]>>;
}

export function useChatSession({
  sessionCommand,
  onSessionStateChange,
  messages,
  setMessages,
  setToolEvents,
}: UseChatSessionOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
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
    } else {
      setSessionId(null);
      setMessages([]);
    }
  }, [setMessages]);

  // Initial session load
  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setSessionsLoading(true);
      try {
        const stored = await fetchSetting('lastSessionId');
        const storedId = typeof stored.value === 'string' ? stored.value : null;
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
      await saveSetting('lastSessionId', response.session.id);
      await refreshSessions(response.session.id);
    } catch {
      // Ignore create errors
    } finally {
      setSessionsLoading(false);
    }
  }, [refreshSessions]);

  const handleSelectSession = useCallback(async (selectedId: string) => {
    setSessionsLoading(true);
    try {
      await saveSetting('lastSessionId', selectedId);
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
      await saveSetting('lastSessionId', response.session.id);
      await refreshSessions(response.session.id);
      setToolEvents([]);
    } catch {
      // Ignore restart errors
    } finally {
      setSessionsLoading(false);
    }
  }, [messages.length, sessionId, sessions, handleNewChat, refreshSessions, setToolEvents]);

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

  return {
    sessionId,
    setSessionId,
    sessions,
    sessionsLoading,
    refreshSessions,
    handleNewChat,
    handleSelectSession,
    handleRestartChat,
  };
}
