import { useState, useEffect, useCallback } from 'react';
import type {
  ProjectContext,
  SkillSummary,
  McpServerStatus,
} from '../types';
import { PromptsPanelContent } from './PromptsPanelContent';
import { ToolsPanelContent } from './ToolsPanelContent';
import { HistoryPanelContent } from './HistoryPanelContent';
import { GlobalContext } from './GlobalContext';
import { MemoryPanelContent } from './MemoryPanelContent';
import { UserfilesPanelContent } from './UserfilesPanelContent';
import { getTrustMode, setTrustMode } from '../api';
import { useAsyncData } from '../hooks/useAsyncData';

type TabType = 'history' | 'prompts' | 'tools' | 'files' | 'memory' | 'context';

interface BurgerMenuProps {
  isOpen: boolean;
  onClose: () => void;
  // Tools panel props
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

export function BurgerMenu({ isOpen, onClose, ...props }: BurgerMenuProps) {
  const [activeTab, setActiveTab] = useState<TabType>('history');
  const [isGlobalContextOpen, setIsGlobalContextOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  const fetchTrust = useCallback(() => getTrustMode(), []);
  const { data: trustData, loading: trustFetching, refresh: refreshTrust } = useAsyncData(fetchTrust, []);
  const trustMode = trustData?.mode ?? 'default';
  const trustLoading = trustFetching || toggling;

  const handleTrustToggle = useCallback(async () => {
    const newMode = trustMode === 'default' ? 'trusted' : 'default';
    setToggling(true);
    try {
      await setTrustMode(newMode);
      refreshTrust();
    } catch (error) {
      console.error('Failed to toggle trust mode:', error);
    } finally {
      setToggling(false);
    }
  }, [trustMode, refreshTrust]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabs: { id: TabType; label: string }[] = [
    { id: 'history', label: 'History' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'tools', label: 'Tools' },
    { id: 'files', label: 'Files' },
    { id: 'memory', label: 'Memory' },
    { id: 'context', label: 'Context' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <div className="fixed inset-y-0 right-0 w-80 bg-devai-surface border-l border-devai-border z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-devai-border">
          <h2 className="text-sm font-semibold text-devai-text">Menu</h2>
          <div className="flex items-center gap-3">
            {/* Trust Mode Toggle */}
            <button
              onClick={handleTrustToggle}
              disabled={trustLoading}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                trustMode === 'trusted'
                  ? 'bg-green-600/20 text-green-400 border border-green-600/40'
                  : 'bg-devai-card text-devai-text-muted border border-devai-border hover:text-devai-text-secondary'
              }`}
              title={trustMode === 'trusted' ? 'Trust Mode: ON' : 'Trust Mode: OFF'}
            >
              {trustMode === 'trusted' ? 'Trusted' : 'Default'}
            </button>
            <button
              onClick={onClose}
              className="text-devai-text-secondary hover:text-devai-text transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-devai-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === 'context') {
                  setIsGlobalContextOpen(true);
                } else {
                  setActiveTab(tab.id);
                }
              }}
              className={`flex-1 text-xs py-2.5 font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-devai-accent border-b-2 border-devai-accent'
                  : 'text-devai-text-muted hover:text-devai-text-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'history' && <HistoryPanelContent />}
          {activeTab === 'prompts' && <PromptsPanelContent />}
          {activeTab === 'tools' && (
            <ToolsPanelContent
              allowedRoots={props.allowedRoots}
              skills={props.skills}
              selectedSkillIds={props.selectedSkillIds}
              skillsLoadedAt={props.skillsLoadedAt}
              skillsErrors={props.skillsErrors}
              onToggleSkill={props.onToggleSkill}
              onReloadSkills={props.onReloadSkills}
              skillsLoading={props.skillsLoading}
              projectRoot={props.projectRoot}
              projectContext={props.projectContext}
              projectContextLoadedAt={props.projectContextLoadedAt}
              onRefreshProject={props.onRefreshProject}
              projectLoading={props.projectLoading}
              pinnedFiles={props.pinnedFiles}
              onUnpinFile={props.onUnpinFile}
              ignorePatterns={props.ignorePatterns}
              onUpdateIgnorePatterns={props.onUpdateIgnorePatterns}
              projectContextOverride={props.projectContextOverride}
              onUpdateProjectContextOverride={props.onUpdateProjectContextOverride}
              contextStats={props.contextStats}
              mcpServers={props.mcpServers}
            />
          )}
          {activeTab === 'files' && <UserfilesPanelContent />}
          {activeTab === 'memory' && <MemoryPanelContent />}
        </div>
      </div>

      {/* Global Context Modal */}
      <GlobalContext isOpen={isGlobalContextOpen} onClose={() => setIsGlobalContextOpen(false)} />
    </>
  );
}
