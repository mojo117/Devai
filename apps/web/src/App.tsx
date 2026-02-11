import { useState, useEffect, useCallback } from 'react';
import { ChatUI, type ToolEvent, type ChatSessionState, type ChatSessionCommand, type ChatSessionCommandEnvelope } from './components/ChatUI';
import { type AgentName, type AgentPhase } from './components/AgentStatus';
import { LeftSidebar, LEFT_SIDEBAR_WIDTH } from './components/LeftSidebar';
import { ActionsPage } from './components/ActionsPage';
import { SystemFeed, type FeedEvent, toolEventToFeedEvent } from './components/SystemFeed';
import { ResizableDivider } from './components/ResizableDivider';
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
  const [view, setView] = useState<'chat' | 'actions'>('chat');
  const [contextStats, setContextStats] = useState<{
    tokensUsed: number;
    tokenBudget: number;
    note?: string;
  } | null>(null);
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [feedWidth, setFeedWidth] = useState(384);
  const [clearFeedTrigger, setClearFeedTrigger] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'feed'>('chat');
  const [isMobile, setIsMobile] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  const [chatSessionState, setChatSessionState] = useState<ChatSessionState | null>(null);
  const [sessionCommand, setSessionCommand] = useState<ChatSessionCommandEnvelope | null>(null);

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

  const handleFeedResize = useCallback((deltaX: number) => {
    setFeedWidth((prev) => Math.max(200, Math.min(800, prev - deltaX)));
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

  // Auth loading screen
  if (!auth.authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-200">
        <div className="text-sm text-gray-400">Checking credentials...</div>
      </div>
    );
  }

  // Login screen
  if (!auth.isAuthed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-200 px-4">
        <form
          onSubmit={auth.handleLogin}
          className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-lg p-6 shadow-xl"
        >
          <h1 className="text-xl font-semibold text-blue-400 mb-2">DevAI Login</h1>
          <p className="text-sm text-gray-400 mb-6">Sign in to access the DevAI dashboard.</p>

          {auth.authError && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {auth.authError}
            </div>
          )}

          <label className="block text-sm text-gray-300 mb-2" htmlFor="username">
            E-Mail
          </label>
          <input
            id="username"
            type="email"
            value={auth.username}
            onChange={(e) => auth.setUsername(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="name@example.com"
            required
          />

          <label className="block text-sm text-gray-300 mt-4 mb-2" htmlFor="password">
            Passwort
          </label>
          <input
            id="password"
            type="password"
            value={auth.password}
            onChange={(e) => auth.setPassword(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="********"
            required
          />

          <button
            type="submit"
            className="mt-6 w-full rounded-md bg-blue-500 py-2 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-60"
            disabled={auth.authLoading || !auth.username || !auth.password}
          >
            {auth.authLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  const sortedActions = [...actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const agentIcon = activeAgent === 'chapo'
    ? '🎯'
    : activeAgent === 'koda'
    ? '💻'
    : activeAgent === 'devo'
    ? '🔧'
    : activeAgent === 'scout'
    ? '🔍'
    : '🤖';
  const agentPhaseShort = agentPhase === 'thinking'
    ? 'Thinking'
    : (agentPhase === 'execution' || agentPhase === 'executing')
    ? 'Exec'
    : agentPhase === 'error'
    ? 'Error'
    : agentPhase === 'qualification'
    ? '...'
    : agentPhase === 'review'
    ? 'Review'
    : 'Ready';

  return (
    <ErrorBoundary>
    <div className="min-h-screen flex flex-col">
      {/* Left Sidebar - hidden on mobile */}
      {!isMobile && <LeftSidebar
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
      />}

      {/* Header */}
      <header
        className="sticky top-0 z-40 bg-gray-800/95 backdrop-blur border-b border-gray-700 px-3 md:px-4 py-2"
        style={{ marginLeft: isMobile ? 0 : LEFT_SIDEBAR_WIDTH }}
      >
        <div className="flex items-center justify-between gap-2">
          {/* Left: Logo + View Toggle */}
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-blue-400">DevAI</h1>
            <div className="flex text-[11px]">
              <button
                onClick={() => setView('chat')}
                className={`px-2 py-1 rounded-l border-y border-l ${
                  view === 'chat'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'border-gray-600 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setView('actions')}
                className={`px-2 py-1 rounded-r border ${
                  view === 'actions'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'border-gray-600 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Actions
              </button>
            </div>
          </div>

          {/* Center: Multi-Agent + Sessions */}
          <div className="hidden sm:flex flex-1 items-center justify-center gap-3">
            <div className="flex items-center gap-1 text-[11px]">
            <span className={`px-1.5 py-0.5 rounded ${activeAgent === 'chapo' ? 'bg-purple-600/30 text-purple-300' : 'text-gray-500'}`} title="CHAPO - Coordinator">
              🎯
            </span>
            <span className="text-gray-600">→</span>
            <span className={`px-1.5 py-0.5 rounded ${activeAgent === 'koda' ? 'bg-blue-600/30 text-blue-300' : 'text-gray-500'}`} title="KODA - Developer">
              💻
            </span>
            <span className={`px-1.5 py-0.5 rounded ${activeAgent === 'devo' ? 'bg-green-600/30 text-green-300' : 'text-gray-500'}`} title="DEVO - DevOps">
              🔧
            </span>
            <span className={`px-1.5 py-0.5 rounded ${activeAgent === 'scout' ? 'bg-orange-600/30 text-orange-300' : 'text-gray-500'}`} title="SCOUT - Explorer">
              🔍
            </span>
            {activeAgent && (
              <span className={`ml-1 text-[10px] ${
                agentPhase === 'thinking' ? 'text-cyan-400 animate-pulse' :
                agentPhase === 'execution' || agentPhase === 'executing' ? 'text-yellow-400' :
                agentPhase === 'error' ? 'text-red-400' :
                'text-gray-500'
              }`}>
                {agentPhase === 'qualification' && '...'}
                {agentPhase === 'thinking' && '💭'}
                {(agentPhase === 'execution' || agentPhase === 'executing') && '⚡'}
                {agentPhase === 'idle' && '✓'}
              </span>
            )}
            </div>

            {view === 'chat' && (
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                <span className="hidden md:inline">Session</span>
                <select
                  value={chatSessionState?.sessionId || chatSessionState?.sessions[0]?.id || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    issueSessionCommand({ type: 'select', sessionId: v });
                  }}
                  disabled={chatLoading || chatSessionState?.sessionsLoading || !chatSessionState || chatSessionState.sessions.length === 0}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 max-w-[220px]"
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
                  className="hidden md:inline text-[11px] text-orange-400 hover:text-orange-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Save current conversation to history and start fresh"
                >
                  Restart
                </button>
                <button
                  onClick={() => issueSessionCommand({ type: 'new' })}
                  disabled={chatLoading || chatSessionState?.sessionsLoading || !chatSessionState}
                  className="hidden md:inline text-[11px] text-gray-300 hover:text-white disabled:opacity-50"
                >
                  New
                </button>
              </div>
            )}
          </div>

          {/* Right: Status + Project */}
          <div className="flex items-center gap-3 text-[11px]">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${
                agentPhase === 'error'
                  ? 'border-red-700 bg-red-900/20 text-red-300'
                  : agentPhase === 'thinking'
                  ? 'border-cyan-700 bg-cyan-900/10 text-cyan-300'
                  : (agentPhase === 'execution' || agentPhase === 'executing')
                  ? 'border-yellow-700 bg-yellow-900/10 text-yellow-300'
                  : 'border-gray-700 bg-gray-900/20 text-gray-300'
              }`}
              title="Multi-agent status"
            >
              <span>{agentIcon}</span>
              <span className="hidden md:inline">MA</span>
              <span className="text-[10px] opacity-80">{agentPhaseShort}</span>
            </span>
            <span className={`${health ? 'text-green-400' : 'text-yellow-400'}`}>
              {health ? '● Online' : '○ ...'}
            </span>
            {view === 'chat' && (
              <select
                value={chatSessionState?.sessionId || chatSessionState?.sessions[0]?.id || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  issueSessionCommand({ type: 'select', sessionId: v });
                }}
                disabled={chatLoading || chatSessionState?.sessionsLoading || !chatSessionState || chatSessionState.sessions.length === 0}
                className="sm:hidden bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 max-w-[170px]"
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
            )}
            <span className="hidden md:inline text-gray-500 truncate max-w-[150px]" title={health?.projectRoot || ''}>
              {health?.projectRoot?.split('/').pop() || ''}
            </span>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/50 border-b border-red-700 px-4 md:px-6 py-2 text-red-200 text-sm" style={{ marginLeft: isMobile ? 0 : LEFT_SIDEBAR_WIDTH }}>
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-4 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex w-full overflow-hidden min-h-0" style={{ marginLeft: isMobile ? 0 : LEFT_SIDEBAR_WIDTH }}>
        {view === 'chat' ? (
          <>
            <div className={`flex flex-col min-w-0 min-h-0 overflow-hidden ${isMobile ? (mobilePanel === 'chat' ? 'flex-1' : 'hidden') : 'flex-1'}`}>
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

            {!isMobile && <ResizableDivider onResize={handleFeedResize} />}

            <aside
              className={`min-h-0 overflow-hidden ${isMobile ? (mobilePanel === 'feed' ? 'flex-1' : 'hidden') : 'flex-shrink-0'}`}
              style={isMobile ? undefined : { width: feedWidth }}
            >
              <SystemFeed events={feedEvents} isLoading={chatLoading} onClear={handleClearFeed} />
            </aside>
          </>
        ) : (
          <ActionsPage
            actions={sortedActions}
            onApprove={handleApprove}
            onReject={handleReject}
            onRetry={handleRetry}
            onRefresh={async () => {
              const data = await fetchActions();
              setActions(data.actions);
            }}
          />
        )}
      </div>

      {/* Mobile Panel Toggle */}
      {isMobile && view === 'chat' && (
        <div className="bg-gray-800 border-t border-gray-700 px-4 py-2">
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={() => setMobilePanel('chat')}
              className={`flex-1 px-4 py-2 rounded-l-lg text-sm font-medium transition-colors ${
                mobilePanel === 'chat'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setMobilePanel('feed')}
              className={`flex-1 px-4 py-2 rounded-r-lg text-sm font-medium transition-colors ${
                mobilePanel === 'feed'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              System
            </button>
          </div>
        </div>
      )}

    </div>
    </ErrorBoundary>
  );
}

export default App;
