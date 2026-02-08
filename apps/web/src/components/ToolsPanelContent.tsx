import { useEffect, useState } from 'react';
import type {
  ProjectContext,
  ProjectFileEntry,
  ProjectSearchMatch,
  SkillSummary,
  McpServerStatus,
} from '../types';
import { listProjectFiles, readProjectFile, searchProjectFiles } from '../api';
import { McpStatus } from './McpStatus';

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

interface ToolsPanelContentProps {
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
  pinnedFiles: string[];
  onUnpinFile: (file: string) => void;
  ignorePatterns: string[];
  onUpdateIgnorePatterns: (patterns: string[]) => void;
  projectContextOverride: { enabled: boolean; summary: string };
  onUpdateProjectContextOverride: (override: { enabled: boolean; summary: string }) => void;
  contextStats?: {
    tokensUsed: number;
    tokenBudget: number;
    note?: string;
  } | null;
  mcpServers?: McpServerStatus[];
}

export function ToolsPanelContent({
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
  pinnedFiles,
  onUnpinFile,
  ignorePatterns,
  onUpdateIgnorePatterns,
  projectContextOverride,
  onUpdateProjectContextOverride,
  contextStats,
  mcpServers,
}: ToolsPanelContentProps) {
  const [filesPath, setFilesPath] = useState('.');
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchGlob, setSearchGlob] = useState('');
  const [searchResults, setSearchResults] = useState<ProjectSearchMatch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [filePreviewPath, setFilePreviewPath] = useState<string | null>(null);
  const [filePreviewContent, setFilePreviewContent] = useState<string | null>(null);
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [ignoreInput, setIgnoreInput] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [overrideEnabledDraft, setOverrideEnabledDraft] = useState(false);

  useEffect(() => {
    if (!selectedRoot) return;
    setFilesLoading(true);
    setFilesError(null);
    const path = filesPath === '.' ? selectedRoot : `${selectedRoot}/${filesPath}`;
    listProjectFiles(path, ignorePatterns)
      .then((data) => setFiles(data.files))
      .catch((err) => setFilesError(err instanceof Error ? err.message : 'Failed to load files'))
      .finally(() => setFilesLoading(false));
  }, [filesPath, selectedRoot, ignorePatterns]);

  useEffect(() => {
    if (allowedRoots && allowedRoots.length > 0) {
      setSelectedRoot((prev) => prev || allowedRoots[0]);
    }
  }, [allowedRoots]);

  useEffect(() => {
    setFilesPath('.');
    setSearchResults([]);
    setSearchError(null);
  }, [selectedRoot]);

  useEffect(() => {
    setIgnoreInput(ignorePatterns.join('\n'));
  }, [ignorePatterns]);

  useEffect(() => {
    if (editingSummary) return;
    setOverrideEnabledDraft(projectContextOverride.enabled);
    if (projectContextOverride.summary) {
      setSummaryDraft(projectContextOverride.summary);
      return;
    }
    setSummaryDraft(projectContext?.summary || '');
  }, [projectContextOverride, projectContext, editingSummary]);

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

  const handleSearch = async () => {
    if (!searchQuery.trim() || !selectedRoot) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const data = await searchProjectFiles(
        searchQuery.trim(),
        selectedRoot,
        searchGlob.trim() || undefined,
        ignorePatterns
      );
      setSearchResults(data.matches);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSaveSummary = () => {
    onUpdateProjectContextOverride({
      enabled: overrideEnabledDraft,
      summary: summaryDraft.trim(),
    });
    setEditingSummary(false);
  };

  const handleApplyIgnore = () => {
    const patterns = ignoreInput
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    onUpdateIgnorePatterns(patterns);
  };

  const handlePreviewFile = async (relativePath: string) => {
    if (!selectedRoot) return;
    const fullPath = `${selectedRoot}/${relativePath}`;
    setFilePreviewLoading(true);
    setFilePreviewError(null);
    setFilePreviewPath(relativePath);
    try {
      const data = await readProjectFile(fullPath);
      setFilePreviewContent(data.content);
    } catch (err) {
      setFilePreviewContent(null);
      setFilePreviewError(err instanceof Error ? err.message : 'Failed to read file');
    } finally {
      setFilePreviewLoading(false);
    }
  };

  return (
    <div className="p-4">
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
          <div className="mt-2 text-[11px] bg-gray-900 p-2 rounded text-gray-300 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400">
              <div>
                <div className="uppercase tracking-wide text-gray-500">Framework</div>
                <div className="text-gray-300">{projectContext.framework}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-gray-500">Language</div>
                <div className="text-gray-300">{projectContext.language}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-gray-500">Package Manager</div>
                <div className="text-gray-300">{projectContext.packageManager}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-gray-500">Tests</div>
                <div className="text-gray-300">{projectContext.hasTests ? 'Yes' : 'No'}</div>
              </div>
              {projectContext.testCommand && (
                <div className="col-span-2">
                  <div className="uppercase tracking-wide text-gray-500">Test Command</div>
                  <div className="text-gray-300">{projectContext.testCommand}</div>
                </div>
              )}
              {projectContext.buildCommand && (
                <div className="col-span-2">
                  <div className="uppercase tracking-wide text-gray-500">Build Command</div>
                  <div className="text-gray-300">{projectContext.buildCommand}</div>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-500 uppercase tracking-wide">
                <span>Summary</span>
                <button
                  onClick={() => setEditingSummary((prev) => !prev)}
                  className="text-[10px] text-gray-400 hover:text-gray-200"
                >
                  {editingSummary ? 'Close' : 'Edit'}
                </button>
              </div>
              {editingSummary ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={summaryDraft}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                    rows={5}
                    className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200"
                  />
                  <label className="flex items-center gap-2 text-[10px] text-gray-400">
                    <input
                      type="checkbox"
                      checked={overrideEnabledDraft}
                      onChange={(e) => setOverrideEnabledDraft(e.target.checked)}
                    />
                    Use override in prompt
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveSummary}
                      className="text-[10px] text-gray-200 bg-blue-600 px-2 py-1 rounded"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingSummary(false);
                        setSummaryDraft(projectContextOverride.summary || projectContext?.summary || '');
                        setOverrideEnabledDraft(projectContextOverride.enabled);
                      }}
                      className="text-[10px] text-gray-400 hover:text-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <pre className="mt-2 whitespace-pre-wrap text-gray-300">
                  {(projectContextOverride.enabled && projectContextOverride.summary)
                    ? projectContextOverride.summary
                    : projectContext.summary}
                </pre>
              )}
              {projectContextOverride.enabled && !editingSummary && (
                <p className="text-[10px] text-blue-300 mt-1">
                  Using user-provided summary override.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500 mt-2">
            Project context not available.
          </p>
        )}
        {contextStats && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-gray-500">
              <span>Context usage</span>
              <span>
                ~{contextStats.tokensUsed}/{contextStats.tokenBudget}
              </span>
            </div>
            <div className="mt-1 h-2 bg-gray-900 rounded">
              <div
                className="h-2 rounded bg-blue-600"
                style={{
                  width: `${Math.min(100, Math.round((contextStats.tokensUsed / contextStats.tokenBudget) * 100))}%`,
                }}
              />
            </div>
            {contextStats.note && (
              <p className="text-[10px] text-gray-500 mt-1">
                {contextStats.note}
              </p>
            )}
          </div>
        )}
        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
            Pinned Files
          </div>
          {pinnedFiles.length === 0 ? (
            <p className="text-xs text-gray-500">No pinned files.</p>
          ) : (
            <div className="space-y-1">
              {pinnedFiles.map((file) => (
                <div
                  key={file}
                  className="flex items-center justify-between bg-gray-900 rounded px-2 py-1 text-[11px] text-gray-200"
                >
                  <span className="truncate">{file}</span>
                  <button
                    onClick={() => onUnpinFile(file)}
                    className="text-[10px] text-gray-400 hover:text-gray-200"
                  >
                    Unpin
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
            Ignore Patterns
          </div>
          <textarea
            value={ignoreInput}
            onChange={(e) => setIgnoreInput(e.target.value)}
            rows={3}
            placeholder="e.g. node_modules/**, **/dist/**"
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[11px] text-gray-200"
          />
          <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500">
            <span>{ignorePatterns.length} active</span>
            <button
              onClick={handleApplyIgnore}
              className="text-[10px] text-gray-400 hover:text-gray-200"
            >
              Apply
            </button>
          </div>
        </div>
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

      {/* MCP Servers Section */}
      <div className="border-t border-gray-700 pt-4 mt-4 mb-5">
        <McpStatus servers={mcpServers ?? []} />
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
          Root: {selectedRoot || 'none'} / {filesPath}
        </p>
        {!selectedRoot ? (
          <p className="text-xs text-gray-500 mt-2">No allowed root selected.</p>
        ) : (
          <>
            {allowedRoots && allowedRoots.length > 1 && (
              <div className="mt-2">
                <label className="text-[11px] text-gray-500">Root</label>
                <select
                  value={selectedRoot}
                  onChange={(e) => setSelectedRoot(e.target.value)}
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                >
                  {allowedRoots.map((root) => (
                    <option key={root} value={root}>
                      {root}
                    </option>
                  ))}
                </select>
              </div>
            )}
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

      <div className="mb-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-400">
            Repo Search
          </h2>
          <button
            onClick={handleSearch}
            disabled={searchLoading || !searchQuery.trim() || !selectedRoot}
            className="text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            {searchLoading ? 'Searching...' : 'Run'}
          </button>
        </div>
        <div className="mt-2 space-y-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pattern"
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          />
          <input
            value={searchGlob}
            onChange={(e) => setSearchGlob(e.target.value)}
            placeholder="Glob filter (optional)"
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
          />
        </div>
        {searchError && (
          <p className="text-xs text-red-300 mt-2">{searchError}</p>
        )}
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-2">
            {searchResults.slice(0, 20).map((match, idx) => (
              <div key={`${match.file}-${match.line}-${idx}`} className="bg-gray-900 rounded p-2 text-xs text-gray-200">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-blue-300 truncate">
                    {match.file}:{match.line}
                  </span>
                  <button
                    onClick={() => handlePreviewFile(match.file)}
                    className="text-[10px] text-gray-400 hover:text-gray-200"
                  >
                    Open
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">{match.content}</p>
              </div>
            ))}
            {searchResults.length > 20 && (
              <p className="text-[10px] text-gray-500">Showing first 20 matches.</p>
            )}
          </div>
        )}
      </div>

      {filePreviewPath && (
        <div className="mb-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400">
              File Preview
            </h2>
            <button
              onClick={() => {
                setFilePreviewPath(null);
                setFilePreviewContent(null);
                setFilePreviewError(null);
              }}
              className="text-[10px] text-gray-400 hover:text-gray-200"
            >
              Close
            </button>
          </div>
          <p className="text-[10px] text-gray-600 mt-1 truncate">{filePreviewPath}</p>
          {filePreviewLoading && (
            <p className="text-xs text-gray-500 mt-2">Loading preview...</p>
          )}
          {filePreviewError && (
            <p className="text-xs text-red-300 mt-2">{filePreviewError}</p>
          )}
          {filePreviewContent && (
            <pre className="mt-2 text-[11px] bg-gray-900 p-2 rounded text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {filePreviewContent.length > 2000
                ? `${filePreviewContent.slice(0, 2000)}\n...`
                : filePreviewContent}
            </pre>
          )}
        </div>
      )}

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

      {/* Allowed Paths Section */}
      {allowedRoots && allowedRoots.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">
            Allowed Paths
          </h2>
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
        </div>
      )}
    </div>
  );
}
