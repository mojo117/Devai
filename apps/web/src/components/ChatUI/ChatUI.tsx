import { useState, useRef, useEffect, useCallback } from 'react';
import { sendMultiAgentMessage, saveSetting, saveSessionMessage, uploadUserfile, transcribeAudio } from '../../api';
import type { ChatStreamEvent } from '../../api';
import type { ChatMessage } from '../../types';
import type { AgentName, AgentPhase } from '../AgentStatus';
import type { PendingAction } from '../InlineAction';
import type { ChatUIProps, ToolEvent } from './types';
import { upsertToolEvent } from './utils';
import { useChatSession } from './hooks/useChatSession';
import { usePendingActions } from './hooks/usePendingActions';
import { useFileHints } from './hooks/useFileHints';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { PendingActionsBar } from './PendingActionsBar';

export function ChatUI({
  projectRoot,
  allowedRoots,
  ignorePatterns,
  onPinFile,
  onContextUpdate,
  onLoadingChange,
  onAgentChange,
  showSessionControls = true,
  sessionCommand,
  onSessionStateChange,
  pinnedUserfileIds,
  onPinUserfile,
}: ChatUIProps) {
  // Core state shared across sub-components
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoadingInternal, setIsLoadingInternal] = useState(false);
  const setIsLoading = (loading: boolean) => {
    setIsLoadingInternal(loading);
    onLoadingChange?.(loading);
  };
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [messageToolEvents, setMessageToolEvents] = useState<Record<string, ToolEvent[]>>({});
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [retryState, setRetryState] = useState<null | {
    input: string;
    userMessage: ChatMessage;
    runRequest: () => Promise<{ message: ChatMessage; sessionId?: string } | null>;
  }>(null);

  // Agent state
  const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  useEffect(() => {
    onAgentChange?.(activeAgent, agentPhase);
  }, [activeAgent, agentPhase, onAgentChange]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFileUploading, setIsFileUploading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debug = import.meta.env.DEV && Boolean((window as any).__DEVAI_DEBUG);

  // --- Hooks ---

  // Callback for when server-side events are loaded with session messages
  const handleEventsLoaded = useCallback((serverEvents: Record<string, ToolEvent[]>) => {
    setMessageToolEvents(prev => {
      // Merge server events (they take priority)
      return { ...prev, ...serverEvents };
    });
  }, []);

  const session = useChatSession({
    sessionCommand,
    onSessionStateChange,
    messages,
    setMessages,
    setToolEvents: setToolEvents as React.Dispatch<React.SetStateAction<unknown[]>>,
    onEventsLoaded: handleEventsLoaded,
  });

  const actions = usePendingActions({
    sessionId: session.sessionId,
    setMessages,
    debug,
  });

  const fileHintState = useFileHints({
    input,
    setInput,
    allowedRoots,
    ignorePatterns,
    onPinFile,
  });

  // --- Freeze tool events to a completed message ---

  const freezeToolEvents = useCallback((messageId: string) => {
    setToolEvents(currentEvents => {
      if (currentEvents.length > 0) {
        setMessageToolEvents(prev => ({
          ...prev,
          [messageId]: [...currentEvents],
        }));
      }
      return [];
    });
  }, []);

  // --- Tool event persistence ---
  // Server-side events are loaded via onEventsLoaded callback from useChatSession.
  // localStorage serves as fallback for sessions that don't have server-side events yet.

  useEffect(() => {
    if (!session.sessionId) return;
    setToolEvents([]);

    // Load localStorage fallback (server events will overwrite via onEventsLoaded)
    try {
      const key = `devai_events_${session.sessionId}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, ToolEvent[]>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          setMessageToolEvents(parsed);
        } else {
          setMessageToolEvents({});
        }
      } else {
        setMessageToolEvents({});
      }
    } catch {
      setMessageToolEvents({});
    }
  }, [session.sessionId]);

  // --- Auto-scroll ---

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolEvents]);

  // --- Event expand toggle ---

  const toggleEventExpanded = useCallback((eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  // --- Stream event handling ---

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
      case 'parallel_start':
        setAgentPhase('executing');
        break;
      case 'parallel_complete':
        setAgentPhase('idle');
        break;
    }
  };

  const handleStreamEvent = (event: ChatStreamEvent) => {
    handleAgentEvent(event);
    const eventAgent = (event.agent as AgentName | undefined) || activeAgent || undefined;
    const type = String(event.type || '');

    switch (type) {
      case 'status': {
        setToolEvents((prev) => [
          ...prev,
          { id: crypto.randomUUID(), type: 'status', result: (event as Record<string, unknown>).status, agent: eventAgent },
        ]);
        break;
      }
      case 'tool_call': {
        const ev = event as Record<string, unknown>;
        const id = String(ev.id || crypto.randomUUID());
        const name = (ev.toolName as string | undefined) || (ev.name as string | undefined);
        const args = ev.args ?? ev.arguments;
        upsertToolEvent(setToolEvents, id, { type: 'tool_call', name, arguments: args, agent: eventAgent });
        break;
      }
      case 'tool_result_chunk': {
        const ev = event as Record<string, unknown>;
        const id = String(ev.id || crypto.randomUUID());
        const name = (ev.toolName as string | undefined) || (ev.name as string | undefined);
        const chunk = typeof ev.chunk === 'string' ? ev.chunk : '';
        upsertToolEvent(setToolEvents, id, { type: 'tool_result', name, chunk, agent: eventAgent });
        break;
      }
      case 'tool_result': {
        const ev = event as Record<string, unknown>;
        const id = String(ev.id || crypto.randomUUID());
        const name = (ev.toolName as string | undefined) || (ev.name as string | undefined);
        const result = ev.result ?? { result: ev.result, success: ev.success };
        upsertToolEvent(setToolEvents, id, { type: 'tool_result', name, result, completed: Boolean(ev.completed), agent: eventAgent });
        break;
      }
      case 'action_pending': {
        if (debug) console.log('[ChatUI] Stream action_pending event:', event);
        const ev = event as Record<string, unknown>;
        const pendingAction: PendingAction = {
          actionId: ev.actionId as string,
          toolName: ev.toolName as string,
          toolArgs: ev.toolArgs as Record<string, unknown>,
          description: ev.description as string,
          preview: ev.preview as PendingAction['preview'],
        };
        actions.setPendingActions((prev) => {
          if (prev.some((a) => a.actionId === pendingAction.actionId)) return prev;
          return [...prev, pendingAction];
        });
        break;
      }
      case 'context_stats': {
        if (onContextUpdate) {
          const stats = (event as Record<string, unknown>).stats as Parameters<NonNullable<typeof onContextUpdate>>[0] | undefined;
          if (stats) onContextUpdate(stats);
        }
        break;
      }
    }
  };

  // --- Message sending ---

  const sendChatMessage = async (content: string) => {
    if (isLoadingInternal) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setToolEvents([]);
    fileHintState.fileHints.length > 0; // clear hints via effect
    setAgentPhase('idle');
    setActiveAgent(null);

    const runRequest = async (): Promise<{ message: ChatMessage; sessionId?: string } | null> => {
      const response = await sendMultiAgentMessage(
        content,
        projectRoot || undefined,
        session.sessionId || undefined,
        handleStreamEvent,
        undefined,
        pinnedUserfileIds,
      );

      if (response.sessionId) {
        session.setSessionId(response.sessionId);
        await saveSetting('lastSessionId', response.sessionId);
      }
      setMessages((prev) => [...prev, response.message]);
      await session.refreshSessions(response.sessionId);
      return { message: response.message, sessionId: response.sessionId };
    };

    try {
      const result = await runRequest();
      if (result) {
        freezeToolEvents(result.message.id);
      }
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
      freezeToolEvents(errorMessage.id);

      if (shouldRetry) {
        setRetryState({ input: content, userMessage, runRequest });
      } else {
        setRetryState(null);
      }
    } finally {
      setIsLoading(false);
      setActiveAgent(null);
      setAgentPhase('idle');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoadingInternal) return;
    const content = input.trim();
    setInput('');
    await sendChatMessage(content);
  };

  const persistSystemMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
    if (session.sessionId) {
      saveSessionMessage(session.sessionId, message);
    }
  }, [session.sessionId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsFileUploading(true);
    const uploadedIds: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const result = await uploadUserfile(file);
        if (result.file?.id) {
          uploadedIds.push(result.file.id);
          // Auto-pin newly uploaded file
          if (onPinUserfile) {
            onPinUserfile(result.file.id);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        persistSystemMessage({ id: `err-${Date.now()}`, role: 'system', content: `Upload failed: ${msg}`, timestamp: new Date().toISOString() });
      }
    }
    setIsFileUploading(false);
    e.target.value = '';
    const count = uploadedIds.length;
    if (count > 0) {
      persistSystemMessage({ id: `upload-${Date.now()}`, role: 'system', content: `${count} file${count > 1 ? 's' : ''} uploaded and pinned for AI context`, timestamp: new Date().toISOString() });
    }
  };

  const handleRetry = async () => {
    if (!retryState) return;
    setIsLoading(true);
    setToolEvents([]);
    try {
      const result = await retryState.runRequest();
      if (result) {
        freezeToolEvents(result.message.id);
      }
      setRetryState(null);
    } catch (error) {
      const err = error instanceof Error ? error.message : 'Unknown error';
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      freezeToolEvents(errorMsg.id);
    } finally {
      setIsLoading(false);
      setActiveAgent(null);
      setAgentPhase('idle');
    }
  };

  const handleCopyMessage = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
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

  const handleTranscription = async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      const result = await transcribeAudio(audioBlob);
      if (result.text) {
        setInput((prev) => prev ? `${prev} ${result.text}` : result.text);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      persistSystemMessage({ id: `err-${Date.now()}`, role: 'system', content: `Dictation failed: ${msg}`, timestamp: new Date().toISOString() });
    } finally {
      setIsTranscribing(false);
    }
  };

  // --- Render ---

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <MessageList
        messages={messages}
        toolEvents={toolEvents}
        messageToolEvents={messageToolEvents}
        expandedEvents={expandedEvents}
        toggleEventExpanded={toggleEventExpanded}
        copiedMessageId={copiedMessageId}
        onCopyMessage={handleCopyMessage}
        isLoading={isLoadingInternal}
        messagesEndRef={messagesEndRef}
        showSessionControls={showSessionControls}
        sessionId={session.sessionId}
        sessions={session.sessions}
        sessionsLoading={session.sessionsLoading}
        onSelectSession={session.handleSelectSession}
        onRestartChat={session.handleRestartChat}
        onNewChat={session.handleNewChat}
      />

      <PendingActionsBar
        pendingActions={actions.pendingActions}
        onApproveAction={actions.handleApproveAction}
        onRejectAction={actions.handleRejectAction}
        onBatchApprove={actions.handleBatchApprove}
        onBatchReject={actions.handleBatchReject}
      />

      <InputArea
        input={input}
        setInput={setInput}
        isLoading={isLoadingInternal}
        onSubmit={handleSubmit}
        retryState={retryState}
        onRetry={handleRetry}
        fileHints={fileHintState.fileHints}
        fileHintsLoading={fileHintState.fileHintsLoading}
        fileHintsError={fileHintState.fileHintsError}
        activeHintIndex={fileHintState.activeHintIndex}
        onPickHint={fileHintState.handlePickHint}
        onInputKeyDown={fileHintState.handleInputKeyDown}
        isFileUploading={isFileUploading}
        fileInputRef={fileInputRef}
        onFileUpload={handleFileUpload}
        isTranscribing={isTranscribing}
        onTranscribe={handleTranscription}
      />
    </div>
  );
}
