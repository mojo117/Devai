import { useState, useRef, useEffect, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { sendMessage, sendMultiAgentMessage, sendAgentApproval, fetchSessions, createSession, fetchSessionMessages, fetchSetting, saveSetting, updateSessionTitle, approveAction, rejectAction, globProjectFiles, fetchPendingActions, batchApproveActions, batchRejectActions, fetchAgentState } from '../api';
import type { ChatStreamEvent } from '../api';
import type { ChatMessage, ContextStats, LLMProvider, SessionSummary, Action } from '../types';
import type { AgentHistoryEntry } from '../api';
import { InlineAction, type PendingAction } from './InlineAction';
import { InlineApproval, type PendingApproval } from './InlineApproval';
import { AgentStatus, type AgentName, type AgentPhase } from './AgentStatus';
import { AgentHistory, AgentTimeline } from './AgentHistory';
import { useActionWebSocket } from '../hooks/useActionWebSocket';

export interface ToolEvent {
  id: string;
  type: 'status' | 'tool_call' | 'tool_result';
  name?: string;
  arguments?: unknown;
  result?: unknown;
  completed?: boolean;
  agent?: AgentName;
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
  provider: LLMProvider;
  projectRoot?: string | null;
  skillIds?: string[];
  allowedRoots?: string[];
  pinnedFiles?: string[];
  ignorePatterns?: string[];
  projectContextOverride?: { enabled: boolean; summary: string };
  onPinFile?: (file: string) => void;
  onContextUpdate?: (stats: ContextStats) => void;
  onToolEvent?: (events: ToolEvent[]) => void;
  onLoadingChange?: (loading: boolean) => void;
  clearFeedTrigger?: number; // Increment to trigger feed clear
}

export function ChatUI({ provider, projectRoot, skillIds, allowedRoots, pinnedFiles, ignorePatterns, projectContextOverride, onPinFile, onContextUpdate, onToolEvent, onLoadingChange, clearFeedTrigger }: ChatUIProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoadingInternal] = useState(false);

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
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

  // Debug: log pendingActions changes
  useEffect(() => {
    console.log('[ChatUI] pendingActions changed:', pendingActions.length, pendingActions);
  }, [pendingActions]);
  useEffect(() => {
    console.log('[ChatUI] pendingApprovals changed:', pendingApprovals.length, pendingApprovals);
  }, [pendingApprovals]);

  const [fileHints, setFileHints] = useState<string[]>([]);
  const [fileHintsLoading, setFileHintsLoading] = useState(false);
  const [fileHintsError, setFileHintsError] = useState<string | null>(null);
  const [activeHintIndex, setActiveHintIndex] = useState(0);
  const [retryState, setRetryState] = useState<null | {
    input: string;
    userMessage: ChatMessage;
    runRequest: () => Promise<{ message: ChatMessage; sessionId?: string } | null>;
  }>(null);

  // Multi-agent mode state
  const [multiAgentMode] = useState(true);
  const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  const [agentHistory, setAgentHistory] = useState<AgentHistoryEntry[]>([]);
  const [showAgentHistory, setShowAgentHistory] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!sessionId || !multiAgentMode) {
      setPendingApprovals([]);
      return;
    }
    try {
      const stored = localStorage.getItem(`devai_pending_approvals_${sessionId}`);
      if (stored) {
        const parsed = JSON.parse(stored) as PendingApproval[];
        if (Array.isArray(parsed)) {
          setPendingApprovals(parsed);
          return;
        }
      }
    } catch {
      // Ignore localStorage errors.
    }
    setPendingApprovals([]);
  }, [sessionId, multiAgentMode]);

  useEffect(() => {
    if (!sessionId || !multiAgentMode) return;
    try {
      const key = `devai_pending_approvals_${sessionId}`;
      if (pendingApprovals.length === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(pendingApprovals));
      }
    } catch {
      // Ignore localStorage errors.
    }
  }, [pendingApprovals, sessionId, multiAgentMode]);

  useEffect(() => {
    if (!multiAgentMode || !sessionId) return;
    let cancelled = false;
    const loadApprovals = async () => {
      try {
        const state = await fetchAgentState(sessionId);
        if (cancelled) return;
        if (Array.isArray(state.pendingApprovals)) {
          const approvals = (state.pendingApprovals as PendingApproval[]).map((approval) => ({
            ...approval,
            sessionId,
          }));
          setPendingApprovals(approvals);
        }
      } catch {
        // Ignore state load errors for now.
      }
    };
    loadApprovals();
    return () => {
      cancelled = true;
    };
  }, [multiAgentMode, sessionId]);

  // Emit tool events to parent
  useEffect(() => {
    onToolEvent?.(toolEvents);
  }, [toolEvents, onToolEvent]);

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

  // Clear feed when triggered by parent
  useEffect(() => {
    if (clearFeedTrigger && clearFeedTrigger > 0) {
      setToolEvents([]);
      if (sessionId) {
        try {
          const key = `devai_feed_${sessionId}`;
          localStorage.removeItem(key);
        } catch {
          // Ignore storage errors
        }
      }
    }
  }, [clearFeedTrigger, sessionId]);

  // WebSocket handlers for real-time action updates
  const handleActionPending = useCallback((action: Action) => {
    console.log('[ChatUI] handleActionPending called:', action);
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
        break;
      case 'agent_complete':
        setAgentPhase('idle');
        break;
      case 'agent_history':
        setAgentHistory(event.entries as AgentHistoryEntry[]);
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
    // Handle agent-specific events in multi-agent mode
    if (multiAgentMode) {
      handleAgentEvent(event);
    }

    // Handle common events
    // Get agent from event if available (multi-agent mode)
    const eventAgent = event.agent as AgentName | undefined;

    if (event.type === 'status') {
      setToolEvents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: 'status',
          result: event.status,
          agent: eventAgent || activeAgent || undefined,
        },
      ]);
    }
    if (event.type === 'tool_call') {
      const id = String(event.id || crypto.randomUUID());
      upsertToolEvent(setToolEvents, id, {
        type: 'tool_call',
        name: event.name as string | undefined,
        arguments: event.arguments,
        agent: eventAgent || activeAgent || undefined,
      });
    }
    if (event.type === 'tool_result_chunk') {
      const id = String(event.id || crypto.randomUUID());
      const chunk = typeof event.chunk === 'string' ? event.chunk : '';
      upsertToolEvent(setToolEvents, id, {
        type: 'tool_result',
        name: event.name as string | undefined,
        chunk,
        agent: eventAgent || activeAgent || undefined,
      });
    }
    if (event.type === 'tool_result') {
      const id = String(event.id || crypto.randomUUID());
      upsertToolEvent(setToolEvents, id, {
        type: 'tool_result',
        name: event.name as string | undefined,
        result: event.result,
        completed: Boolean(event.completed),
        agent: eventAgent || activeAgent || undefined,
      });
    }
    if (event.type === 'action_pending') {
      console.log('[ChatUI] Stream action_pending event:', event);
      const pendingAction: PendingAction = {
        actionId: event.actionId as string,
        toolName: event.toolName as string,
        toolArgs: event.toolArgs as Record<string, unknown>,
        description: event.description as string,
        preview: event.preview as PendingAction['preview'],
      };
      // Check for duplicates (action might also come via WebSocket)
      setPendingActions((prev) => {
        if (prev.some((a) => a.actionId === pendingAction.actionId)) {
          return prev;
        }
        return [...prev, pendingAction];
      });
    }
        if (event.type === 'approval_request') {
          const request = event.request as PendingApproval | undefined;
          if (!request?.approvalId) return;
          const requestSessionId = typeof event.sessionId === 'string' ? event.sessionId : sessionId || undefined;
          setPendingApprovals((prev) => {
            if (prev.some((a) => a.approvalId === request.approvalId)) {
              return prev;
            }
            return [...prev, { ...request, sessionId: requestSessionId }];
          });
        }
    if (event.type === 'context_stats' && onContextUpdate) {
      const stats = event.stats as ContextStats | undefined;
      if (stats) {
        onContextUpdate(stats);
      }
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

    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);
    setIsLoading(true);
    setToolEvents([]);
    setFileHints([]);

    // Reset agent state when starting new message
    if (multiAgentMode) {
      setAgentHistory([]);
      setAgentPhase('idle');
      setActiveAgent(null);
    }

    const runRequest = async (): Promise<{ message: ChatMessage; sessionId?: string } | null> => {
      // Use multi-agent or single-agent endpoint based on mode
      if (multiAgentMode) {
        const response = await sendMultiAgentMessage(
          content,
          projectRoot || undefined,
          sessionId || undefined,
          handleStreamEvent
        );

        if (response.agentHistory) {
          setAgentHistory(response.agentHistory);
        }
        if (response.sessionId) {
          setSessionId(response.sessionId);
          await saveSetting('lastSessionId', response.sessionId);
        }
        setMessages((prev) => [...prev, response.message]);
        await refreshSessions(response.sessionId);
        return { message: response.message, sessionId: response.sessionId };
      } else {
        const response = await sendMessage(
          currentMessages,
          provider,
          projectRoot || undefined,
          skillIds,
          pinnedFiles,
          projectContextOverride,
          sessionId || undefined,
          handleStreamEvent
        );
        if (response.contextStats && onContextUpdate) {
          onContextUpdate(response.contextStats);
        }
        if (response.sessionId) {
          setSessionId(response.sessionId);
          await saveSetting('lastSessionId', response.sessionId);
        }
        setMessages((prev) => [...prev, response.message]);
        await refreshSessions(response.sessionId);
        return { message: response.message, sessionId: response.sessionId };
      }
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

  const handleApproveApproval = async (approvalId: string) => {
    const approval = pendingApprovals.find((item) => item.approvalId === approvalId);
    const approvalSessionId = approval?.sessionId || sessionId;
    if (!approvalSessionId) {
      throw new Error('Missing session for approval');
    }
    const response = await sendAgentApproval(approvalSessionId, approvalId, true, handleStreamEvent);

    if (response.message) {
      setMessages((prev) => [...prev, response.message]);
    }
    if (response.sessionId) {
      setSessionId(response.sessionId);
      await saveSetting('lastSessionId', response.sessionId);
    }
    await refreshSessions(response.sessionId || approvalSessionId);

    setTimeout(() => {
      setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
    }, 1000);
  };

  const handleRejectApproval = async (approvalId: string) => {
    const approval = pendingApprovals.find((item) => item.approvalId === approvalId);
    const approvalSessionId = approval?.sessionId || sessionId;
    if (!approvalSessionId) {
      throw new Error('Missing session for approval');
    }
    const response = await sendAgentApproval(approvalSessionId, approvalId, false, handleStreamEvent);

    if (response.message) {
      setMessages((prev) => [...prev, response.message]);
    }
    if (response.sessionId) {
      setSessionId(response.sessionId);
      await saveSetting('lastSessionId', response.sessionId);
    }
    await refreshSessions(response.sessionId || approvalSessionId);

    setTimeout(() => {
      setPendingApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
    }, 1000);
  };

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
        content += `✅ **${succeeded.length} action(s) completed:**\n`;
        for (const r of succeeded) {
          const desc = actionDescriptions.get(r.actionId) || r.actionId;
          content += `- ${desc}\n`;
        }
        content += '\n';
      }

      if (failed.length > 0) {
        content += `❌ **${failed.length} action(s) failed:**\n`;
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <span>Session</span>
            <select
              value={sessionId || ''}
              onChange={(e) => handleSelectSession(e.target.value)}
              disabled={sessionsLoading || sessions.length === 0}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
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
              className="text-[11px] text-orange-400 hover:text-orange-300 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Save current conversation to history and start fresh"
            >
              {sessionsLoading ? 'Loading...' : 'Restart Chat'}
            </button>
            <button
              onClick={handleNewChat}
              disabled={sessionsLoading}
              className="text-[11px] text-gray-300 hover:text-white disabled:opacity-50"
            >
              {sessionsLoading ? 'Loading...' : 'New Chat'}
            </button>
          </div>
        </div>

        {/* Agent Status - show when multi-agent mode is active */}
        {multiAgentMode && (
          <div className="space-y-2">
            <AgentStatus
              activeAgent={activeAgent}
              phase={agentPhase}
              compact={false}
            />
            {agentHistory.length > 0 && (
              <button
                onClick={() => setShowAgentHistory(!showAgentHistory)}
                className="text-[11px] text-blue-400 hover:text-blue-300"
              >
                {showAgentHistory ? 'Hide Agent History' : `Show Agent History (${agentHistory.length} entries)`}
              </button>
            )}
            {showAgentHistory && agentHistory.length > 0 && (
              <div className="bg-gray-900 border border-gray-700 rounded-lg p-2">
                <AgentTimeline entries={agentHistory} />
              </div>
            )}
          </div>
        )}

        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
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
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-100'
              }`}
            >
              {renderMessageContent(message.content)}
              <p className="text-xs opacity-50 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-700 rounded-lg px-4 py-2">
              <div className="flex space-x-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Pending Approvals - Fixed above input, always visible */}
      {pendingApprovals.length > 0 && (
        <div className="border-t border-gray-700 px-4 py-2 space-y-2">
          {pendingApprovals.map((approval) => (
            <InlineApproval
              key={approval.approvalId}
              approval={approval}
              onApprove={handleApproveApproval}
              onReject={handleRejectApproval}
            />
          ))}
        </div>
      )}

      {/* Pending Actions - Fixed above input, always visible */}
      {pendingActions.length > 0 && (
        <div className="border-t border-gray-700 px-4 py-2 space-y-2">
          {/* Batch action buttons when multiple actions pending */}
          {pendingActions.length > 1 && (
            <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 mb-2">
              <span className="text-xs text-gray-400">
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
      <form onSubmit={handleSubmit} className="border-t border-gray-700 p-4">
        {retryState && !isLoading && (
          <div className="mb-2 flex items-center justify-between bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-300">
            <span>Last message failed.</span>
            <button
              type="button"
              onClick={handleRetry}
              className="text-blue-300 hover:text-blue-200"
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
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            {fileHints.length > 0 && (
              <div className="absolute bottom-12 left-0 right-0 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto text-xs">
                {fileHints.map((hint, idx) => (
                  <button
                    type="button"
                    key={hint}
                    onClick={() => handlePickHint(hint)}
                    className={`w-full text-left px-3 py-2 ${
                      idx === activeHintIndex ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    {hint}
                  </button>
                ))}
              </div>
            )}
            {fileHintsLoading && (
              <div className="absolute bottom-12 left-0 right-0 text-[10px] text-gray-400 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                Searching files...
              </div>
            )}
            {fileHintsError && (
              <div className="absolute bottom-12 left-0 right-0 text-[10px] text-red-300 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                {fileHintsError}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function renderMessageContent(content: string) {
  if (!content.includes('```')) {
    return <p className="whitespace-pre-wrap">{content}</p>;
  }

  const segments = content.split('```');

  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        if (index % 2 === 1) {
          const lines = segment.split('\n');
          let language = '';
          if (lines.length > 1 && /^[a-zA-Z0-9+-]+$/.test(lines[0].trim())) {
            language = lines.shift() || '';
          }
          const code = lines.join('\n');
          return (
            <div key={`code-${index}`} className="bg-gray-900 rounded">
              {language && (
                <div className="px-2 py-1 text-[10px] text-gray-400 border-b border-gray-700 uppercase tracking-wide">
                  {language}
                </div>
              )}
              <pre className="text-xs p-2 overflow-x-auto font-mono text-gray-200 whitespace-pre-wrap">
                {code}
              </pre>
            </div>
          );
        }

        if (!segment.trim()) {
          return null;
        }

        return (
          <p key={`text-${index}`} className="whitespace-pre-wrap">
            {segment}
          </p>
        );
      })}
    </div>
  );
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

function formatToolPayload(payload: unknown): string {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    if (text.length > 400) {
      return `${text.slice(0, 400)}\n...`;
    }
    return text;
  } catch {
    return String(payload);
  }
}
