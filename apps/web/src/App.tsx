import { useState, useEffect, useCallback } from 'react';
import { ChatUI, type ToolEvent, type ChatSessionState, type ChatSessionCommand, type ChatSessionCommandEnvelope } from './components/ChatUI';
import { type AgentName, type AgentPhase } from './components/AgentStatus';
import { BurgerMenu } from './components/BurgerMenu';
import { type FeedEvent, toolEventToFeedEvent } from './components/SystemFeed';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  fetchHealth,
  fetchActions,
  approveAction,
  rejectAction,
  retryAction,
} from './api';
import type { Action, HealthResponse } from './types';
import { useAuth } from './hooks/useAuth';
import { useSkills } from './hooks/useSkills';
import { useProject } from './hooks/useProject';
import { usePersistedSettings } from './hooks/usePersistedSettings';

function App() {
  // Custom hooks for grouped state
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const handleError = useCallback((msg: string) => setError(msg), []);

  const skills = useSkills(auth.isAuthed, handleError);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const project = useProject(auth.isAuthed, health?.projectRoot, handleError);
  const settings = usePersistedSettings(auth.isAuthed);

  // Actions state
  const [actions, setActions] = useState<Action[]>([]);

  // UI state
  const [contextStats, setContextStats] = useState<{
    tokensUsed: number;
    tokenBudget: number;
    note?: string;
  } | null>(null);
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [clearFeedTrigger, setClearFeedTrigger] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  const [chatSessionState, setChatSessionState] = useState<ChatSessionState | null>(null);
  const [sessionCommand, setSessionCommand] = useState<ChatSessionCommandEnvelope | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Tool events to feed events
  const handleToolEvents = useCallback((toolEvents: ToolEvent[]) => {
    const newFeedEvents = toolEvents.map(toolEventToFeedEvent);
    setFeedEvents(newFeedEvents);
  }, []);

  const handleClearFeed = useCallback(() => {
    setFeedEvents([]);
    setClearFeedTrigger((prev) => prev + 1);
  }, []);

  // Fetch health when authenticated
  useEffect(() => {
    if (!auth.isAuthed) return;
    fetchHealth()
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, [auth.isAuthed]);

  // Poll actions
  useEffect(() => {
    if (!auth.isAuthed) return;
    const interval = setInterval(() => {
      fetchActions()
        .then((data) => setActions(data.actions))
        .catch(console.error);
    }, 2000);
    return () => clearInterval(interval);
  }, [auth.isAuthed]);

  // Action handlers
  const handleApprove = async (actionId: string) => {
    try {
      await approveAction(actionId);
      const data = await fetchActions();
      setActions(data.actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    }
  };

  const handleReject = async (actionId: string) => {
    try {
      await rejectAction(actionId);
      const data = await fetchActions();
      setActions(data.actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    }
  };

  const handleRetry = async (actionId: string) => {
    try {
      await retryAction(actionId);
      const data = await fetchActions();
      setActions(data.actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry');
    }
  };

  // Agent icon/phase for header
  const agentIcon = activeAgent === 'chapo'
    ? '🎯'
    : activeAgent === 'koda'
    ? '💻'
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
              className="bg-devai-card border border-devai-border rounded px-2 py-1 text-xs text-devai-text max-w-[220px]"
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
              className="hidden md:inline text-[11px] text-devai-accent hover:text-devai-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              title="Save current conversation to history and start fresh"
            >
              Restart
            </button>
            <button
              onClick={() => issueSessionCommand({ type: 'new' })}
              disabled={chatLoading || chatSessionState?.sessionsLoading || !chatSessionState}
              className="hidden md:inline text-[11px] text-devai-text-secondary hover:text-devai-text disabled:opacity-50"
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

      {/* Main Content - Chat centered */}
      <div className="flex-1 flex w-full overflow-hidden min-h-0">
        <div className="flex flex-col min-w-0 min-h-0 overflow-hidden flex-1 max-w-4xl mx-auto w-full">
          <ChatUI
            projectRoot={health?.projectRoot}
            skillIds={skills.selectedSkillIds}
            allowedRoots={health?.allowedRoots}
            pinnedFiles={settings.pinnedFiles}
            ignorePatterns={settings.ignorePatterns}
            projectContextOverride={settings.projectContextOverride}
            onPinFile={settings.addPinnedFile}
            onContextUpdate={(stats) => setContextStats(stats)}
            onToolEvent={handleToolEvents}
            onLoadingChange={setChatLoading}
            onAgentChange={handleAgentChange}
            clearFeedTrigger={clearFeedTrigger}
            showSessionControls={false}
            sessionCommand={sessionCommand}
            onSessionStateChange={setChatSessionState}
          />
        </div>
      </div>

      {/* Burger Menu */}
      <BurgerMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        allowedRoots={health?.allowedRoots}
        skills={skills.skills}
        selectedSkillIds={skills.selectedSkillIds}
        skillsLoadedAt={skills.skillsLoadedAt}
        skillsErrors={skills.skillsErrors}
        onToggleSkill={skills.handleToggleSkill}
        onReloadSkills={skills.handleReloadSkills}
        skillsLoading={skills.skillsLoading}
        projectRoot={health?.projectRoot || null}
        projectContext={project.projectContext}
        projectContextLoadedAt={project.projectContextLoadedAt}
        onRefreshProject={project.handleRefreshProject}
        projectLoading={project.projectLoading}
        pinnedFiles={settings.pinnedFiles}
        onUnpinFile={settings.removePinnedFile}
        ignorePatterns={settings.ignorePatterns}
        onUpdateIgnorePatterns={settings.setIgnorePatterns}
        projectContextOverride={settings.projectContextOverride}
        onUpdateProjectContextOverride={settings.setProjectContextOverride}
        contextStats={contextStats}
        mcpServers={health?.mcp}
      />
    </div>
    </ErrorBoundary>
  );
}

export default App;
