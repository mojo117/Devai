import React from 'react';

interface McpServer {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  toolCount: number;
  error?: string;
}

interface McpStatusProps {
  servers: McpServer[];
}

export function McpStatus({ servers }: McpStatusProps) {
  if (servers.length === 0) {
    return (
      <div className="text-gray-500 text-sm">No MCP servers configured</div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400">MCP Servers</h3>
      {servers.map((server) => (
        <div
          key={server.name}
          className="flex items-center justify-between p-2 bg-gray-800 rounded-lg"
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                server.status === 'connected'
                  ? 'bg-green-500'
                  : server.status === 'error'
                    ? 'bg-red-500'
                    : 'bg-gray-500'
              }`}
            />
            <span className="text-sm text-white">{server.name}</span>
          </div>
          <span className="text-xs text-gray-400">
            {server.status === 'connected'
              ? `${server.toolCount} tools`
              : server.error || 'Disconnected'}
          </span>
        </div>
      ))}
    </div>
  );
}
