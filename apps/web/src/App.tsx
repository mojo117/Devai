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
} from './api';
import type { HealthResponse } from './types';
import { useAuth } from './hooks/useAuth';
import { usePersistedSettings } from './hooks/usePersistedSettings';

function App() {
  // Custom hooks for grouped state
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const settings = usePersistedSettings(auth.isAuthed);

  // UI state
  const [chatLoading, setChatLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  const [chatSessionState, setChatSessionState] = useState<ChatSessionState | null>(null);
  const [sessionCommand, setSessionCommand] = useState<ChatSessionCommandEnvelope | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Preview toggle backed by localStorage
  const [previewEnabled, setPreviewEnabled] = useState(() => {
    try { return localStorage.getItem('devai_preview') === 'on'; }
    catch { return false; }
  });

  const [detectedArtifact, setDetectedArtifact] = useState<Artifact | null>(null);
  const [currentArtifact, setCurrentArtifact] = useState<Artifact | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const lastSubmittedArtifactKeyRef = useRef<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem('devai_preview', previewEnabled ? 'on' : 'off'); }
    catch { /* ignore */ }
  }, [previewEnabled]);

  useEffect(() => {
    if (!detectedArtifact) {
      setCurrentArtifact(null);
      lastSubmittedArtifactKeyRef.current = null;
      return;
    }

    setCurrentArtifact(detectedArtifact);

    const sessionId = chatSessionState?.sessionId;
    if (!previewEnabled || !sessionId) {
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
    let pollHandle: number | null = null;

    const attachRemote = (remote: {
      id: string;
      status: 'queued' | 'building' | 'ready' | 'failed';
      signedUrl?: string;
      signedUrlExpiresAt?: string;
      error?: string | null;
      mimeType?: string | null;
      type?: 'html' | 'svg' | 'webapp' | 'pdf' | 'scrape';
    }) => {
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
      pollHandle = window.setTimeout(() => {
        void pollArtifact(artifactId, remaining - 1);
      }, 1000);
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
      if (pollHandle) window.clearTimeout(pollHandle);
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

  // Agent icon/phase for header
  const agentIcon = activeAgent === 'chapo'
    ? '🎯'
    : activeAgent === 'devo'
    ? '🔧'
    : activeAgent === 'scout'
    ? '🔍'
    : '🤖';

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
    <div className="min-h-screen flex flex-col bg-devai-bg">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-devai-surface/95 backdrop-blur border-b border-devai-border px-3 md:px-4 py-2">
        <div className="flex items-center justify-between gap-2 max-w-5xl mx-auto w-full">
          {/* Left: Logo */}
          <h1 className="text-base font-bold text-devai-accent">DevAI</h1>

          {/* Center: Session Controls */}
          <div className="flex items-center gap-2 text-[11px] text-devai-text-secondary">
            <select
              value={chatSessionState?.sessionId || chatSessionState?.sessions[0]?.id || ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                issueSessionCommand({ type: 'select', sessionId: v });
              }}
              disabled={chatLoading || chatSessionState?.sessionsLoading || !chatSessionState || chatSessionState.sessions.length === 0}
              className="bg-devai-card border border-devai-border rounded px-2 py-1 text-xs text-devai-text max-w-[120px] md:max-w-[220px]"
              title={chatSessionState?.sessionId || ''}
            >
              {!chatSessionState || chatSessionState.sessionsLoading ? (
                <option value="">Loading...</option>
              ) : chatSessionState.sessions.length === 0 ? (
                <option value="">No sessions</option>
              ) : (
                chatSessionState.sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title ? s.title : s.id.slice(0, 8)}
                  </option>
                ))
              )}
            </select>
            <button
              onClick={() => issueSessionCommand({ type: 'restart' })}
              disabled={chatLoading || chatSessionState?.sessionsLoading || !chatSessionState?.hasMessages}
              className="text-[11px] text-devai-accent hover:text-devai-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              title="Save current conversation to history and start fresh"
            >
              Restart
            </button>
            <button
              onClick={() => issueSessionCommand({ type: 'new' })}
              disabled={chatLoading || chatSessionState?.sessionsLoading || !chatSessionState}
              className="text-[11px] text-devai-text-secondary hover:text-devai-text disabled:opacity-50"
            >
              New
            </button>
          </div>

          {/* Right: Status + Agent + Burger */}
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <span>{agentIcon}</span>
              {activeAgent && (
                <span className={`text-[10px] ${
                  agentPhase === 'thinking' ? 'text-cyan-400 animate-pulse' :
                  agentPhase === 'execution' || agentPhase === 'executing' ? 'text-yellow-400' :
                  agentPhase === 'error' ? 'text-red-400' :
                  'text-devai-text-muted'
                }`}>
                  {agentPhase === 'thinking' && '...'}
                  {(agentPhase === 'execution' || agentPhase === 'executing') && '...'}
                </span>
              )}
            </span>
            <span className={`${health ? 'text-green-400' : 'text-yellow-400'}`}>
              {health ? '●' : '○'}
            </span>
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

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/50 border-b border-red-700 px-4 md:px-6 py-2 text-red-200 text-sm">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-4 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content - Chat centered, optionally split with preview */}
      {previewEnabled ? (
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
              />
            </div>
          </Panel>
          <PanelResizeHandle className="w-1.5 bg-devai-border hover:bg-devai-accent/40 transition-colors cursor-col-resize" />
          <Panel
            defaultSize={45}
            minSize={20}
            collapsible
            collapsedSize={3}
            onCollapse={() => setPreviewCollapsed(true)}
            onExpand={() => setPreviewCollapsed(false)}
          >
            <PreviewPanel
              artifact={currentArtifact}
              onClose={() => setPreviewEnabled(false)}
              collapsed={previewCollapsed}
              onToggleCollapse={() => setPreviewCollapsed(p => !p)}
              onScrapeFallback={handleScrapeFallback}
            />
          </Panel>
        </PanelGroup>
      ) : (
        <div className="flex-1 flex w-full overflow-hidden min-h-0">
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
            />
          </div>
        </div>
      )}

      {/* Burger Menu */}
      <BurgerMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        pinnedUserfileIds={settings.pinnedUserfileIds}
        onTogglePinUserfile={settings.togglePinnedUserfile}
        onClearPinnedUserfiles={settings.clearPinnedUserfiles}
      />
    </div>
    </ErrorBoundary>
  );
}

export default App;
