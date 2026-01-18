import { useState } from 'react';

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
}

export function ToolsPanel({ allowedRoots }: ToolsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAccessOpen, setIsAccessOpen] = useState(false);

  return (
    <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50">
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute right-0 top-1/2 -translate-y-1/2 bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-4 rounded-l-lg shadow-lg transition-all"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {isOpen ? '▶' : '◀'} Tools
      </button>

      {/* Panel */}
      <div
        className={`bg-gray-800 border-l border-gray-700 shadow-xl transition-all duration-300 overflow-hidden ${
          isOpen ? 'w-64' : 'w-0'
        }`}
      >
        <div className="w-64 h-screen overflow-y-auto p-4">
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

      {/* Access Toggle Button */}
      <button
        onClick={() => setIsAccessOpen(!isAccessOpen)}
        className="absolute right-0 top-[calc(50%+180px)] -translate-y-1/2 bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-4 rounded-l-lg shadow-lg transition-all"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {isAccessOpen ? '▶' : '◀'} Access
      </button>

      {/* Access Panel */}
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
