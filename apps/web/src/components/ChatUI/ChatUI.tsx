import { useState, useRef, useEffect, useCallback } from 'react';
import { sendMultiAgentMessage, saveSessionMessage, uploadUserfile, transcribeAudio } from '../../api';
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
import { DropOverlay } from './DropOverlay';
import { validateFile } from './uploadConstants';
import { TodoCard } from '../TodoCard';
import { getLatestArtifact, parseToolEventArtifacts } from '../PreviewPanel/artifactParser';

/** uuid() requires secure context (HTTPS). Fallback for HTTP. */
const uuid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

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
  previewEnabled: _previewEnabled,
  onArtifactDetected,
  onFileModified,
}: ChatUIProps) {
  // Core state shared across sub-components
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoadingInternal, setIsLoading] = useState(false);
  
  // Sync loading state to parent via effect instead of wrapper function
  useEffect(() => {
    onLoadingChange?.(isLoadingInternal);
  }, [isLoadingInternal, onLoadingChange]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [messageToolEvents, setMessageToolEvents] = useState<Record<string, ToolEvent[]>>({});
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [currentTodos, setCurrentTodos] = useState<Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>>([]);
  const [debugMode, setDebugMode] = useState(() => {
    try { return localStorage.getItem('devai_debug') === 'on'; }
    catch { return false; }
  });
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

  // Debug flag - use type-safe window access
  const debug = import.meta.env.DEV && 
    typeof window !== 'undefined' && 
    '__DEVAI_DEBUG' in window && 
    Boolean((window as Window & { __DEVAI_DEBUG?: boolean }).__DEVAI_DEBUG);

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
  }, []);

  // --- Tool event persistence ---
  // Server-side events are loaded via onEventsLoaded callback from useChatSession.
  // localStorage serves as fallback for sessions that don't have server-side events yet.

  useEffect(() => {
    if (!session.sessionId) return;
    setToolEvents([]);
    setCurrentTodos([]);

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

  // --- Auto-scroll with debounce to prevent performance issues ---
  const scrollTimeoutRef = useRef<number | null>(null);
  
  useEffect(() => {
    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      window.clearTimeout(scrollTimeoutRef.current);
    }
    // Debounce scroll to prevent excessive calls during rapid updates
    scrollTimeoutRef.current = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      scrollTimeoutRef.current = null;
    }, 50);
    
    return () => {
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [messages, toolEvents]);

  // --- Artifact detection ---

  useEffect(() => {
    if (!onArtifactDetected) return;

    // Priority 1: Live tool events from the current streaming turn (most recent)
    if (toolEvents.length > 0) {
      const liveArtifacts = parseToolEventArtifacts(toolEvents);
      if (liveArtifacts.length > 0) {
        onArtifactDetected(liveArtifacts[liveArtifacts.length - 1]);
        return;
      }
    }

    // Priority 2: Frozen tool events from completed messages
    const artifact = getLatestArtifact(messages, messageToolEvents);
    if (artifact) {
      onArtifactDetected(artifact);
      return;
    }

    onArtifactDetected(null);
  }, [messages, messageToolEvents, toolEvents, onArtifactDetected]);

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
      case 'agent_thinking':
        setAgentPhase('thinking');
        setToolEvents((prev) => [
          ...prev,
          {
            id: uuid(),
            type: 'thinking',
            result: event.status,
            agent: event.agent as AgentName | undefined,
          },
        ]);
        break;
      case 'agent_complete':
        setAgentPhase('idle');
        break;
    }
  };

  const handleStreamEvent = (event: ChatStreamEvent) => {
    handleAgentEvent(event);
    const eventAgent = event.agent || activeAgent || undefined;

    switch (event.type) {
      case 'status': {
        setToolEvents((prev) => [
          ...prev,
          { id: uuid(), type: 'status', result: event.status, agent: eventAgent },
        ]);
        break;
      }
      case 'tool_call': {
        const id = event.id || uuid();
        upsertToolEvent(setToolEvents, String(id), { type: 'tool_call', name: event.toolName, arguments: event.args ?? event.arguments, agent: eventAgent });
        break;
      }
      case 'tool_result_chunk': {
        const id = event.id || uuid();
        upsertToolEvent(setToolEvents, String(id), { type: 'tool_result', name: event.toolName, chunk: event.chunk || '', agent: eventAgent });
        break;
      }
      case 'tool_result': {
        const id = event.id || uuid();
        upsertToolEvent(setToolEvents, String(id), { type: 'tool_result', name: event.toolName, result: event.result, completed: event.completed, agent: eventAgent });
        // Notify parent when a file-modifying tool completes successfully
        if (onFileModified && (event.toolName === 'fs_edit' || event.toolName === 'fs_writeFile' || event.toolName === 'fs_write_file')) {
          const res = event.result as Record<string, unknown> | null;
          const filePath = String(res?.path ?? '');
          if (filePath) onFileModified(filePath);
        }
        break;
      }
      case 'action_pending': {
        if (debug) console.log('[ChatUI] Stream action_pending event:', event);
        const pendingAction: PendingAction = {
          actionId: event.actionId,
          toolName: event.toolName,
          toolArgs: event.toolArgs,
          description: event.description,
          preview: event.preview as PendingAction['preview'],
        };
        actions.setPendingActions((prev) => {
          if (prev.some((a) => a.actionId === pendingAction.actionId)) return prev;
          return [...prev, pendingAction];
        });
        break;
      }
      case 'context_stats': {
        if (onContextUpdate && event.stats) {
          onContextUpdate(event.stats);
        }
        break;
      }
      case 'message_queued': {
        setToolEvents((prev) => [
          ...prev,
          {
            id: String(event.messageId || uuid()),
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
            id: uuid(),
            type: 'status',
            name: 'inbox',
            result: `Processing ${event.count} follow-up message(s)...`,
            completed: false,
            agent: 'chapo' as AgentName,
          },
        ]);
        break;
      }
      case 'loop_started': {
        setToolEvents((prev) => [
          ...prev,
          {
            id: event.turnId || uuid(),
            type: 'status',
            name: 'parallel_loop',
            result: `Parallel Loop gestartet: ${event.taskLabel}`,
            completed: false,
            agent: 'chapo' as AgentName,
          },
        ]);
        break;
      }
      case 'loop_completed': {
        setToolEvents((prev) => [
          ...prev,
          {
            id: event.turnId || uuid(),
            type: 'status',
            name: 'parallel_loop',
            result: `Loop fertig: ${event.taskLabel}`,
            completed: true,
            agent: 'chapo' as AgentName,
          },
        ]);
        break;
      }
      case 'mode_changed': {
        setToolEvents((prev) => [
          ...prev,
          {
            id: uuid(),
            type: 'status',
            name: 'mode',
            result: event.mode === 'parallel' ? 'Parallel Mode aktiviert' : 'Serial Mode aktiviert',
            completed: true,
            agent: 'chapo' as AgentName,
          },
        ]);
        break;
      }
      case 'partial_response': {
        const partialMessage: ChatMessage = {
          id: uuid(),
          role: 'assistant',
          content: event.message || '',
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, partialMessage]);
        freezeToolEvents(partialMessage.id);
        // Keep isLoading true — loop is still running
        break;
      }
      case 'response': {
        // Terminal response from a parallel loop arriving via session listener.
        // The original request was resolved with queued:true, so this is the actual answer.
        const msg = event.response?.message;
        if (msg) {
          const chatMsg: ChatMessage = {
            id: msg.id,
            role: msg.role as ChatMessage['role'],
            content: msg.content,
            timestamp: msg.timestamp,
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === chatMsg.id)) return prev;
            return [...prev, chatMsg];
          });
          freezeToolEvents(chatMsg.id);
        }
        break;
      }
      case 'todo_updated': {
        setCurrentTodos(event.todos || []);
        break;
      }
    }
  };

  // --- Message sending ---

  const sendChatMessage = async (content: string) => {
    const userMessage: ChatMessage = {
      id: uuid(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    // In parallel mode (already loading), freeze existing tool events to the
    // previous user message that triggered them — keeps events visually
    // associated with the prompt they belong to.
    if (isLoadingInternal) {
      const prevUserMsg = messages.filter((m) => m.role === 'user').pop();
      setToolEvents((currentEvents) => {
        if (currentEvents.length > 0 && prevUserMsg) {
          setMessageToolEvents((mte) => ({
            ...mte,
            [prevUserMsg.id]: [...(mte[prevUserMsg.id] || []), ...currentEvents],
          }));
        }
        return [];
      });
    } else {
      setToolEvents([]);
    }
    setIsLoading(true);
    setCurrentTodos([]);
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
        id: uuid(),
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

  const handleSlashCommand = useCallback((command: string, match: RegExpMatchArray) => {
    let content: string;
    switch (command) {
      case 'preview': {
        const on = match[1].toLowerCase() === 'on';
        onSetPreview?.(on);
        content = on ? 'Preview pane enabled.' : 'Preview pane disabled.';
        break;
      }
      case 'debug': {
        const on = match[1].toLowerCase() === 'on';
        setDebugMode(on);
        try { localStorage.setItem('devai_debug', on ? 'on' : 'off'); } catch {}
        content = on ? 'Debug mode enabled.' : 'Debug mode disabled.';
        break;
      }
      case 'list':
        content = [
          '**Available commands:**',
          '`/engine [glm|gemini|claude|kimi]` — Switch LLM engine or show status',
          '`/preview on|off` — Toggle the preview panel',
          '`/debug on|off` — Toggle debug mode (shows message & session IDs)',
          '`/mode` — Toggle between serial and parallel mode',
          '`/stop` — Abort all running loops',
          '`/list` — Show this list',
        ].join('\n');
        break;
      default: return;
    }
    setMessages(prev => [...prev, {
      id: `${command}-${Date.now()}`,
      role: 'system' as const,
      content,
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
        id: uuid(),
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
        debugMode={debugMode}
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
        onSlashCommand={handleSlashCommand}
      />
    </div>
  );
}
