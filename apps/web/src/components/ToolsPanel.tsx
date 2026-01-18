import { useEffect, useState } from 'react';
import type { ProjectContext, ProjectFileEntry, SkillSummary } from '../types';
import { listProjectFiles } from '../api';

interface Tool {
  name: string;
  description: string;
  requiresConfirmation: boolean;
}

const AVAILABLE_TOOLS: Tool[] = [
  { name: 'fs.listFiles', description: 'List files in a directory', requiresConfirmation: false },
  { name: 'fs.readFile', description: 'Read file contents', requiresConfirmation: false },
  { name: 'fs.writeFile', description: 'Write content to a file', requiresConfirmation: true },
  { name: 'git.status', description: 'Show git status', requiresConfirmation: false },
  { name: 'git.diff', description: 'Show git diff', requiresConfirmation: false },
  { name: 'git.commit', description: 'Create a git commit', requiresConfirmation: true },
  { name: 'github.triggerWorkflow', description: 'Trigger GitHub Actions workflow', requiresConfirmation: true },
  { name: 'github.getWorkflowRunStatus', description: 'Get workflow run status', requiresConfirmation: false },
  { name: 'logs.getStagingLogs', description: 'Get staging logs', requiresConfirmation: false },
  { name: 'askForConfirmation', description: 'Request approval for a tool action', requiresConfirmation: false },
];

interface ToolsPanelProps {
  allowedRoots?: string[];
  skills: SkillSummary[];
  selectedSkillIds: string[];
  skillsLoadedAt: string | null;
  skillsErrors: string[];
  onToggleSkill: (skillId: string) => void;
  onReloadSkills: () => void;
  skillsLoading: boolean;
  projectRoot?: string | null;
  projectContext: ProjectContext | null;
  projectContextLoadedAt: string | null;
  onRefreshProject: () => void;
  projectLoading: boolean;
}

