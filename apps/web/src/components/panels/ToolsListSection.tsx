import { PanelSection } from './PanelSection';

interface Tool {
  name: string;
  description: string;
  requiresConfirmation: boolean;
}

const AVAILABLE_TOOLS: Tool[] = [
  { name: 'fs_listFiles', description: 'List files in a directory', requiresConfirmation: false },
  { name: 'fs_readFile', description: 'Read file contents', requiresConfirmation: false },
  { name: 'fs_writeFile', description: 'Write content to a file', requiresConfirmation: true },
  { name: 'git_status', description: 'Show git status', requiresConfirmation: false },
  { name: 'git_diff', description: 'Show git diff', requiresConfirmation: false },
  { name: 'git_commit', description: 'Create a git commit', requiresConfirmation: true },
  { name: 'github_triggerWorkflow', description: 'Trigger GitHub Actions workflow', requiresConfirmation: true },
  { name: 'github_getWorkflowRunStatus', description: 'Get workflow run status', requiresConfirmation: false },
  { name: 'logs_getStagingLogs', description: 'Get staging logs', requiresConfirmation: false },
  { name: 'askForConfirmation', description: 'Request approval for a tool action', requiresConfirmation: false },
];

export function ToolsListSection() {
  return (
    <>
      <PanelSection title="Available Tools" count={AVAILABLE_TOOLS.length}>
        <div className="mt-3 space-y-2">
          {AVAILABLE_TOOLS.map((tool) => (
            <div key={tool.name} className="bg-devai-bg rounded p-2 text-xs">
              <div className="flex items-center justify-between mb-1">
                <code className="text-devai-accent font-mono text-xs">{tool.name}</code>
                {tool.requiresConfirmation && (
                  <span className="bg-yellow-600 text-yellow-100 px-1.5 py-0.5 rounded text-[10px]">
                    confirm
                  </span>
                )}
              </div>
              <p className="text-devai-text-muted text-[11px]">{tool.description}</p>
            </div>
          ))}
        </div>
      </PanelSection>

      <div className="mt-4 pt-4 border-t border-devai-border">
        <p className="text-[10px] text-devai-text-muted">
          Tools marked with <span className="text-yellow-500">confirm</span> require user approval before execution.
        </p>
      </div>
    </>
  );
}
