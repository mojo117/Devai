import { PanelSection } from './PanelSection';

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

export function ToolsListSection() {
  return (
    <>
      <PanelSection title="Available Tools" count={AVAILABLE_TOOLS.length}>
        <div className="mt-3 space-y-2">
          {AVAILABLE_TOOLS.map((tool) => (
            <div key={tool.name} className="bg-gray-900 rounded p-2 text-xs">
              <div className="flex items-center justify-between mb-1">
                <code className="text-blue-400 font-mono text-xs">{tool.name}</code>
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
      </PanelSection>

      <div className="mt-4 pt-4 border-t border-gray-700">
        <p className="text-[10px] text-gray-600">
          Tools marked with <span className="text-yellow-500">confirm</span> require user approval before execution.
        </p>
      </div>
    </>
  );
}
