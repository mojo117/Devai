import { useState, useEffect } from 'react';
import { ChatUI } from './components/ChatUI';
import { ProjectInfo } from './components/ProjectInfo';
import { ActionCard } from './components/ActionCard';
import { ToolsPanel } from './components/ToolsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { PromptsPanel } from './components/PromptsPanel';
import { ProviderSelect } from './components/ProviderSelect';
import { ActionsPage } from './components/ActionsPage';
import {
  fetchHealth,
  fetchActions,
  approveAction,
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
  LLMProvider,
  Action,
  HealthResponse,
  SkillSummary,
  ProjectContext,
  PinnedFilesSetting,
} from './types';

function App() {
  const [provider, setProvider] = useState<LLMProvider>('openai');
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
  const [view, setView] = useState<'chat' | 'actions'>('chat');

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

    const loadProvider = async () => {
      try {
        const stored = await fetchSetting('preferredProvider');
        const storedValue = stored.value;
        if (storedValue === 'anthropic' || storedValue === 'openai' || storedValue === 'gemini') {
          if (isMounted) setProvider(storedValue);
        }
      } catch {
        // Ignore missing settings.
      }
    };

    loadProvider();

    return () => {
      isMounted = false;
    };
  }, [isAuthed]);

  useEffect(() => {
    if (!health?.providers) return;
    const providers = health.providers;
    const isConfigured = providers[provider];
    if (isConfigured) return;

    if (providers.openai) {
      setProvider('openai');
      return;
    }
    if (providers.anthropic) {
      setProvider('anthropic');
      return;
    }
    if (providers.gemini) {
      setProvider('gemini');
    }
  }, [health?.providers, provider]);

  useEffect(() => {
    if (!isAuthed || !health?.projectRoot) return;
    setProjectLoading(true);
    fetchProject()
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
    saveSetting('preferredProvider', provider).catch(() => {
      // Non-blocking persistence; ignore errors here.
    });
  }, [isAuthed, provider]);

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
    setProjectLoading(true);
    try {
      const data = await refreshProject();
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

  const configuredProviders = health?.providers;
  const hasConfiguredProvider = configuredProviders
    ? configuredProviders.anthropic || configuredProviders.openai || configuredProviders.gemini
    : true;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Tools Panel (collapsible) */}
      <ToolsPanel
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
      />

      {/* History Panel (collapsible, right side) */}
      <HistoryPanel />

      {/* Prompts Panel (collapsible, left side) */}
      <PromptsPanel />

      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-blue-400">DevAI</h1>
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={() => setView('chat')}
                className={`px-3 py-1.5 rounded border ${
                  view === 'chat'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'border-gray-700 text-gray-300 hover:bg-gray-800'
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setView('actions')}
                className={`px-3 py-1.5 rounded border ${
                  view === 'actions'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'border-gray-700 text-gray-300 hover:bg-gray-800'
                }`}
              >
                Actions
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ProviderSelect
              value={provider}
              onChange={setProvider}
              available={configuredProviders || undefined}
            />
            {!hasConfiguredProvider && (
              <span className="text-xs text-red-300">
                No provider configured
              </span>
            )}
            <ProjectInfo projectRoot={health?.projectRoot} />
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/50 border-b border-red-700 px-6 py-2 text-red-200 text-sm">
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
      <div className="flex-1 flex max-w-6xl mx-auto w-full">
        {view === 'chat' ? (
          <>
            {/* Chat Area */}
            <div className="flex-1 flex flex-col">
              <ChatUI
                provider={provider}
                projectRoot={health?.projectRoot}
                skillIds={selectedSkillIds}
                allowedRoots={health?.allowedRoots}
                pinnedFiles={pinnedFiles}
                onPinFile={(file) => setPinnedFiles((prev) => (prev.includes(file) ? prev : [...prev, file]))}
              />
            </div>

            {/* Actions Sidebar */}
            {sortedActions.length > 0 && (
              <aside className="w-80 border-l border-gray-700 p-4 overflow-y-auto">
                <h2 className="text-sm font-semibold text-gray-400 mb-4">
                  Actions ({sortedActions.length})
                </h2>

                {pendingActions.length > 0 && (
                  <div className="mb-6">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                      Pending ({pendingActions.length})
                    </div>
                    <div className="space-y-3">
                      {pendingActions.map((action) => (
                        <ActionCard
                          key={action.id}
                          action={action}
                          onApprove={() => handleApprove(action.id)}
                          onReject={() => handleReject(action.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {activeActions.length > 0 && (
                  <div className="mb-6">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                      In Progress ({activeActions.length})
                    </div>
                    <div className="space-y-3">
                      {activeActions.map((action) => (
                        <ActionCard
                          key={action.id}
                          action={action}
                          onApprove={() => handleApprove(action.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {completedActions.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
                      Completed ({completedActions.length})
                    </div>
                    <div className="space-y-3">
                      {completedActions.map((action) => (
                        <ActionCard
                          key={action.id}
                          action={action}
                          onApprove={() => handleApprove(action.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            )}
          </>
        ) : (
          <ActionsPage
            actions={sortedActions}
            onApprove={handleApprove}
            onReject={handleReject}
            onRefresh={async () => {
              const data = await fetchActions();
              setActions(data.actions);
            }}
          />
        )}
      </div>

      {/* Status Bar */}
      <footer className="bg-gray-800 border-t border-gray-700 px-6 py-2 text-xs text-gray-500">
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
    </div>
  );
}

export default App;
