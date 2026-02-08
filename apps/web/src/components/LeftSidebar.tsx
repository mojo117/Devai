import { useState, useEffect } from 'react';
import type {
  ProjectContext,
  SkillSummary,
  McpServerStatus,
} from '../types';

// Import the panel content components
import { PromptsPanelContent } from './PromptsPanelContent';
import { ToolsPanelContent } from './ToolsPanelContent';
import { HistoryPanelContent } from './HistoryPanelContent';
import { GlobalContext } from './GlobalContext';
import { getTrustMode, setTrustMode } from '../api';

type PanelType = 'prompts' | 'tools' | 'history' | null;

interface LeftSidebarProps {
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

export function LeftSidebar(props: LeftSidebarProps) {
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [isGlobalContextOpen, setIsGlobalContextOpen] = useState(false);
  const [trustMode, setTrustModeState] = useState<'default' | 'trusted'>('default');
  const [trustLoading, setTrustLoading] = useState(false);

  useEffect(() => {
    getTrustMode()
      .then((res) => setTrustModeState(res.mode))
      .catch(console.error);
  }, []);

  const handleTrustToggle = async () => {
    const newMode = trustMode === 'default' ? 'trusted' : 'default';
    setTrustLoading(true);
    try {
      await setTrustMode(newMode);
      setTrustModeState(newMode);
    } catch (error) {
      console.error('Failed to toggle trust mode:', error);
    } finally {
      setTrustLoading(false);
    }
  };

  const togglePanel = (panel: PanelType) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  const buttons: { id: PanelType; label: string; color: string; hoverColor: string }[] = [
    { id: 'prompts', label: 'AI Prompts', color: 'bg-blue-700', hoverColor: 'hover:bg-blue-600' },
    { id: 'tools', label: 'Tools', color: 'bg-gray-700', hoverColor: 'hover:bg-gray-600' },
    { id: 'history', label: 'History', color: 'bg-purple-700', hoverColor: 'hover:bg-purple-600' },
  ];

  return (
    <div className="fixed left-0 top-0 h-full z-50 flex">
      {/* Fixed Toolbar */}
      <div className="w-10 bg-gray-900 border-r border-gray-700 flex flex-col items-center pt-16 gap-2">
        {buttons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => togglePanel(btn.id)}
            className={`
              w-8 py-4 rounded text-gray-200 text-xs font-medium
              transition-all shadow-md
              ${activePanel === btn.id ? btn.color : 'bg-gray-800'}
              ${btn.hoverColor}
            `}
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
            title={btn.label}
          >
            {btn.label}
          </button>
        ))}
        {/* Global Context Button - Opens Modal */}
        <button
          onClick={() => setIsGlobalContextOpen(true)}
          className="w-8 py-4 rounded text-gray-200 text-xs font-medium transition-all shadow-md bg-gray-800 hover:bg-green-600"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          title="Global Context"
        >
          Context
        </button>
        {/* Trust Mode Toggle */}
        <div className="mt-auto mb-4">
          <button
            onClick={handleTrustToggle}
            disabled={trustLoading}
            className={`w-8 py-4 rounded text-xs font-medium transition-all shadow-md ${
              trustMode === 'trusted'
                ? 'bg-green-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
            title={trustMode === 'trusted' ? 'Trust Mode: ON (click to disable)' : 'Trust Mode: OFF (click to enable)'}
          >
            {trustMode === 'trusted' ? '🔓 Trust' : '🔒 Trust'}
          </button>
        </div>
      </div>

      {/* Expandable Panel Area */}
      <div
        className={`
          bg-gray-800 border-r border-gray-700 shadow-xl
          transition-all duration-300 overflow-hidden
          ${activePanel ? 'w-80' : 'w-0'}
        `}
      >
        <div className="w-80 h-full overflow-y-auto">
          {activePanel === 'prompts' && <PromptsPanelContent />}
          {activePanel === 'tools' && (
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
          {activePanel === 'history' && <HistoryPanelContent />}
        </div>
      </div>

      {/* Global Context Modal */}
      <GlobalContext isOpen={isGlobalContextOpen} onClose={() => setIsGlobalContextOpen(false)} />
    </div>
  );
}

// Toolbar width constant for use in App.tsx
export const LEFT_SIDEBAR_WIDTH = 40; // 40px = w-10
