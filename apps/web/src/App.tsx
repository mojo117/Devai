import { useState, useEffect } from 'react';
import { ChatUI } from './components/ChatUI';
import { ProjectInfo } from './components/ProjectInfo';
import { ActionCard } from './components/ActionCard';
import { ToolsPanel } from './components/ToolsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { PromptsPanel } from './components/PromptsPanel';
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
} from './types';

function App() {
  // Default to OpenAI (GPT-4o)
  const provider: LLMProvider = 'openai';
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
    saveSetting('selectedSkills', selectedSkillIds).catch(() => {
      // Non-blocking persistence; ignore errors here.
    });
  }, [isAuthed, selectedSkillIds]);

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

  const pendingActions = actions.filter((a) => a.status === 'pending');

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
      />

      {/* History Panel (collapsible, right side) */}
      <HistoryPanel />

      {/* Prompts Panel (collapsible, left side) */}
      <PromptsPanel />

      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-blue-400">DevAI</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">Model: <span className="text-green-400">GPT-4o</span></span>
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
        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          <ChatUI
            provider={provider}
            projectRoot={health?.projectRoot}
            skillIds={selectedSkillIds}
          />
        </div>

        {/* Actions Sidebar */}
        {pendingActions.length > 0 && (
          <aside className="w-80 border-l border-gray-700 p-4 overflow-y-auto">
            <h2 className="text-sm font-semibold text-gray-400 mb-4">
              Pending Actions ({pendingActions.length})
            </h2>
            <div className="space-y-3">
              {pendingActions.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  onApprove={() => handleApprove(action.id)}
                />
              ))}
            </div>
          </aside>
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
