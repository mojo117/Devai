import { useState, useRef, useEffect, useCallback } from 'react';
import { sendMultiAgentMessage, saveSetting, saveSessionMessage, uploadUserfile, transcribeAudio } from '../../api';
import type { ChatStreamEvent } from '../../api';
import type { ChatMessage } from '../../types';
import type { AgentName, AgentPhase } from '../AgentStatus';
import type { PendingAction } from '../InlineAction';
import type { ChatUIProps, ToolEvent, DelegationData, DelegationToolStep } from './types';
import { upsertToolEvent } from './utils';
import { useChatSession } from './hooks/useChatSession';
import { usePendingActions } from './hooks/usePendingActions';
import { useFileHints } from './hooks/useFileHints';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { PendingActionsBar } from './PendingActionsBar';
import { DropOverlay } from './DropOverlay';
import { validateFile } from './uploadConstants';
import { TodoCard } from '../TodoCard';
import { getLatestArtifact, parseToolEventArtifacts } from '../PreviewPanel/artifactParser';
import type { Artifact } from '../PreviewPanel/artifactParser';

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
  onClearPinnedUserfiles,
  onSetPreview,
  previewEnabled,
  onArtifactDetected,
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
  const [currentTodos, setCurrentTodos] = useState<Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>>([]);
  const [delegations, setDelegations] = useState<DelegationData[]>([]);
  const [messageDelegations, setMessageDelegations] = useState<Record<string, DelegationData[]>>({});
  const activeDelegationRef = useRef<string | null>(null);
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
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

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
    onClearPinnedUserfiles,
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
    setDelegations(currentDels => {
      if (currentDels.length > 0) {
        setMessageDelegations(prev => ({
          ...prev,
          [messageId]: [...currentDels],
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
    setCurrentTodos([]);
    setDelegations([]);
    setMessageDelegations({});
    activeDelegationRef.current = null;

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

    try {
      const delKey = `devai_delegations_${session.sessionId}`;
      const storedDel = localStorage.getItem(delKey);
      if (storedDel) {
        const parsed = JSON.parse(storedDel) as Record<string, DelegationData[]>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          setMessageDelegations(parsed);
        }
      }
    } catch { /* ignore */ }
  }, [session.sessionId]);

  // --- Auto-scroll ---

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolEvents]);

  // --- Artifact detection ---

  useEffect(() => {
    if (!onArtifactDetected) return;

    // Check frozen tool events first (completed messages)
    const artifact = getLatestArtifact(messages, messageToolEvents);
    if (artifact) {
      onArtifactDetected(artifact);
      return;
    }

    // Also check live tool events (still streaming)
    if (toolEvents.length > 0) {
      const liveArtifacts = parseToolEventArtifacts(toolEvents);
      if (liveArtifacts.length > 0) {
        onArtifactDetected(liveArtifacts[liveArtifacts.length - 1]);
        return;
      }
    }

    onArtifactDetected(null);
  }, [messages, messageToolEvents, toolEvents, onArtifactDetected]);

  // --- Delegation persistence ---

  useEffect(() => {
    if (!session.sessionId) return;
    try {
      const key = `devai_delegations_${session.sessionId}`;
      const filtered = Object.fromEntries(
        Object.entries(messageDelegations).filter(([, v]) => v.length > 0)
      );
      if (Object.keys(filtered).length > 0) {
        localStorage.setItem(key, JSON.stringify(filtered));
      }
    } catch { /* quota exceeded — silently skip */ }
  }, [messageDelegations, session.sessionId]);

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
      case 'agent_complete': {
        const completedAgent = (event as Record<string, unknown>).agent as AgentName | undefined;
        if (completedAgent && completedAgent !== 'chapo' && activeDelegationRef.current) {
          const ev = event as Record<string, unknown>;
          const durationMs = typeof ev.durationMs === 'number' ? ev.durationMs : undefined;
          const resultStr = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result);
          const backendStatus = ev.delegationStatus as string | undefined;
          const delegationStatus = backendStatus === 'escalated' ? 'escalated' as const
            : backendStatus === 'failed' ? 'failed' as const
            : 'completed' as const;
          setDelegations(prev => prev.map(d => {
            if (d.id !== activeDelegationRef.current) return d;
            return {
              ...d,
              status: delegationStatus,
              durationMs: durationMs ?? (Date.now() - d.startTime),
              response: resultStr,
            };
          }));
          activeDelegationRef.current = null;
        }
        setAgentPhase('idle');
        break;
      }
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
        if (!activeDelegationRef.current) {
          upsertToolEvent(setToolEvents, id, { type: 'tool_call', name, arguments: args, agent: eventAgent });
        }
        if (activeDelegationRef.current) {
          const step: DelegationToolStep = {
            id,
            name: name || 'tool',
            argsPreview: typeof args === 'string' ? String(args).slice(0, 80) : JSON.stringify(args).slice(0, 80),
          };
          setDelegations(prev => prev.map(d =>
            d.id === activeDelegationRef.current
              ? { ...d, toolSteps: [...d.toolSteps, step] }
              : d
          ));
        }
        break;
      }
      case 'tool_result_chunk': {
        const ev = event as Record<string, unknown>;
        const id = String(ev.id || crypto.randomUUID());
        const name = (ev.toolName as string | undefined) || (ev.name as string | undefined);
        const chunk = typeof ev.chunk === 'string' ? ev.chunk : '';
        if (!activeDelegationRef.current) {
          upsertToolEvent(setToolEvents, id, { type: 'tool_result', name, chunk, agent: eventAgent });
        }
        break;
      }
      case 'tool_result': {
        const ev = event as Record<string, unknown>;
        const id = String(ev.id || crypto.randomUUID());
        const name = (ev.toolName as string | undefined) || (ev.name as string | undefined);
        const result = ev.result ?? { result: ev.result, success: ev.success };
        if (!activeDelegationRef.current) {
          upsertToolEvent(setToolEvents, id, { type: 'tool_result', name, result, completed: Boolean(ev.completed), agent: eventAgent });
        }
        if (activeDelegationRef.current) {
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          setDelegations(prev => prev.map(d => {
            if (d.id !== activeDelegationRef.current) return d;
            const steps = d.toolSteps.map(s =>
              s.id === id ? { ...s, resultPreview: resultStr.slice(0, 120), success: Boolean(ev.success ?? !ev.isError) } : s
            );
            return { ...d, toolSteps: steps };
          }));
        }
        break;
      }
      case 'delegation': {
        const ev = event as Record<string, unknown>;
        const delId = String(ev.id || crypto.randomUUID());
        const newDelegation: DelegationData = {
          id: delId,
          from: (ev.from as AgentName) || 'chapo',
          to: (ev.to as AgentName) || 'devo',
          task: String(ev.task || ev.objective || ''),
          domain: ev.domain as string | undefined,
          status: 'working',
          startTime: Date.now(),
          toolSteps: [],
          prompt: String(ev.objective || ev.task || ''),
        };
        setDelegations(prev => [...prev, newDelegation]);
        activeDelegationRef.current = delId;
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
      case 'message_queued': {
        setToolEvents((prev) => [
          ...prev,
          {
            id: String(event.messageId || crypto.randomUUID()),
            type: 'status',
            name: 'inbox',
            result: String(event.preview || 'Message received'),
            completed: true,
            agent: 'chapo' as AgentName,
          },
        ]);
        break;
      }
      case 'inbox_processing': {
        setToolEvents((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: 'status',
            name: 'inbox',
            result: `Processing ${event.count} follow-up message(s)...`,
            completed: false,
            agent: 'chapo' as AgentName,
          },
        ]);
        break;
      }
      case 'partial_response': {
        const partialMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: String((event as Record<string, unknown>).message || ''),
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, partialMessage]);
        freezeToolEvents(partialMessage.id);
        // Keep isLoading true — loop is still running
        break;
      }
      case 'todo_updated': {
        const ev = event as unknown as { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> };
        setCurrentTodos(ev.todos || []);
        break;
      }
    }
  };

  // --- Message sending ---

  const sendChatMessage = async (content: string) => {
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
      // Only refresh the sidebar session list — don't reload messages.
      // Messages are already managed by streaming events + the append below.
      await session.refreshSessionList();

      const responseMessage = response.message;
      if (!responseMessage) {
        return null;
      }

      setMessages((prev) => {
        // Dedup guard: skip if a message with same ID already exists
        if (prev.some((m) => m.id === responseMessage.id)) {
          console.warn('[ChatUI] Dedup: skipping duplicate response', responseMessage.id);
          return prev;
        }
        return [...prev, responseMessage];
      });
      return { message: responseMessage, sessionId: response.sessionId };
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
        content: shouldRetry
          ? 'Verbindung zum Server kurz unterbrochen. Du kannst die letzte Nachricht unten erneut senden.'
          : `Fehler: ${err}`,
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
    if (!input.trim()) return;
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

  const handleSetPreview = useCallback((enabled: boolean) => {
    onSetPreview?.(enabled);
    setMessages(prev => [...prev, {
      id: `preview-${Date.now()}`,
      role: 'system' as const,
      content: enabled ? 'Preview pane enabled.' : 'Preview pane disabled.',
      timestamp: new Date().toISOString(),
    }]);
  }, [onSetPreview]);

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

  // --- Drag & drop file upload ---

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    setIsFileUploading(true);
    const uploadedIds: string[] = [];
    for (const file of files) {
      const validationError = validateFile(file);
      if (validationError) {
        persistSystemMessage({
          id: `err-${Date.now()}-${file.name}`,
          role: 'system',
          content: `Upload abgelehnt (${file.name}): ${validationError}`,
          timestamp: new Date().toISOString(),
        });
        continue;
      }
      try {
        const result = await uploadUserfile(file);
        if (result.file?.id) {
          uploadedIds.push(result.file.id);
          if (onPinUserfile) {
            onPinUserfile(result.file.id);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        persistSystemMessage({
          id: `err-${Date.now()}-${file.name}`,
          role: 'system',
          content: `Upload fehlgeschlagen (${file.name}): ${msg}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
    setIsFileUploading(false);
    const count = uploadedIds.length;
    if (count > 0) {
      persistSystemMessage({
        id: `upload-${Date.now()}`,
        role: 'system',
        content: `${count} Datei${count > 1 ? 'en' : ''} hochgeladen und als AI-Kontext gepinnt`,
        timestamp: new Date().toISOString(),
      });
    }
  }, [onPinUserfile, persistSystemMessage]);

  // --- Render ---

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <DropOverlay visible={isDragOver} />
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
        delegations={delegations}
        messageDelegations={messageDelegations}
      />

      {currentTodos.length > 0 && <TodoCard todos={currentTodos} />}

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
        onSetPreview={handleSetPreview}
      />
    </div>
  );
}
