import { useState, useEffect } from 'react';
import { ChatUI } from './components/ChatUI';
import { ProjectInfo } from './components/ProjectInfo';
import { ActionCard } from './components/ActionCard';
import { ToolsPanel } from './components/ToolsPanel';
import { HistoryPanel } from './components/HistoryPanel';
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

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!health?.projectRoot) return;
    setProjectLoading(true);
    fetchProject()
      .then((data) => {
        setProjectContext(data.context);
        setProjectContextLoadedAt(new Date().toISOString());
      })
      .catch((err) => setError(err.message))
      .finally(() => setProjectLoading(false));
  }, [health?.projectRoot]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    saveSetting('selectedSkills', selectedSkillIds).catch(() => {
      // Non-blocking persistence; ignore errors here.
    });
  }, [selectedSkillIds]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchActions()
        .then((data) => setActions(data.actions))
        .catch(console.error);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

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

      {/* History Panel (collapsible) */}
      <HistoryPanel />

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
