import { useState, useEffect } from 'react';
import type { ProjectContext, SkillSummary, McpServerStatus } from '../types';
import { McpStatus } from './McpStatus';
import {
  ProjectContextSection,
  SkillsSection,
  FileBrowserSection,
  SearchSection,
  ToolsListSection,
  AllowedPathsSection,
} from './panels';

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
  const [selectedRoot, setSelectedRoot] = useState<string>('');

  useEffect(() => {
    if (allowedRoots && allowedRoots.length > 0) {
      setSelectedRoot((prev) => prev || allowedRoots[0]);
    }
  }, [allowedRoots]);

  return (
    <div className="p-4">
      <ProjectContextSection
        projectRoot={projectRoot}
        projectContext={projectContext}
        projectContextLoadedAt={projectContextLoadedAt}
        onRefreshProject={onRefreshProject}
        projectLoading={projectLoading}
        pinnedFiles={pinnedFiles}
        onUnpinFile={onUnpinFile}
        ignorePatterns={ignorePatterns}
        onUpdateIgnorePatterns={onUpdateIgnorePatterns}
        projectContextOverride={projectContextOverride}
        onUpdateProjectContextOverride={onUpdateProjectContextOverride}
        contextStats={contextStats}
      />

      <SkillsSection
        skills={skills}
        selectedSkillIds={selectedSkillIds}
        skillsLoadedAt={skillsLoadedAt}
        skillsErrors={skillsErrors}
        onToggleSkill={onToggleSkill}
        onReloadSkills={onReloadSkills}
        skillsLoading={skillsLoading}
      />

      <div className="border-t border-devai-border pt-4 mt-4 mb-5">
        <McpStatus servers={mcpServers ?? []} />
      </div>

      <FileBrowserSection
        allowedRoots={allowedRoots}
        ignorePatterns={ignorePatterns}
      />

      <SearchSection
        selectedRoot={selectedRoot}
        ignorePatterns={ignorePatterns}
      />

      <ToolsListSection />

      <AllowedPathsSection allowedRoots={allowedRoots} />
    </div>
  );
}
