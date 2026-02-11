import { useState, useEffect } from 'react';
import type { ProjectContext } from '../../types';
import { PanelSection } from './PanelSection';
import { PinnedFilesSection } from './PinnedFilesSection';
import { IgnorePatternsSection } from './IgnorePatternsSection';

interface ProjectContextSectionProps {
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
  contextStats?: { tokensUsed: number; tokenBudget: number; note?: string } | null;
}

export function ProjectContextSection({
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
}: ProjectContextSectionProps) {
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [overrideEnabledDraft, setOverrideEnabledDraft] = useState(false);

  useEffect(() => {
    if (editingSummary) return;
    setOverrideEnabledDraft(projectContextOverride.enabled);
    if (projectContextOverride.summary) {
      setSummaryDraft(projectContextOverride.summary);
      return;
    }
    setSummaryDraft(projectContext?.summary || '');
  }, [projectContextOverride, projectContext, editingSummary]);

  const handleSaveSummary = () => {
    onUpdateProjectContextOverride({
      enabled: overrideEnabledDraft,
      summary: summaryDraft.trim(),
    });
    setEditingSummary(false);
  };

  return (
    <PanelSection
      title="Context"
      loadedAt={projectContextLoadedAt}
      loading={projectLoading}
      onAction={onRefreshProject}
      actionDisabled={!projectRoot}
    >
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
            <span>~{contextStats.tokensUsed}/{contextStats.tokenBudget}</span>
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
            <p className="text-[10px] text-gray-500 mt-1">{contextStats.note}</p>
          )}
        </div>
      )}

      <PinnedFilesSection pinnedFiles={pinnedFiles} onUnpinFile={onUnpinFile} />
      <IgnorePatternsSection
        ignorePatterns={ignorePatterns}
        onUpdateIgnorePatterns={onUpdateIgnorePatterns}
      />
    </PanelSection>
  );
}
