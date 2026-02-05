import { useState, useEffect, useCallback } from 'react';
import { ChatUI, type ToolEvent } from './components/ChatUI';
import { type AgentName, type AgentPhase } from './components/AgentStatus';
import { ProjectInfo } from './components/ProjectInfo';
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
  fetchSkills,
  reloadSkills,
  fetchProject,
  refreshProject,
  fetchSetting,
  saveSetting,
  login,
  verifyAuth,
  setAuthToken,
  clearAuthToken,
} from './api';
import type {
  Action,
  HealthResponse,
  SkillSummary,
  ProjectContext,
  PinnedFilesSetting,
  IgnorePatternsSetting,
  ProjectContextOverrideSetting,
  LLMProvider,
} from './types';

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillsLoadedAt, setSkillsLoadedAt] = useState<string | null>(null);
  const [skillsErrors, setSkillsErrors] = useState<string[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [projectContextLoadedAt, setProjectContextLoadedAt] = useState<string | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
  const [ignorePatterns, setIgnorePatterns] = useState<string[]>([]);
  const [projectContextOverride, setProjectContextOverride] = useState<ProjectContextOverrideSetting>({
    enabled: false,
    summary: '',
  });
  const [view, setView] = useState<'chat' | 'actions'>('chat');
  const [contextStats, setContextStats] = useState<{
    tokensUsed: number;
    tokenBudget: number;
    note?: string;
  } | null>(null);
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [feedWidth, setFeedWidth] = useState(384); // Default 384px (w-96)
  const [clearFeedTrigger, setClearFeedTrigger] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'feed'>('chat');
  const [isMobile, setIsMobile] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>('anthropic');

  // Handle agent state changes from ChatUI
  const handleAgentChange = useCallback((agent: AgentName | null, phase: AgentPhase) => {
    setActiveAgent(agent);
    setAgentPhase(phase);
  }, []);

  // Track window resize for mobile detection
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Convert tool events to feed events
  const handleToolEvents = useCallback((toolEvents: ToolEvent[]) => {
    const newFeedEvents = toolEvents.map(toolEventToFeedEvent);
    setFeedEvents(newFeedEvents);
  }, []);

  // Clear feed events
  const handleClearFeed = useCallback(() => {
    setFeedEvents([]);
    setClearFeedTrigger((prev) => prev + 1);
  }, []);

  // Handle resize of the system feed panel
  const handleFeedResize = useCallback((deltaX: number) => {
    setFeedWidth((prev) => {
      const newWidth = prev - deltaX; // Subtract because dragging right should shrink the feed
      return Math.max(200, Math.min(800, newWidth)); // Clamp between 200px and 800px
    });
  }, []);

  useEffect(() => {
    verifyAuth()
      .then((valid) => {
        setIsAuthed(valid);
        if (!valid) clearAuthToken();
      })
      .catch(() => setIsAuthed(false))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    fetchHealth()
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) return;
    let isMounted = true;

    const loadProjectContextOverride = async () => {
      try {
        const stored = await fetchSetting('projectContextOverride');
        const value = stored.value as ProjectContextOverrideSetting | null;
        if (!isMounted) return;
        const next = value && typeof value === 'object'
          ? {
              enabled: Boolean((value as ProjectContextOverrideSetting).enabled),
              summary: typeof (value as ProjectContextOverrideSetting).summary === 'string'
                ? (value as ProjectContextOverrideSetting).summary
                : '',
            }
          : { enabled: false, summary: '' };
        setProjectContextOverride(next);
      } catch {
        if (!isMounted) return;
        setProjectContextOverride({ enabled: false, summary: '' });
      }
    };

    loadProjectContextOverride();

    return () => {
      isMounted = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) return;
    let isMounted = true;

    const loadIgnorePatterns = async () => {
      try {
        const stored = await fetchSetting('ignorePatterns');
        const value = stored.value as IgnorePatternsSetting | null;
        if (!isMounted) return;
        const patterns = value && Array.isArray((value as IgnorePatternsSetting).patterns)
          ? (value as IgnorePatternsSetting).patterns.filter((p) => typeof p === 'string')
          : [];
        setIgnorePatterns(patterns);
      } catch {
        if (!isMounted) return;
        setIgnorePatterns([]);
      }
    };

    loadIgnorePatterns();

    return () => {
      isMounted = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed || !health?.projectRoot) return;
    setProjectLoading(true);
    fetchProject(health.projectRoot)
      .then((data) => {
        setProjectContext(data.context);
        setProjectContextLoadedAt(new Date().toISOString());
      })
      .catch((err) => setError(err.message))
      .finally(() => setProjectLoading(false));
  }, [isAuthed, health?.projectRoot]);

  useEffect(() => {
    if (!isAuthed) return;
    let isMounted = true;

    const load = async () => {
      setSkillsLoading(true);
      try {
        const [skillsData, storedSetting] = await Promise.all([
          fetchSkills(),
          fetchSetting('selectedSkills'),
        ]);

        if (!isMounted) return;
        setSkills(skillsData.skills);
        setSkillsLoadedAt(skillsData.loadedAt);
        setSkillsErrors(skillsData.errors || []);

        const storedIds = Array.isArray(storedSetting.value)
          ? storedSetting.value.filter((id) => typeof id === 'string')
          : [];
        const validIds = new Set(skillsData.skills.map((skill) => skill.id));
        const filtered = storedIds.filter((id) => validIds.has(id));
        setSelectedSkillIds(filtered);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load skills');
      } finally {
        if (isMounted) {
          setSkillsLoading(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) return;
    let isMounted = true;

    const loadPinned = async () => {
      try {
        const stored = await fetchSetting('pinnedFiles');
        const value = stored.value as PinnedFilesSetting | null;
        if (!isMounted) return;
        const files = value && Array.isArray((value as PinnedFilesSetting).files)
          ? (value as PinnedFilesSetting).files.filter((f) => typeof f === 'string')
          : [];
        setPinnedFiles(files);
      } catch {
        if (!isMounted) return;
        setPinnedFiles([]);
      }
    };

    loadPinned();

    return () => {
      isMounted = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) return;
    saveSetting('selectedSkills', selectedSkillIds).catch(() => {
      // Non-blocking persistence; ignore errors here.
    });
  }, [isAuthed, selectedSkillIds]);

  useEffect(() => {
    if (!isAuthed) return;
    saveSetting('pinnedFiles', { files: pinnedFiles }).catch(() => {
      // Non-blocking persistence; ignore errors here.
    });
  }, [isAuthed, pinnedFiles]);

  useEffect(() => {
    if (!isAuthed) return;
    saveSetting('ignorePatterns', { patterns: ignorePatterns }).catch(() => {
      // Non-blocking persistence; ignore errors here.
    });
  }, [isAuthed, ignorePatterns]);

  useEffect(() => {
    if (!isAuthed) return;
    saveSetting('projectContextOverride', projectContextOverride).catch(() => {
      // Non-blocking persistence; ignore errors here.
    });
  }, [isAuthed, projectContextOverride]);

  useEffect(() => {
    if (!isAuthed) return;
    const interval = setInterval(() => {
      fetchActions()
        .then((data) => setActions(data.actions))
        .catch(console.error);
    }, 2000);

    return () => clearInterval(interval);
  }, [isAuthed]);

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

  const handleToggleSkill = (skillId: string) => {
    setSelectedSkillIds((prev) => (
      prev.includes(skillId)
        ? prev.filter((id) => id !== skillId)
        : [...prev, skillId]
    ));
  };

  const handleReloadSkills = async () => {
    setSkillsLoading(true);
    try {
      const data = await reloadSkills();
      setSkills(data.skills);
      setSkillsLoadedAt(data.loadedAt);
      setSkillsErrors(data.errors || []);
      const validIds = new Set(data.skills.map((skill) => skill.id));
      const filteredIds = selectedSkillIds.filter((id) => validIds.has(id));
      setSelectedSkillIds(filteredIds);
      await saveSetting('selectedSkills', filteredIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload skills');
    } finally {
      setSkillsLoading(false);
    }
  };

  const handleRefreshProject = async () => {
    if (!health?.projectRoot) return;
    setProjectLoading(true);
    try {
      const data = await refreshProject(health.projectRoot);
      setProjectContext(data.context);
      setProjectContextLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh project');
    } finally {
      setProjectLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    try {
      const result = await login(username, password);
      setAuthToken(result.token);
      setIsAuthed(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Login failed');
      clearAuthToken();
    } finally {
      setAuthLoading(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-200">
        <div className="text-sm text-gray-400">Checking credentials...</div>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-200 px-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-lg p-6 shadow-xl"
        >
          <h1 className="text-xl font-semibold text-blue-400 mb-2">DevAI Login</h1>
          <p className="text-sm text-gray-400 mb-6">Sign in to access the DevAI dashboard.</p>

          {authError && (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {authError}
            </div>
          )}

          <label className="block text-sm text-gray-300 mb-2" htmlFor="username">
            E-Mail
          </label>
          <input
            id="username"
            type="email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="********"
            required
          />

          <button
            type="submit"
            className="mt-6 w-full rounded-md bg-blue-500 py-2 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-60"
            disabled={authLoading || !username || !password}
          >
            {authLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    );
  }

  const sortedActions = [...actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingActions = sortedActions.filter((a) => a.status === 'pending');
  const activeActions = sortedActions.filter((a) => a.status === 'approved' || a.status === 'executing');
  const completedActions = sortedActions.filter((a) => a.status === 'done' || a.status === 'failed' || a.status === 'rejected');

  return (
    <ErrorBoundary>
    <div className="min-h-screen flex flex-col">
      {/* Left Sidebar with Toolbar and Panels - hidden on mobile */}
      {!isMobile && <LeftSidebar
        allowedRoots={health?.allowedRoots}
        skills={skills}
        selectedSkillIds={selectedSkillIds}
        skillsLoadedAt={skillsLoadedAt}
        skillsErrors={skillsErrors}
        onToggleSkill={handleToggleSkill}
        onReloadSkills={handleReloadSkills}
        skillsLoading={skillsLoading}
        projectRoot={health?.projectRoot || null}
        projectContext={projectContext}
        projectContextLoadedAt={projectContextLoadedAt}
        onRefreshProject={handleRefreshProject}
        projectLoading={projectLoading}
        pinnedFiles={pinnedFiles}
        onUnpinFile={(file) => setPinnedFiles((prev) => prev.filter((f) => f !== file))}
        ignorePatterns={ignorePatterns}
        onUpdateIgnorePatterns={setIgnorePatterns}
        projectContextOverride={projectContextOverride}
        onUpdateProjectContextOverride={setProjectContextOverride}
        contextStats={contextStats}
      />}

      {/* Header - with left margin for sidebar on desktop */}
      <header
        className="sticky top-0 z-40 bg-gray-800 border-b border-gray-700 px-4 md:px-6 py-3 md:py-4"
        style={{ marginLeft: isMobile ? 0 : LEFT_SIDEBAR_WIDTH }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-4">
            <h1 className="text-lg md:text-xl font-bold text-blue-400">DevAI</h1>
            <div className="flex items-center gap-1 md:gap-2 text-xs">
              <button
                onClick={() => setView('chat')}
                className={`px-2 md:px-3 py-1 md:py-1.5 rounded border ${
                  view === 'chat'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'border-gray-700 text-gray-300 hover:bg-gray-800'
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setView('actions')}
                className={`px-2 md:px-3 py-1 md:py-1.5 rounded border ${
                  view === 'actions'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'border-gray-700 text-gray-300 hover:bg-gray-800'
                }`}
              >
                Actions
              </button>
            </div>
          </div>

          {/* Agent Workflow Visualization */}
          <div className="flex items-center gap-0.5 md:gap-1 bg-gray-900/50 rounded-lg px-2 md:px-3 py-1.5 border border-gray-700">
            {/* CHAPO */}
            <div
              className={`flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-md text-xs transition-all ${
                activeAgent === 'chapo'
                  ? 'bg-purple-600/30 text-purple-300 shadow-[0_0_8px_rgba(168,85,247,0.4)]'
                  : 'text-gray-500'
              }`}
              title="CHAPO - Task Coordinator"
            >
              <span className="text-sm md:text-base">🎯</span>
              <span className="hidden lg:inline font-medium text-[11px]">CHAPO</span>
              {activeAgent === 'chapo' && (
                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" />
              )}
            </div>

            {/* Arrow CHAPO → KODA */}
            <svg className={`w-4 h-4 md:w-5 md:h-5 ${activeAgent === 'koda' || activeAgent === 'devo' ? 'text-gray-400' : 'text-gray-600'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>

            {/* KODA */}
            <div
              className={`flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-md text-xs transition-all ${
                activeAgent === 'koda'
                  ? 'bg-blue-600/30 text-blue-300 shadow-[0_0_8px_rgba(59,130,246,0.4)]'
                  : 'text-gray-500'
              }`}
              title="KODA - Senior Developer"
            >
              <span className="text-sm md:text-base">💻</span>
              <span className="hidden lg:inline font-medium text-[11px]">KODA</span>
              {activeAgent === 'koda' && (
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              )}
            </div>

            {/* Arrow KODA → DEVO */}
            <svg className={`w-4 h-4 md:w-5 md:h-5 ${activeAgent === 'devo' ? 'text-gray-400' : 'text-gray-600'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>

            {/* DEVO */}
            <div
              className={`flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-md text-xs transition-all ${
                activeAgent === 'devo'
                  ? 'bg-green-600/30 text-green-300 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                  : 'text-gray-500'
              }`}
              title="DEVO - DevOps Engineer"
            >
              <span className="text-sm md:text-base">🔧</span>
              <span className="hidden lg:inline font-medium text-[11px]">DEVO</span>
              {activeAgent === 'devo' && (
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              )}
            </div>

            {/* Status indicator */}
            {activeAgent && (
              <div className="ml-1 md:ml-2 pl-1 md:pl-2 border-l border-gray-600">
                <span className={`text-[10px] md:text-xs ${
                  agentPhase === 'execution' ? 'text-yellow-400' :
                  agentPhase === 'review' ? 'text-blue-400' :
                  agentPhase === 'error' ? 'text-red-400' :
                  'text-gray-400'
                }`}>
                  {agentPhase === 'qualification' && 'Analyzing...'}
                  {agentPhase === 'execution' && 'Working...'}
                  {agentPhase === 'review' && 'Reviewing...'}
                  {agentPhase === 'error' && 'Error'}
                  {agentPhase === 'idle' && 'Ready'}
                </span>
              </div>
            )}
          </div>

          <div className="hidden md:flex items-center gap-4">
            <ProjectInfo projectRoot={health?.projectRoot} />
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
            {/* Chat Area - shown on desktop always, on mobile only when mobilePanel is 'chat' */}
            <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden ${isMobile && mobilePanel !== 'chat' ? 'hidden' : ''}`}>
              <ChatUI
                provider={selectedProvider}
                projectRoot={health?.projectRoot}
                skillIds={selectedSkillIds}
                allowedRoots={health?.allowedRoots}
                pinnedFiles={pinnedFiles}
                ignorePatterns={ignorePatterns}
                projectContextOverride={projectContextOverride}
                onPinFile={(file) => setPinnedFiles((prev) => (prev.includes(file) ? prev : [...prev, file]))}
                onContextUpdate={(stats) => setContextStats(stats)}
                onToolEvent={handleToolEvents}
                onLoadingChange={setChatLoading}
                onAgentChange={handleAgentChange}
                clearFeedTrigger={clearFeedTrigger}
              />
            </div>

            {/* Resizable Divider - hidden on mobile */}
            {!isMobile && <ResizableDivider onResize={handleFeedResize} />}

            {/* System Feed - shown on desktop always, on mobile only when mobilePanel is 'feed' */}
            <aside
              className={`min-h-0 overflow-hidden ${isMobile ? (mobilePanel === 'feed' ? 'flex-1' : 'hidden') : 'flex-shrink-0'}`}
              style={{ width: isMobile ? '100%' : feedWidth }}
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

      {/* Mobile Panel Toggle - only shown on mobile in chat view */}
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

      {/* Status Bar - hidden on mobile */}
      {!isMobile && (
        <footer className="bg-gray-800 border-t border-gray-700 px-6 py-2 text-xs text-gray-500" style={{ marginLeft: LEFT_SIDEBAR_WIDTH }}>
          <div className="max-w-6xl mx-auto flex justify-between">
            <span>
              Status: {health ? (
                <span className="text-green-400">Connected</span>
              ) : (
                <span className="text-yellow-400">Connecting...</span>
              )}
            </span>
            <span>
              Environment: {health?.environment || 'unknown'}
            </span>
          </div>
        </footer>
      )}
    </div>
    </ErrorBoundary>
  );
}

export default App;
