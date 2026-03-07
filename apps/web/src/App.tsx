import { useState, useEffect, useCallback, useRef } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { ChatUI, type ChatSessionState, type ChatSessionCommand, type ChatSessionCommandEnvelope } from './components/ChatUI';
import { type AgentName, type AgentPhase } from './components/AgentStatus';
import { PreviewPanel } from './components/PreviewPanel';
import type { Artifact } from './components/PreviewPanel';
import { BurgerMenu } from './components/BurgerMenu';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  createPreviewArtifact,
  fetchPreviewArtifact,
  fetchHealth,
  triggerPreviewScrape,
  readProjectFile,
} from './api';
import type { HealthResponse } from './types';
import { useAuth } from './hooks/useAuth';
import { usePersistedSettings } from './hooks/usePersistedSettings';
import { useCommandPalette } from './hooks/useCommandPalette';
import { CommandPalette } from './components/CommandPalette';

function App() {
  const auth = useAuth();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const settings = usePersistedSettings(auth.isAuthed);

  // UI state
  const [chatLoading, setChatLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  const [chatSessionState, setChatSessionState] = useState<ChatSessionState | null>(null);
  const [sessionCommand, setSessionCommand] = useState<ChatSessionCommandEnvelope | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Command Palette (Cmd+K)
  const commandPalette = useCommandPalette({
    sessions: chatSessionState?.sessions ?? [],
    isDisabled: !auth.isAuthed || !chatSessionState,
  });

  // Preview toggle backed by localStorage
  const [previewEnabled, setPreviewEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem('devai_preview');
      return stored === null ? true : stored === 'on';
    }
    catch { return true; }
  });

  const [detectedArtifact, setDetectedArtifact] = useState<Artifact | null>(null);
  const [currentArtifact, setCurrentArtifact] = useState<Artifact | null>(null);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const lastSubmittedArtifactKeyRef = useRef<string | null>(null);
  const prevArtifactFingerprintRef = useRef<string | null>(null);

  // Swipe gesture detection for mobile preview panel
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.t;
    touchStartRef.current = null;
    // Must be fast horizontal swipe (>80px, <400ms, more horizontal than vertical)
    if (dt > 400 || Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0 && !mobilePreviewOpen && currentArtifact) {
      // Swipe left → open preview (when there's an artifact)
      setMobilePreviewOpen(true);
    } else if (dx > 0 && mobilePreviewOpen) {
      // Swipe right → close preview
      setMobilePreviewOpen(false);
    }
  }, [mobilePreviewOpen, currentArtifact]);

  useEffect(() => {
    try { localStorage.setItem('devai_preview', previewEnabled ? 'on' : 'off'); }
    catch { /* ignore */ }
  }, [previewEnabled]);

  useEffect(() => {
    if (!detectedArtifact) {
      setCurrentArtifact(null);
      lastSubmittedArtifactKeyRef.current = null;
      prevArtifactFingerprintRef.current = null;
      return;
    }

    // Deduplicate: skip if same logical artifact re-detected without new content.
    // This prevents a stale show_in_preview re-detection from overwriting
    // fresh content that handleFileModified just fetched.
    const fingerprint = [
      detectedArtifact.type,
      detectedArtifact.title || '',
      detectedArtifact.filePath || '',
      detectedArtifact.remote?.signedUrl || '',
    ].join('|');
    if (
      prevArtifactFingerprintRef.current === fingerprint &&
      !detectedArtifact.content
    ) {
      return;
    }
    prevArtifactFingerprintRef.current = fingerprint;

    setCurrentArtifact(detectedArtifact);

    // Artifact from fs_edit: has filePath but no content — fetch it
    if (detectedArtifact.filePath && !detectedArtifact.content) {
      let cancelled = false;
      readProjectFile(detectedArtifact.filePath)
        .then((res) => {
          if (cancelled) return;
          setCurrentArtifact((prev) =>
            prev && prev.id === detectedArtifact.id
              ? { ...prev, content: res.content }
              : prev,
          );
        })
        .catch((err) => {
          if (!cancelled) console.warn('[App] Failed to fetch file for preview:', err);
        });
      return () => { cancelled = true; };
    }

    const sessionId = chatSessionState?.sessionId;
    if (!previewEnabled || !sessionId) {
      return;
    }

    if (detectedArtifact.remote?.status === 'ready' && detectedArtifact.remote.signedUrl) {
      return;
    }

    const artifactKey = [
      sessionId,
      detectedArtifact.messageId || '',
      detectedArtifact.id,
      detectedArtifact.type,
      detectedArtifact.filePath || '',
    ].join('|');
    if (lastSubmittedArtifactKeyRef.current === artifactKey) {
      return;
    }
    lastSubmittedArtifactKeyRef.current = artifactKey;

    let cancelled = false;
    const pollHandles = new Set<number>();
    
    const clearAllPollHandles = () => {
      for (const handle of pollHandles) {
        window.clearTimeout(handle);
      }
      pollHandles.clear();
    };

    const attachRemote = (remote: {
      id: string;
      status: 'queued' | 'building' | 'ready' | 'failed';
      signedUrl?: string;
      signedUrlExpiresAt?: string;
      error?: string | null;
      mimeType?: string | null;
      type?: Artifact['type'];
    }) => {
      if (cancelled) return;
      setCurrentArtifact((prev) => {
        const base = prev && prev.id === detectedArtifact.id ? prev : detectedArtifact;
        return { ...base, remote };
      });
    };

    const pollArtifact = async (artifactId: string, remaining = 20) => {
      if (cancelled || remaining <= 0) return;
      const res = await fetchPreviewArtifact(artifactId).catch(() => null);
      if (cancelled || !res?.artifact) return;

      const nextRemote = {
        id: res.artifact.id,
        status: res.artifact.status,
        signedUrl: res.artifact.signedUrl,
        signedUrlExpiresAt: res.artifact.signedUrlExpiresAt,
        error: res.artifact.error,
        mimeType: res.artifact.mimeType,
        type: res.artifact.type,
      } as const;
      attachRemote(nextRemote);

      if (res.artifact.status === 'ready' || res.artifact.status === 'failed') return;
      const handle = window.setTimeout(() => {
        pollHandles.delete(handle);
        void pollArtifact(artifactId, remaining - 1);
      }, 1000);
      pollHandles.add(handle);
    };

    const create = async () => {
      try {
        const res = await createPreviewArtifact({
          sessionId,
          messageId: detectedArtifact.messageId,
          sourceKind: detectedArtifact.sourceKind,
          type: detectedArtifact.type,
          title: detectedArtifact.title,
          language: detectedArtifact.language,
          content: detectedArtifact.content,
          entrypoint: detectedArtifact.filePath,
          sourceFiles: detectedArtifact.filePath ? [detectedArtifact.filePath] : undefined,
        });
        if (cancelled) return;

        attachRemote({
          id: res.artifact.id,
          status: res.artifact.status,
          signedUrl: res.artifact.signedUrl,
          signedUrlExpiresAt: res.artifact.signedUrlExpiresAt,
          error: res.artifact.error,
          mimeType: res.artifact.mimeType,
          type: res.artifact.type,
        });

        if (res.artifact.status !== 'ready' && res.artifact.status !== 'failed') {
          void pollArtifact(res.artifact.id, 20);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        attachRemote({
          id: `failed-${Date.now()}`,
          status: 'failed',
          error: message,
          type: detectedArtifact.type,
        });
      }
    };

    void create();

    return () => {
      cancelled = true;
      clearAllPollHandles();
    };
  }, [detectedArtifact, chatSessionState?.sessionId, previewEnabled]);

  const handleScrapeFallback = useCallback(async (artifactId: string) => {
    const result = await triggerPreviewScrape(artifactId).catch(() => null);
    if (!result?.artifact) return;

    setCurrentArtifact((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        remote: {
          id: result.artifact.id,
          status: result.artifact.status,
          signedUrl: result.artifact.signedUrl,
          signedUrlExpiresAt: result.artifact.signedUrlExpiresAt,
          error: result.artifact.error,
          mimeType: result.artifact.mimeType,
          type: result.artifact.type,
        },
      };
    });

    if (result.artifact.status === 'ready' || result.artifact.status === 'failed') return;

    let remaining = 20;
    while (remaining > 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // eslint-disable-next-line no-await-in-loop
      const latest = await fetchPreviewArtifact(result.artifact.id).catch(() => null);
      if (!latest?.artifact) continue;
      setCurrentArtifact((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          remote: {
            id: latest.artifact.id,
            status: latest.artifact.status,
            signedUrl: latest.artifact.signedUrl,
            signedUrlExpiresAt: latest.artifact.signedUrlExpiresAt,
            error: latest.artifact.error,
            mimeType: latest.artifact.mimeType,
            type: latest.artifact.type,
          },
        };
      });
      if (latest.artifact.status === 'ready' || latest.artifact.status === 'failed') break;
      remaining -= 1;
    }
  }, []);

  const issueSessionCommand = useCallback((command: ChatSessionCommand) => {
    setSessionCommand((prev) => ({
      nonce: (prev?.nonce ?? 0) + 1,
      command,
    }));
  }, []);

  const handleAgentChange = useCallback((agent: AgentName | null, phase: AgentPhase) => {
    setActiveAgent(agent);
    setAgentPhase(phase);
  }, []);

  // Auto-refresh preview when a displayed file is modified by fs_edit/fs_writeFile
  const handleFileModified = useCallback((filePath: string) => {
    const fileName = filePath.split('/').pop() || '';

    // Check synchronously if current artifact matches; if not, bail early.
    let shouldFetch = false;
    setCurrentArtifact((prev) => {
      if (prev && prev.title === fileName) shouldFetch = true;
      return prev; // No state change — just a read
    });

    if (!shouldFetch) return;

    // Fetch updated content outside the state updater (avoids React anti-pattern)
    readProjectFile(filePath)
      .then((res) => {
        setCurrentArtifact((cur) =>
          cur && cur.title === fileName
            ? { ...cur, content: res.content, id: cur.id + '_' + Date.now() }
            : cur,
        );
      })
      .catch((err) => console.warn('[App] Failed to refresh preview after file edit:', err));
  }, []);

  // Fetch health when authenticated (retry silently on failure — the ●/○ indicator shows status)
  useEffect(() => {
    if (!auth.isAuthed) return;
    let cancelled = false;
    const tryFetch = (retries: number) => {
      fetchHealth()
        .then((h) => { if (!cancelled) setHealth(h); })
        .catch(() => {
          if (!cancelled && retries > 0) {
            setTimeout(() => tryFetch(retries - 1), 2000);
          }
        });
    };
    tryFetch(3);
    return () => { cancelled = true; };
  }, [auth.isAuthed]);

  // Status pill logic
  const isAgentActive = activeAgent && agentPhase !== 'idle';
  const statusDotClass = isAgentActive
    ? agentPhase === 'thinking' ? 'bg-cyan-400 animate-pulse'
    : agentPhase === 'error' ? 'bg-red-400'
    : 'bg-yellow-400 animate-pulse'
    : health ? 'bg-green-400' : 'bg-yellow-400';
  const statusLabel = isAgentActive
    ? agentPhase === 'thinking' ? 'Thinking...'
    : agentPhase === 'error' ? 'Error'
    : 'Working...'
    : health ? 'Online' : 'Offline';
  const statusTextClass = isAgentActive
    ? agentPhase === 'thinking' ? 'text-cyan-400'
    : agentPhase === 'error' ? 'text-red-400'
    : 'text-yellow-400'
    : health ? 'text-green-400' : 'text-yellow-400';

  // Auth loading screen
  if (!auth.authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-devai-bg text-devai-text">
        <div className="text-sm text-devai-text-muted">Checking credentials...</div>
      </div>
    );
  }

  // Login screen
  if (!auth.isAuthed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-devai-bg text-devai-text px-4">
        <form
          onSubmit={auth.handleLogin}
          className="w-full max-w-sm bg-devai-surface border border-devai-border rounded-xl p-6 shadow-xl"
        >
          <h1 className="text-xl font-semibold text-devai-accent mb-2">DevAI Login</h1>
          <p className="text-sm text-devai-text-secondary mb-6">Sign in to access the DevAI assistant.</p>

          {auth.authError && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {auth.authError}
            </div>
          )}

          <label className="block text-sm text-devai-text-secondary mb-2" htmlFor="username">
            E-Mail
          </label>
          <input
            id="username"
            type="email"
            value={auth.username}
            onChange={(e) => auth.setUsername(e.target.value)}
            className="w-full rounded-lg border border-devai-border bg-devai-bg px-3 py-2 text-sm text-devai-text focus:outline-none focus:ring-2 focus:ring-devai-accent focus:border-devai-border-light"
            placeholder="name@example.com"
            required
          />

          <label className="block text-sm text-devai-text-secondary mt-4 mb-2" htmlFor="password">
            Passwort
          </label>
          <input
            id="password"
            type="password"
            value={auth.password}
            onChange={(e) => auth.setPassword(e.target.value)}
            className="w-full rounded-lg border border-devai-border bg-devai-bg px-3 py-2 text-sm text-devai-text focus:outline-none focus:ring-2 focus:ring-devai-accent focus:border-devai-border-light"
            placeholder="********"
            required
          />

          <button
            type="submit"
            className="mt-6 w-full rounded-lg bg-devai-accent py-2 text-sm font-semibold text-white hover:bg-devai-accent-hover disabled:opacity-60 transition-colors"
            disabled={auth.authLoading || !auth.username || !auth.password}
          >
            {auth.authLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="h-screen flex flex-col bg-devai-bg">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-devai-surface/95 backdrop-blur border-b border-devai-border px-3 md:px-4 py-2">
        <div className="flex items-center justify-between gap-2 max-w-5xl mx-auto w-full">
          {/* Left: Logo */}
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-devai-accent">DevAI</h1>
          </div>

          {/* Center: Session Selector (opens Command Palette) */}
          <button
            onClick={() => commandPalette.open()}
            className="flex items-center gap-2 bg-devai-card border border-devai-border rounded-lg px-3 py-1.5 text-xs text-devai-text hover:border-devai-border-light transition-colors max-w-[200px] md:max-w-[320px]"
            title="Search sessions (Ctrl+K)"
          >
            <svg className="w-3.5 h-3.5 text-devai-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="truncate">
              {chatSessionState?.sessionsLoading
                ? 'Loading...'
                : chatSessionState?.sessions.find(s => s.id === chatSessionState.sessionId)?.title
                  || chatSessionState?.sessionId?.slice(0, 8)
                  || 'New Session'}
            </span>
            <kbd className="hidden md:inline-flex items-center gap-0.5 text-[10px] text-devai-text-muted bg-devai-bg border border-devai-border rounded px-1 py-0.5 ml-auto shrink-0">
              <span>Ctrl</span><span>K</span>
            </kbd>
          </button>

          {/* Right: Status + Controls */}
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${statusDotClass}`} />
              <span className={`hidden md:inline ${statusTextClass}`}>{statusLabel}</span>
            </span>
            <button
              onClick={() => setPreviewEnabled(p => !p)}
              className={`transition-colors p-1 ${previewEnabled ? 'text-devai-accent' : 'text-devai-text-secondary hover:text-devai-text'}`}
              title={previewEnabled ? 'Preview ausblenden' : 'Preview einblenden'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {previewEnabled ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                )}
              </svg>
            </button>
            <button
              onClick={() => setMenuOpen(true)}
              className="text-devai-text-secondary hover:text-devai-text transition-colors p-1"
              title="Menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div
        className="flex-1 flex w-full overflow-hidden min-h-0 relative"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Desktop: side-by-side panels when preview enabled */}
        {previewEnabled ? (
          <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
            <PanelGroup direction="horizontal" className="flex-1 w-full overflow-hidden min-h-0">
              <Panel defaultSize={55} minSize={30}>
                <div className="flex flex-col min-w-0 min-h-0 overflow-hidden h-full max-w-4xl mx-auto w-full">
                  <ChatUI
                    projectRoot={health?.projectRoot}
                    allowedRoots={health?.allowedRoots}
                    ignorePatterns={settings.ignorePatterns}
                    onPinFile={settings.addPinnedFile}
                    onLoadingChange={setChatLoading}
                    onAgentChange={handleAgentChange}
                    showSessionControls={false}
                    sessionCommand={sessionCommand}
                    onSessionStateChange={setChatSessionState}
                    pinnedUserfileIds={settings.pinnedUserfileIds}
                    onPinUserfile={settings.togglePinnedUserfile}
                    onClearPinnedUserfiles={settings.clearPinnedUserfiles}
                    onArtifactDetected={setDetectedArtifact}
                    onSetPreview={setPreviewEnabled}
                    previewEnabled={previewEnabled}
                    onFileModified={handleFileModified}
                  />
                </div>
              </Panel>
              <PanelResizeHandle className="w-1.5 bg-devai-border hover:bg-devai-accent/40 transition-colors cursor-col-resize" />
              <Panel defaultSize={45} minSize={20}>
                <PreviewPanel
                  artifact={currentArtifact}
                  onScrapeFallback={handleScrapeFallback}
                  sessionId={chatSessionState?.sessionId ?? undefined}
                  onContentEdited={(newContent) => {
                    setCurrentArtifact(prev => prev ? { ...prev, content: newContent } : prev);
                  }}
                />
              </Panel>
            </PanelGroup>
          </div>
        ) : (
          <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
            <div className="flex flex-col min-w-0 min-h-0 overflow-hidden flex-1 max-w-4xl mx-auto w-full">
              <ChatUI
                projectRoot={health?.projectRoot}
                allowedRoots={health?.allowedRoots}
                ignorePatterns={settings.ignorePatterns}
                onPinFile={settings.addPinnedFile}
                onLoadingChange={setChatLoading}
                onAgentChange={handleAgentChange}
                showSessionControls={false}
                sessionCommand={sessionCommand}
                onSessionStateChange={setChatSessionState}
                pinnedUserfileIds={settings.pinnedUserfileIds}
                onPinUserfile={settings.togglePinnedUserfile}
                onClearPinnedUserfiles={settings.clearPinnedUserfiles}
                onArtifactDetected={setDetectedArtifact}
                onSetPreview={setPreviewEnabled}
                previewEnabled={previewEnabled}
                onFileModified={handleFileModified}
              />
            </div>
          </div>
        )}

        {/* Mobile: always full-width chat + preview arrow + slide-over */}
        <div className="flex md:hidden flex-1 min-h-0 overflow-hidden relative">
          <div className="flex flex-col min-w-0 min-h-0 overflow-hidden flex-1 w-full">
            <ChatUI
              projectRoot={health?.projectRoot}
              allowedRoots={health?.allowedRoots}
              ignorePatterns={settings.ignorePatterns}
              onPinFile={settings.addPinnedFile}
              onLoadingChange={setChatLoading}
              onAgentChange={handleAgentChange}
              showSessionControls={false}
              sessionCommand={sessionCommand}
              onSessionStateChange={setChatSessionState}
              pinnedUserfileIds={settings.pinnedUserfileIds}
              onPinUserfile={settings.togglePinnedUserfile}
              onClearPinnedUserfiles={settings.clearPinnedUserfiles}
              onArtifactDetected={setDetectedArtifact}
              onSetPreview={setPreviewEnabled}
              previewEnabled={previewEnabled}
              onFileModified={handleFileModified}
            />
          </div>
          {/* Right-edge arrow — always visible on mobile when there's an artifact */}
          {currentArtifact && !mobilePreviewOpen && (
            <button
              onClick={() => setMobilePreviewOpen(true)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-30 bg-devai-accent/80 active:bg-devai-accent text-white rounded-l-lg py-5 px-2 shadow-lg"
              title="Preview"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Mobile slide-over preview */}
        {mobilePreviewOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            {/* Left-edge arrow to go back */}
            <button
              onClick={() => setMobilePreviewOpen(false)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-[60] bg-devai-accent/80 active:bg-devai-accent text-white rounded-r-lg py-5 px-2 shadow-lg"
              title="Zurück"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {/* Full-screen preview */}
            <div className="absolute inset-0 bg-devai-bg animate-slide-in-right">
              <PreviewPanel
                artifact={currentArtifact}
                onScrapeFallback={handleScrapeFallback}
                sessionId={chatSessionState?.sessionId ?? undefined}
                onContentEdited={(newContent) => {
                  setCurrentArtifact(prev => prev ? { ...prev, content: newContent } : prev);
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Burger Menu */}
      <BurgerMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        pinnedUserfileIds={settings.pinnedUserfileIds}
        onTogglePinUserfile={settings.togglePinnedUserfile}
        onClearPinnedUserfiles={settings.clearPinnedUserfiles}
      />

      {/* Command Palette (Ctrl+K) */}
      <CommandPalette
        sessions={chatSessionState?.sessions ?? []}
        currentSessionId={chatSessionState?.sessionId ?? null}
        isOpen={commandPalette.isOpen}
        query={commandPalette.query}
        onQueryChange={commandPalette.setQuery}
        filteredSessions={commandPalette.filteredSessions}
        activeIndex={commandPalette.activeIndex}
        onActiveIndexChange={commandPalette.setActiveIndex}
        inputRef={commandPalette.inputRef}
        onKeyDown={commandPalette.handleKeyDown}
        onSelectSession={(sessionId) => {
          issueSessionCommand({ type: 'select', sessionId });
        }}
        onNewSession={() => {
          issueSessionCommand({ type: 'new' });
        }}
        onRenameSession={(sessionId, title) => {
          issueSessionCommand({ type: 'rename', sessionId, title });
        }}
        onRestartSession={() => {
          issueSessionCommand({ type: 'restart' });
        }}
        onDeleteSession={() => {
          issueSessionCommand({ type: 'delete' });
        }}
        onClose={commandPalette.close}
      />
    </div>
    </ErrorBoundary>
  );
}

export default App;