export function ToolsPanel({
  allowedRoots,
  skills,
  selectedSkillIds,
  skillsLoadedAt,
  skillsErrors,
  onToggleSkill,
  onReloadSkills,
  skillsLoading,
  projectRoot,
  projectContext,
  projectContextLoadedAt,
  onRefreshProject,
  projectLoading,
}: ToolsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const [filesPath, setFilesPath] = useState('.');
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !projectRoot) return;
    setFilesLoading(true);
    setFilesError(null);
    listProjectFiles(filesPath)
      .then((data) => setFiles(data.files))
      .catch((err) => setFilesError(err instanceof Error ? err.message : 'Failed to load files'))
      .finally(() => setFilesLoading(false));
  }, [isOpen, filesPath, projectRoot]);

  useEffect(() => {
    if (projectRoot) {
      setFilesPath('.');
    }
  }, [projectRoot]);

  const handleOpenEntry = (entry: ProjectFileEntry) => {
    if (entry.type !== 'directory') return;
    setFilesPath((prev) => (prev === '.' ? entry.name : `${prev}/${entry.name}`));
  };

  const handleGoUp = () => {
    setFilesPath((prev) => {
      if (!prev || prev === '.') return '.';
      const parts = prev.split('/').filter(Boolean);
      if (parts.length <= 1) return '.';
      return parts.slice(0, -1).join('/');
    });
  };

  return (
    <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute right-0 top-1/2 -translate-y-1/2 bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-4 rounded-l-lg shadow-lg transition-all"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {isOpen ? '>' : '<'} Tools
      </button>

      <div
        className={`bg-gray-800 border-l border-gray-700 shadow-xl transition-all duration-300 overflow-hidden ${
          isOpen ? 'w-72' : 'w-0'
        }`}
      >
        <div className="w-72 h-screen overflow-y-auto p-4">
          <div className="mb-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-400">
                Context
              </h2>
              <button
                onClick={onRefreshProject}
                disabled={projectLoading || !projectRoot}
                className="text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
              >
                {projectLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            {projectContextLoadedAt && (
              <p className="text-[10px] text-gray-600 mt-1">
                Loaded: {new Date(projectContextLoadedAt).toLocaleTimeString()}
              </p>
            )}
            {projectContext ? (
              <pre className="mt-2 text-[11px] bg-gray-900 p-2 rounded text-gray-300 whitespace-pre-wrap">
                {projectContext.summary}
              </pre>
            ) : (
              <p className="text-xs text-gray-500 mt-2">
                Project context not available.
              </p>
            )}
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-400">
                Skills ({skills.length})
              </h2>
              <button
                onClick={onReloadSkills}
                disabled={skillsLoading}
                className="text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
              >
                {skillsLoading ? 'Loading...' : 'Reload'}
              </button>
            </div>
            {skillsLoadedAt && (
              <p className="text-[10px] text-gray-600 mt-1">
                Loaded: {new Date(skillsLoadedAt).toLocaleTimeString()}
              </p>
            )}
            {skillsErrors.length > 0 && (
              <div className="mt-2 text-[10px] text-red-300 space-y-1">
                {skillsErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            )}
            {skills.length > 0 ? (
              <div className="mt-3 space-y-2">
                {skills.map((skill) => (
                  <label
                    key={skill.id}
                    className="flex items-start gap-2 bg-gray-900 rounded p-2 text-xs text-gray-200"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedSkillIds.includes(skill.id)}
                      onChange={() => onToggleSkill(skill.id)}
                    />
                    <span>
                      <span className="block font-semibold text-blue-300">{skill.name}</span>
                      <span className="block text-[11px] text-gray-500">{skill.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 mt-2">
                No skills loaded. Add manifests under the skills folder.
              </p>
            )}
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-400">
                Project Files
              </h2>
              <button
                onClick={handleGoUp}
                disabled={filesPath === '.'}
                className="text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
              >
                Up
              </button>
            </div>
            <p className="text-[10px] text-gray-600 mt-1">
              Path: {filesPath}
            </p>
            {!projectRoot ? (
              <p className="text-xs text-gray-500 mt-2">Project root not configured.</p>
            ) : (
              <>
                {filesError && (
                  <p className="text-xs text-red-300 mt-2">{filesError}</p>
                )}
                {filesLoading ? (
                  <p className="text-xs text-gray-500 mt-2">Loading files...</p>
                ) : (
                  <div className="mt-2 space-y-1">
                    {files.length === 0 ? (
                      <p className="text-xs text-gray-500">No files found.</p>
                    ) : (
                      files.map((entry) => (
                        <button
                          key={`${filesPath}/${entry.name}`}
                          onClick={() => handleOpenEntry(entry)}
                          className="w-full text-left text-xs bg-gray-900 hover:bg-gray-700 rounded px-2 py-1 text-gray-300 flex items-center justify-between"
                          disabled={entry.type !== 'directory'}
                        >
                          <span className="truncate">
                            {entry.type === 'directory' ? '[dir]' : '[file]'} {entry.name}
                          </span>
                          {entry.type === 'directory' && (
                            <span className="text-[10px] text-gray-500">open</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <h2 className="text-sm font-semibold text-gray-400 mb-4">
            Available Tools ({AVAILABLE_TOOLS.length})
          </h2>

          <div className="space-y-2">
            {AVAILABLE_TOOLS.map((tool) => (
              <div
                key={tool.name}
                className="bg-gray-900 rounded p-2 text-xs"
              >
                <div className="flex items-center justify-between mb-1">
                  <code className="text-blue-400 font-mono text-xs">
                    {tool.name}
                  </code>
                  {tool.requiresConfirmation && (
                    <span className="bg-yellow-600 text-yellow-100 px-1.5 py-0.5 rounded text-[10px]">
                      confirm
                    </span>
                  )}
                </div>
                <p className="text-gray-500 text-[11px]">{tool.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-gray-700">
            <p className="text-[10px] text-gray-600">
              Tools marked with <span className="text-yellow-500">confirm</span> require user approval before execution.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={() => setIsAccessOpen(!isAccessOpen)}
        className="absolute right-0 top-[calc(50%+180px)] -translate-y-1/2 bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-4 rounded-l-lg shadow-lg transition-all"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {isAccessOpen ? '>' : '<'} Access
      </button>

      <div
        className={`absolute right-0 top-[calc(50%+180px)] -translate-y-1/2 bg-gray-800 border-l border-gray-700 shadow-xl transition-all duration-300 overflow-hidden ${
          isAccessOpen ? 'w-64' : 'w-0'
        }`}
      >
        <div className="w-64 max-h-[60vh] overflow-y-auto p-4">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">
            Allowed Paths
          </h2>
          {allowedRoots && allowedRoots.length > 0 ? (
            <div className="space-y-2">
              {allowedRoots.map((root) => (
                <div
                  key={root}
                  className="bg-gray-900 rounded p-2 text-xs text-gray-300 font-mono break-all"
                >
                  {root}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              No allowed paths configured.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
