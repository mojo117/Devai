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
        <div className="mt-2 text-[11px] bg-devai-bg p-2 rounded text-devai-text-secondary space-y-2">
          <div className="grid grid-cols-2 gap-2 text-[10px] text-devai-text-secondary">
            <div>
              <div className="uppercase tracking-wide text-devai-text-muted">Framework</div>
              <div className="text-devai-text-secondary">{projectContext.framework}</div>
            </div>
            <div>
              <div className="uppercase tracking-wide text-devai-text-muted">Language</div>
              <div className="text-devai-text-secondary">{projectContext.language}</div>
            </div>
            <div>
              <div className="uppercase tracking-wide text-devai-text-muted">Package Manager</div>
              <div className="text-devai-text-secondary">{projectContext.packageManager}</div>
            </div>
            <div>
              <div className="uppercase tracking-wide text-devai-text-muted">Tests</div>
              <div className="text-devai-text-secondary">{projectContext.hasTests ? 'Yes' : 'No'}</div>
            </div>
            {projectContext.testCommand && (
              <div className="col-span-2">
                <div className="uppercase tracking-wide text-devai-text-muted">Test Command</div>
                <div className="text-devai-text-secondary">{projectContext.testCommand}</div>
              </div>
            )}
            {projectContext.buildCommand && (
              <div className="col-span-2">
                <div className="uppercase tracking-wide text-devai-text-muted">Build Command</div>
                <div className="text-devai-text-secondary">{projectContext.buildCommand}</div>
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-devai-text-muted uppercase tracking-wide">
              <span>Summary</span>
              <button
                onClick={() => setEditingSummary((prev) => !prev)}
                className="text-[10px] text-devai-text-secondary hover:text-devai-text"
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
                  className="w-full bg-devai-bg border border-devai-border rounded px-2 py-1 text-[11px] text-devai-text"
                />
                <label className="flex items-center gap-2 text-[10px] text-devai-text-secondary">
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
                    className="text-[10px] text-devai-text bg-devai-accent px-2 py-1 rounded"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingSummary(false);
                      setSummaryDraft(projectContextOverride.summary || projectContext?.summary || '');
                      setOverrideEnabledDraft(projectContextOverride.enabled);
                    }}
                    className="text-[10px] text-devai-text-secondary hover:text-devai-text"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <pre className="mt-2 whitespace-pre-wrap text-devai-text-secondary">
                {(projectContextOverride.enabled && projectContextOverride.summary)
                  ? projectContextOverride.summary
                  : projectContext.summary}
              </pre>
            )}
            {projectContextOverride.enabled && !editingSummary && (
              <p className="text-[10px] text-devai-accent mt-1">
                Using user-provided summary override.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-devai-text-muted mt-2">
          Project context not available.
        </p>
      )}

      {contextStats && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-devai-text-muted">
            <span>Context usage</span>
            <span>~{contextStats.tokensUsed}/{contextStats.tokenBudget}</span>
          </div>
          <div className="mt-1 h-2 bg-devai-bg rounded">
            <div
              className="h-2 rounded bg-devai-accent"
              style={{
                width: `${Math.min(100, Math.round((contextStats.tokensUsed / contextStats.tokenBudget) * 100))}%`,
              }}
            />
          </div>
          {contextStats.note && (
            <p className="text-[10px] text-devai-text-muted mt-1">{contextStats.note}</p>
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
