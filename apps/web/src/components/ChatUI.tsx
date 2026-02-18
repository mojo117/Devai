import { useState, useRef, useEffect, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { sendMultiAgentMessage, fetchSessions, createSession, fetchSessionMessages, fetchSetting, saveSetting, updateSessionTitle, approveAction, rejectAction, globProjectFiles, fetchPendingActions, batchApproveActions, batchRejectActions, uploadUserfile } from '../api';
import type { ChatStreamEvent } from '../api';
import type { ChatMessage, ContextStats, SessionSummary, Action } from '../types';
import { InlineAction, type PendingAction } from './InlineAction';
import { type AgentName, type AgentPhase } from './AgentStatus';
import { useActionWebSocket } from '../hooks/useActionWebSocket';

interface ToolEvent {
  id: string;
  type: 'status' | 'tool_call' | 'tool_result' | 'thinking';
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
  agent?: AgentName;
}

export interface ChatSessionState {
  sessionId: string | null;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  hasMessages: boolean;
}

export type ChatSessionCommand =
  | { type: 'select'; sessionId: string }
  | { type: 'new' }
  | { type: 'restart' };

export interface ChatSessionCommandEnvelope {
  nonce: number;
  command: ChatSessionCommand;
}

interface ToolEventUpdate {
  type: ToolEvent['type'];
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
  chunk?: string;
  agent?: AgentName;
}

interface ChatUIProps {
  projectRoot?: string | null;
  skillIds?: string[];
  allowedRoots?: string[];
  pinnedFiles?: string[];
  ignorePatterns?: string[];
  projectContextOverride?: { enabled: boolean; summary: string };
  onPinFile?: (file: string) => void;
  onContextUpdate?: (stats: ContextStats) => void;
  onLoadingChange?: (loading: boolean) => void;
  onAgentChange?: (agent: AgentName | null, phase: AgentPhase) => void;
  /** When true, session controls are expected to live in the global header. */
  showSessionControls?: boolean;
  sessionCommand?: ChatSessionCommandEnvelope | null;
  onSessionStateChange?: (state: ChatSessionState) => void;
}

export function ChatUI({
  projectRoot,
  skillIds,
  allowedRoots,
  pinnedFiles,
  ignorePatterns,
  projectContextOverride,
  onPinFile,
  onContextUpdate,
  onLoadingChange,
  onAgentChange,
  showSessionControls = true,
  sessionCommand,
  onSessionStateChange,
}: ChatUIProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoadingInternal] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Wrapper to emit loading changes
  const setIsLoading = (loading: boolean) => {
    setIsLoadingInternal(loading);
    onLoadingChange?.(loading);
  };
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);

  const debug = import.meta.env.DEV && Boolean((window as any).__DEVAI_DEBUG);
  useEffect(() => {
    if (!debug) return;
    console.log('[ChatUI] pendingActions changed:', pendingActions.length, pendingActions);
  }, [debug, pendingActions]);

  const [fileHints, setFileHints] = useState<string[]>([]);
  const [fileHintsLoading, setFileHintsLoading] = useState(false);
  const [fileHintsError, setFileHintsError] = useState<string | null>(null);
  const [activeHintIndex, setActiveHintIndex] = useState(0);
  const [retryState, setRetryState] = useState<null | {
    input: string;
    userMessage: ChatMessage;
    runRequest: () => Promise<{ message: ChatMessage; sessionId?: string } | null>;
  }>(null);

  // Inline system events state
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  const toggleEventExpanded = useCallback((eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  // Agent state
  const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  // Notify parent of agent changes
  useEffect(() => {
    onAgentChange?.(activeAgent, agentPhase);
  }, [activeAgent, agentPhase, onAgentChange]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFileUploading, setIsFileUploading] = useState(false);

  const refreshSessions = async (selectId?: string | null) => {
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
  };

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setSessionsLoading(true);
      try {
        const stored = await fetchSetting('lastSessionId');
        const storedId = typeof stored.value === 'string' ? stored.value : null;
        await refreshSessions(storedId);
      } catch {
        // Ignore load errors for now.
      } finally {
        if (isMounted) {
          setSessionsLoading(false);
        }
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Emit session state to parent (for header controls)
  useEffect(() => {
    onSessionStateChange?.({
      sessionId,
      sessions,
      sessionsLoading,
      hasMessages: messages.length > 0,
    });
  }, [sessionId, sessions, sessionsLoading, messages.length, onSessionStateChange]);

  // Persist tool events to localStorage (keyed by sessionId)
  useEffect(() => {
    if (!sessionId || toolEvents.length === 0) return;
    try {
      const key = `devai_feed_${sessionId}`;
      // Keep only last 100 events to avoid localStorage bloat
      const toStore = toolEvents.slice(-100);
      localStorage.setItem(key, JSON.stringify(toStore));
    } catch {
      // Ignore storage errors
    }
  }, [sessionId, toolEvents]);

  // Load persisted tool events when session changes
  useEffect(() => {
    if (!sessionId) return;
    try {
      const key = `devai_feed_${sessionId}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as ToolEvent[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setToolEvents(parsed);
        }
      } else {
        // New session or no stored events, clear current events
        setToolEvents([]);
      }
    } catch {
      // Ignore parse errors
    }
  }, [sessionId]);

  // WebSocket handlers for real-time action updates
  const handleActionPending = useCallback((action: Action) => {
    if (debug) console.log('[ChatUI] handleActionPending called:', action);
    setPendingActions((prev) => {
      // Check if action already exists
      if (prev.some((a) => a.actionId === action.id)) {
        return prev;
      }
      return [
        ...prev,
        {
          actionId: action.id,
          toolName: action.toolName,
          toolArgs: action.toolArgs,
          description: action.description,
          preview: action.preview,
        },
      ];
    });
  }, []);

  const handleActionUpdated = useCallback((action: Action) => {
    // Remove from pending if no longer pending
    if (action.status !== 'pending') {
      setPendingActions((prev) => prev.filter((a) => a.actionId !== action.id));
    }
  }, []);

  const handleInitialSync = useCallback((actions: Action[]) => {
    setPendingActions((prev) => {
      const existingIds = new Set(prev.map((a) => a.actionId));
      const newActions = actions
        .filter((a) => a.status === 'pending' && !existingIds.has(a.id))
        .map((a) => ({
          actionId: a.id,
          toolName: a.toolName,
          toolArgs: a.toolArgs,
          description: a.description,
          preview: a.preview,
        }));

      if (newActions.length > 0) {
        return [...prev, ...newActions];
      }
      return prev;
    });
  }, []);

  // Connect to WebSocket for real-time action updates
  const { isConnected: wsConnected, connectionState: _wsState } = useActionWebSocket({
    sessionId: sessionId || undefined,
    onActionPending: handleActionPending,
    onActionUpdated: handleActionUpdated,
    onInitialSync: handleInitialSync,
    enabled: true,
  });

  // Fallback polling for when WebSocket is disconnected (recovers missed events)
  useEffect(() => {
    // Skip polling if WebSocket is connected
    if (wsConnected) return;

    let isMounted = true;

    const syncPendingActions = async () => {
      try {
        const data = await fetchPendingActions();
        if (!isMounted) return;

        // Merge with existing pending actions (avoid duplicates)
        setPendingActions((prev) => {
          const existingIds = new Set(prev.map((a) => a.actionId));
          const newActions = data.actions
            .filter((a) => !existingIds.has(a.id))
            .map((a) => ({
              actionId: a.id,
              toolName: a.toolName,
              toolArgs: a.toolArgs,
              description: a.description,
              preview: a.preview,
            }));

          if (newActions.length > 0) {
            return [...prev, ...newActions];
          }
          return prev;
        });
      } catch {
        // Silently ignore polling errors
      }
    };

    // Initial sync on mount
    syncPendingActions();

    // Poll every 5 seconds (less frequent since WebSocket is primary)
    const interval = setInterval(syncPendingActions, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [wsConnected]);

  useEffect(() => {
    const token = extractAtToken(input);
    if (!token) {
      setFileHints([]);
      setFileHintsError(null);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setFileHintsLoading(true);
      setFileHintsError(null);
      try {
        const basePath = allowedRoots && allowedRoots.length > 0 ? allowedRoots[0] : undefined;
        const safeToken = escapeGlob(token.value);
        const pattern = `**/*${safeToken}*`;
        const data = await globProjectFiles(pattern, basePath, ignorePatterns);
        if (cancelled) return;
        const files = data.files.slice(0, 20);
        setFileHints(files);
        setActiveHintIndex(0);
      } catch (err) {
        if (cancelled) return;
        setFileHints([]);
        setFileHintsError(err instanceof Error ? err.message : 'Failed to load file hints');
      } finally {
        if (!cancelled) setFileHintsLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [input, allowedRoots, ignorePatterns]);

  // Handle agent stream events
  const handleAgentEvent = (event: ChatStreamEvent) => {
    switch (event.type) {
      case 'agent_start':
        setActiveAgent(event.agent as AgentName);
        setAgentPhase(event.phase as AgentPhase);
        break;
      case 'agent_switch':
        setActiveAgent(event.to as AgentName);
        break;
      case 'agent_thinking':
        setAgentPhase('thinking');
        // Add thinking event to feed for debugging
        setToolEvents((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: 'thinking',
            result: event.status,
            agent: event.agent as AgentName | undefined,
          },
        ]);
        break;
      case 'agent_complete':
        setAgentPhase('idle');
        break;
      case 'agent_history':
        break;
      case 'delegation':
        // Could show delegation notification
        break;
      case 'escalation':
        // Could show escalation notification
        break;
      case 'parallel_start':
        setAgentPhase('executing');
        break;
      case 'parallel_complete':
        setAgentPhase('idle');
        break;
    }
  };

  const handleStreamEvent = (event: ChatStreamEvent) => {
    // Handle agent-specific events
    handleAgentEvent(event);

    const eventAgent = (event.agent as AgentName | undefined) || activeAgent || undefined;
    const type = String(event.type || '');

    switch (type) {
      case 'status': {
        setToolEvents((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: 'status',
            result: (event as any).status,
            agent: eventAgent,
          },
        ]);
        break;
      }
      case 'tool_call': {
        const id = String((event as any).id || crypto.randomUUID());
        const name = ((event as any).toolName as string | undefined) || ((event as any).name as string | undefined);
        const args = (event as any).args ?? (event as any).arguments;
        upsertToolEvent(setToolEvents, id, {
          type: 'tool_call',
          name,
          arguments: args,
          agent: eventAgent,
        });
        break;
      }
      case 'tool_result_chunk': {
        const id = String((event as any).id || crypto.randomUUID());
        const name = ((event as any).toolName as string | undefined) || ((event as any).name as string | undefined);
        const chunk = typeof (event as any).chunk === 'string' ? (event as any).chunk : '';
        upsertToolEvent(setToolEvents, id, {
          type: 'tool_result',
          name,
          chunk,
          agent: eventAgent,
        });
        break;
      }
      case 'tool_result': {
        const id = String((event as any).id || crypto.randomUUID());
        const name = ((event as any).toolName as string | undefined) || ((event as any).name as string | undefined);
        const result = (event as any).result ?? { result: (event as any).result, success: (event as any).success };
        upsertToolEvent(setToolEvents, id, {
          type: 'tool_result',
          name,
          result,
          completed: Boolean((event as any).completed),
          agent: eventAgent,
        });
        break;
      }
      case 'action_pending': {
        if (debug) console.log('[ChatUI] Stream action_pending event:', event);
        const pendingAction: PendingAction = {
          actionId: (event as any).actionId as string,
          toolName: (event as any).toolName as string,
          toolArgs: (event as any).toolArgs as Record<string, unknown>,
          description: (event as any).description as string,
          preview: (event as any).preview as PendingAction['preview'],
        };
        setPendingActions((prev) => {
          if (prev.some((a) => a.actionId === pendingAction.actionId)) {
            return prev;
          }
          return [...prev, pendingAction];
        });
        break;
      }
      case 'approval_request': {
        break;
      }
      case 'user_question': {
        break;
      }
      case 'context_stats': {
        if (onContextUpdate) {
          const stats = (event as any).stats as ContextStats | undefined;
          if (stats) onContextUpdate(stats);
        }
        break;
      }
      default:
        break;
    }
  };

  const sendChatMessage = async (content: string) => {
    if (isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setToolEvents([]);
    setFileHints([]);

    // Reset agent state when starting new message
    setAgentPhase('idle');
    setActiveAgent(null);

    const runRequest = async (): Promise<{ message: ChatMessage; sessionId?: string } | null> => {
      const response = await sendMultiAgentMessage(
        content,
        projectRoot || undefined,
        sessionId || undefined,
        handleStreamEvent
      );

      if (response.sessionId) {
        setSessionId(response.sessionId);
        await saveSetting('lastSessionId', response.sessionId);
      }
      setMessages((prev) => [...prev, response.message]);
      await refreshSessions(response.sessionId);
      return { message: response.message, sessionId: response.sessionId };
    };

    try {
      await runRequest();
      setRetryState(null);
    } catch (error) {
      const err = error instanceof Error ? error.message : 'Unknown error';
      const shouldRetry = /network|fetch|timeout|503|502|504|tempor/i.test(err);

      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err}${shouldRetry ? '\\n\\nYou can retry the last message below.' : ''}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);

      if (shouldRetry) {
        setRetryState({
          input: content,
          userMessage,
          runRequest,
        });
      } else {
        setRetryState(null);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const content = input.trim();
    setInput('');
    await sendChatMessage(content);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsFileUploading(true);
    for (const file of Array.from(files)) {
      try {
        await uploadUserfile(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: 'system' as const, content: `Upload failed: ${msg}`, timestamp: new Date().toISOString() },
        ]);
      }
    }
    setIsFileUploading(false);
    e.target.value = '';
    setMessages((prev) => [
      ...prev,
      { id: `upload-${Date.now()}`, role: 'system' as const, content: `${files.length} file${files.length > 1 ? 's' : ''} uploaded to /opt/Userfiles`, timestamp: new Date().toISOString() },
    ]);
  };

  const handleRetry = async () => {
    if (!retryState) return;
    setIsLoading(true);
    setToolEvents([]);
    try {
      await retryState.runRequest();
      setRetryState(null);
    } catch (error) {
      const err = error instanceof Error ? error.message : 'Unknown error';
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = async () => {
    setSessionsLoading(true);
    try {
      const response = await createSession();
      await saveSetting('lastSessionId', response.session.id);
      await refreshSessions(response.session.id);
    } catch {
      // Ignore create errors for now.
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleSelectSession = async (selectedId: string) => {
    setSessionsLoading(true);
    try {
      await saveSetting('lastSessionId', selectedId);
      await refreshSessions(selectedId);
    } catch {
      // Ignore select errors for now.
    } finally {
      setSessionsLoading(false);
    }
  };

  const handlePickHint = (hint: string) => {
    const token = extractAtToken(input);
    if (!token) return;
    const before = input.slice(0, token.start);
    const after = input.slice(token.end);
    const next = `${before}@${hint} ${after}`.replace(/\s{2,}/g, ' ');
    setInput(next);
    setFileHints([]);
    if (onPinFile) {
      onPinFile(hint);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (fileHints.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveHintIndex((prev) => (prev + 1) % fileHints.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveHintIndex((prev) => (prev - 1 + fileHints.length) % fileHints.length);
    } else if (e.key === 'Enter') {
      const token = extractAtToken(input);
      if (token && fileHints[activeHintIndex]) {
        e.preventDefault();
        handlePickHint(fileHints[activeHintIndex]);
      }
    } else if (e.key === 'Escape') {
      setFileHints([]);
    }
  };

  const handleApproveAction = async (actionId: string) => {
    const pendingAction = pendingActions.find((a) => a.actionId === actionId);
    const response = await approveAction(actionId);

    // Add result to chat as a message
    const resultMessage: ChatMessage = {
      id: `action-result-${actionId}`,
      role: 'assistant',
      content: response.action.error
        ? `**Action failed:** ${pendingAction?.description || response.action.toolName}\n\nError: ${response.action.error}`
        : `**Action completed:** ${pendingAction?.description || response.action.toolName}\n\n${response.result ? '```json\n' + JSON.stringify(response.result, null, 2) + '\n```' : 'Success'}`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, resultMessage]);

    // Remove from pending list after a short delay to show the approved state
    setTimeout(() => {
      setPendingActions((prev) => prev.filter((a) => a.actionId !== actionId));
    }, 1000);
  };

  const handleRejectAction = async (actionId: string) => {
    const pendingAction = pendingActions.find((a) => a.actionId === actionId);
    await rejectAction(actionId);

    // Add rejection to chat
    const rejectMessage: ChatMessage = {
      id: `action-rejected-${actionId}`,
      role: 'assistant',
      content: `**Action rejected:** ${pendingAction?.description || 'Unknown action'}`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, rejectMessage]);

    // Remove from pending list after a short delay to show the rejected state
    setTimeout(() => {
      setPendingActions((prev) => prev.filter((a) => a.actionId !== actionId));
    }, 1000);
  };

  // Approvals/questions are handled via normal chat input (no separate UI).

  const handleBatchApprove = async () => {
    if (pendingActions.length === 0) return;

    const actionIds = pendingActions.map((a) => a.actionId);
    const actionDescriptions = new Map(pendingActions.map((a) => [a.actionId, a.description]));

    try {
      const response = await batchApproveActions(actionIds);

      // Build detailed result message
      const succeeded = response.results.filter((r) => r.success);
      const failed = response.results.filter((r) => !r.success);

      let content = `**Batch Approval Results:**\n\n`;

      if (succeeded.length > 0) {
        content += `**${succeeded.length} action(s) completed:**\n`;
        for (const r of succeeded) {
          const desc = actionDescriptions.get(r.actionId) || r.actionId;
          content += `- ${desc}\n`;
        }
        content += '\n';
      }

      if (failed.length > 0) {
        content += `**${failed.length} action(s) failed:**\n`;
        for (const r of failed) {
          const desc = actionDescriptions.get(r.actionId) || r.actionId;
          content += `- ${desc}: ${r.error || 'Unknown error'}\n`;
        }
      }

      const batchMessage: ChatMessage = {
        id: `batch-approved-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, batchMessage]);

      // Clear all pending actions
      setTimeout(() => {
        setPendingActions([]);
      }, 500);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `batch-error-${Date.now()}`,
        role: 'assistant',
        content: `**Batch approval failed:** ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  };

  const handleBatchReject = async () => {
    if (pendingActions.length === 0) return;

    const actionIds = pendingActions.map((a) => a.actionId);

    try {
      await batchRejectActions(actionIds);

      const batchMessage: ChatMessage = {
        id: `batch-rejected-${Date.now()}`,
        role: 'assistant',
        content: `**Batch rejected:** ${actionIds.length} action(s) rejected`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, batchMessage]);

      // Clear all pending actions
      setTimeout(() => {
        setPendingActions([]);
      }, 500);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `batch-error-${Date.now()}`,
        role: 'assistant',
        content: `**Batch rejection failed:** ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  };

  const handleCopyMessage = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = content;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  };

  const handleRestartChat = async () => {
    if (messages.length === 0) {
      // No messages to save, just create new session
      await handleNewChat();
      return;
    }

    setSessionsLoading(true);
    try {
      // Mark the current session as restarted if it has messages
      if (sessionId) {
        const currentSession = sessions.find((s) => s.id === sessionId);
        const currentTitle = currentSession?.title || 'Untitled';
        const timestamp = new Date().toLocaleString();
        await updateSessionTitle(sessionId, `[Restarted ${timestamp}] ${currentTitle}`);
      }

      // Create a new session
      const response = await createSession();
      await saveSetting('lastSessionId', response.session.id);
      await refreshSessions(response.session.id);
      setToolEvents([]);
    } catch {
      // Ignore restart errors for now.
    } finally {
      setSessionsLoading(false);
    }
  };

  // Accept session commands from the global header.
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {showSessionControls && (
          <div className="flex items-center justify-between text-xs text-devai-text-secondary">
            <div className="flex items-center gap-2">
              <span>Session</span>
              <select
                value={sessionId || ''}
                onChange={(e) => handleSelectSession(e.target.value)}
                disabled={sessionsLoading || sessions.length === 0}
                className="bg-devai-card border border-devai-border rounded px-2 py-1 text-xs text-devai-text"
              >
                {sessions.length === 0 && (
                  <option value="">No sessions</option>
                )}
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title ? session.title : session.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRestartChat}
                disabled={sessionsLoading || messages.length === 0}
                className="text-[11px] text-devai-accent hover:text-devai-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                title="Save current conversation to history and start fresh"
              >
                {sessionsLoading ? 'Loading...' : 'Restart Chat'}
              </button>
              <button
                onClick={handleNewChat}
                disabled={sessionsLoading}
                className="text-[11px] text-devai-text-secondary hover:text-devai-text disabled:opacity-50"
              >
                {sessionsLoading ? 'Loading...' : 'New Chat'}
              </button>
            </div>
          </div>
        )}


        {messages.length === 0 && (
          <div className="text-center text-devai-text-muted mt-8">
            <p className="text-lg">Welcome to DevAI</p>
            <p className="text-sm mt-2">
              Start a conversation to get help with your code.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`group relative max-w-[80%] px-4 py-2.5 ${
                message.role === 'user'
                  ? 'bg-devai-accent text-white rounded-2xl rounded-br-sm'
                  : 'bg-devai-card text-devai-text rounded-2xl rounded-bl-sm border border-devai-border'
              }`}
            >
              <button
                onClick={() => handleCopyMessage(message.id, message.content)}
                className={`absolute top-2 right-2 p-1 rounded transition-all ${
                  copiedMessageId === message.id
                    ? 'opacity-100 text-green-400'
                    : 'opacity-0 group-hover:opacity-100 text-devai-text-muted hover:text-devai-text'
                }`}
                title={copiedMessageId === message.id ? 'Copied!' : 'Copy message'}
              >
                {copiedMessageId === message.id ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
              <div className="pr-6">
                {renderMessageContent(message.content)}
              </div>
              <p className={`text-xs mt-1 ${
                message.role === 'user' ? 'opacity-60' : 'text-devai-text-muted'
              }`}>
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {/* Inline System Events */}
        {toolEvents.length > 0 && (
          <div className="space-y-1.5">
            {toolEvents.slice(-10).map((event) => (
              <InlineSystemEvent
                key={event.id}
                event={event}
                isExpanded={expandedEvents.has(event.id)}
                onToggle={() => toggleEventExpanded(event.id)}
              />
            ))}
          </div>
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-devai-card border border-devai-border rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex space-x-1.5">
                <span className="w-2 h-2 bg-devai-accent rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-devai-accent rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <span className="w-2 h-2 bg-devai-accent rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          </div>
        )}

      <div ref={messagesEndRef} />
    </div>

      {/* Pending Actions - Fixed above input, always visible */}
      {pendingActions.length > 0 && (
        <div className="border-t border-devai-border px-4 py-2 space-y-2">
          {/* Batch action buttons when multiple actions pending */}
          {pendingActions.length > 1 && (
            <div className="flex items-center justify-between bg-devai-card rounded-lg px-3 py-2 mb-2">
              <span className="text-xs text-devai-text-secondary">
                {pendingActions.length} actions pending
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleBatchApprove}
                  className="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded font-medium transition-colors"
                >
                  Approve All
                </button>
                <button
                  onClick={handleBatchReject}
                  className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded font-medium transition-colors"
                >
                  Reject All
                </button>
              </div>
            </div>
          )}
          {pendingActions.map((action) => (
            <InlineAction
              key={action.actionId}
              action={action}
              onApprove={handleApproveAction}
              onReject={handleRejectAction}
            />
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-devai-border p-4">
        {retryState && !isLoading && (
          <div className="mb-2 flex items-center justify-between bg-devai-card border border-devai-border rounded px-3 py-2 text-xs text-devai-text-secondary">
            <span>Last message failed.</span>
            <button
              type="button"
              onClick={handleRetry}
              className="text-devai-accent hover:text-devai-accent-hover"
            >
              Retry
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Type your message... (use @ to quick-open files)"
              disabled={isLoading}
              className="w-full bg-devai-card border border-devai-border rounded-xl px-4 py-2.5 text-devai-text placeholder-devai-text-muted focus:outline-none focus:border-devai-border-light focus:ring-1 focus:ring-devai-accent/30 disabled:opacity-50"
            />
            {fileHints.length > 0 && (
              <div className="absolute bottom-12 left-0 right-0 bg-devai-surface border border-devai-border rounded-lg shadow-lg max-h-48 overflow-y-auto text-xs">
                {fileHints.map((hint, idx) => (
                  <button
                    type="button"
                    key={hint}
                    onClick={() => handlePickHint(hint)}
                    className={`w-full text-left px-3 py-2 ${
                      idx === activeHintIndex ? 'bg-devai-card text-devai-text' : 'text-devai-text-secondary hover:bg-devai-card'
                    }`}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            )}
            {fileHintsLoading && (
              <div className="absolute bottom-12 left-0 right-0 text-[10px] text-devai-text-muted bg-devai-surface border border-devai-border rounded-lg px-3 py-2">
                Searching files...
              </div>
            )}
            {fileHintsError && (
              <div className="absolute bottom-12 left-0 right-0 text-[10px] text-red-300 bg-devai-surface border border-devai-border rounded-lg px-3 py-2">
                {fileHintsError}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-devai-accent hover:bg-devai-accent-hover disabled:bg-devai-border disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-medium transition-colors"
          >
            Send
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileUpload}
            multiple
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isFileUploading}
            className="bg-devai-card hover:bg-devai-card/80 border border-devai-border text-devai-text-secondary hover:text-devai-text disabled:opacity-50 px-3 py-2.5 rounded-xl transition-colors"
            title="Upload files to /opt/Userfiles"
          >
            {isFileUploading ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Inline System Event - compact badge shown in the chat stream */
function InlineSystemEvent({
  event,
  isExpanded,
  onToggle,
}: {
  event: ToolEvent;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const getEventLabel = () => {
    if (event.type === 'thinking') return 'Thinking...';
    if (event.type === 'status') return String(event.result || 'Status');
    if (event.type === 'tool_call') return `Using: ${event.name || 'tool'}`;
    if (event.type === 'tool_result') return `Result: ${event.name || 'tool'}`;
    return event.type;
  };

  const getEventColor = () => {
    if (event.type === 'thinking') return 'border-cyan-500/30 bg-cyan-500/5 text-cyan-400';
    if (event.type === 'tool_call') return 'border-devai-accent/30 bg-devai-accent/5 text-devai-accent';
    if (event.type === 'tool_result') return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400';
    return 'border-devai-border bg-devai-surface/50 text-devai-text-secondary';
  };

  const hasContent = event.arguments || event.result;

  return (
    <div className="flex justify-center">
      <div
        className={`inline-flex flex-col rounded-lg border text-xs ${getEventColor()} max-w-[90%]`}
      >
        <button
          onClick={hasContent ? onToggle : undefined}
          className={`flex items-center gap-2 px-3 py-1.5 ${hasContent ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          {event.type === 'thinking' && (
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          )}
          {event.type === 'tool_call' && <span className="text-[10px]">&#9654;</span>}
          {event.type === 'tool_result' && <span className="text-[10px]">&#9664;</span>}
          <span className="font-mono text-[11px]">{getEventLabel()}</span>
          {hasContent && (
            <span className="text-[10px] opacity-60">{isExpanded ? '▲' : '▼'}</span>
          )}
        </button>
        {isExpanded && hasContent && (
          <div className="border-t border-current/10 px-3 py-2">
            <pre className="text-[10px] text-devai-text-secondary whitespace-pre-wrap break-all font-mono max-h-32 overflow-y-auto">
              {formatPayloadCompact(event.arguments || event.result)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function renderMessageContent(content: string) {
  // Simple markdown-like rendering for bold, code blocks, and inline code
  const parts = content.split(/(```[\s\S]*?```|\*\*.*?\*\*|`[^`]+`)/g);

  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((part, i) => {
        // Code block
        if (part.startsWith('```') && part.endsWith('```')) {
          const codeContent = part.slice(3, -3);
          // Strip optional language identifier from first line
          const firstNewline = codeContent.indexOf('\n');
          const code = firstNewline > -1 ? codeContent.slice(firstNewline + 1) : codeContent;
          return (
            <pre key={i} className="bg-devai-bg border border-devai-border rounded-lg p-3 my-2 text-xs overflow-x-auto font-mono text-devai-text-secondary">
              {code}
            </pre>
          );
        }
        // Bold
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        // Inline code
        if (part.startsWith('`') && part.endsWith('`') && !part.startsWith('```')) {
          return (
            <code key={i} className="bg-devai-bg border border-devai-border rounded px-1.5 py-0.5 text-xs font-mono text-devai-accent">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}

function formatPayloadCompact(payload: unknown): string {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    if (text.length > 300) {
      return `${text.slice(0, 300)}\n...`;
    }
    return text;
  } catch {
    return String(payload);
  }
}

function extractAtToken(input: string): { value: string; start: number; end: number } | null {
  const atIndex = input.lastIndexOf('@');
  if (atIndex === -1) return null;
  const after = input.slice(atIndex + 1);
  const match = after.match(/^[^\s]*/);
  if (!match) return null;
  return {
    value: match[0],
    start: atIndex,
    end: atIndex + 1 + match[0].length,
  };
}

function escapeGlob(value: string): string {
  return value.replace(/([\\*?[\]{}()!])/g, '\\$1');
}

function upsertToolEvent(
  setToolEvents: Dispatch<SetStateAction<ToolEvent[]>>,
  id: string,
  update: ToolEventUpdate
) {
  setToolEvents((prev) => {
    const index = prev.findIndex((event) => event.id === id);
    if (index === -1) {
      const initial: ToolEvent = {
        id,
        type: update.type,
        name: update.name,
        arguments: update.arguments,
        result: update.chunk || update.result,
        completed: update.completed,
        agent: update.agent,
      };
      return [...prev, initial];
    }

    const existing = prev[index];
    const next: ToolEvent = {
      ...existing,
      type: update.type ?? existing.type,
      name: update.name ?? existing.name,
      arguments: update.arguments ?? existing.arguments,
      completed: update.completed ?? existing.completed,
      result: update.result ?? existing.result,
      agent: update.agent ?? existing.agent,
    };

    if (update.chunk) {
      const current = typeof existing.result === 'string' ? existing.result : '';
      next.result = current + update.chunk;
    }

    const copy = [...prev];
    copy[index] = next;
    return copy;
  });
}
