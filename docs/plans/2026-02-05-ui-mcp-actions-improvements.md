# Devai UI, MCP & Actions Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add provider selection UI, expand MCP integrations, and improve actions history display in the Devai frontend.

**Architecture:** Three parallel tracks: (1) Provider selection dropdown in chat header with state management in App.tsx, (2) MCP server configuration UI and additional server integrations, (3) Actions history page with filtering, search, and export capabilities.

**Tech Stack:** React 18.3, TypeScript, Tailwind CSS, Fastify backend, WebSocket, Supabase

---

## Track 1: Provider Selection UI

### Task 1.1: Add Provider State to App.tsx

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/web/src/App.tsx`

**Step 1: Add provider state**

Find the existing state declarations (around line 50-80) and add:

```tsx
const [selectedProvider, setSelectedProvider] = useState<LLMProvider>('anthropic');
```

**Step 2: Update ChatUI prop**

Find where ChatUI is rendered and change:

```tsx
// Before:
<ChatUI provider="anthropic" ... />

// After:
<ChatUI provider={selectedProvider} ... />
```

**Step 3: Pass setter to header**

Add `onProviderChange={setSelectedProvider}` and `selectedProvider={selectedProvider}` props where the header/toolbar is rendered.

**Step 4: Verify TypeScript compiles**

Run: `cd /opt/Klyde/projects/Devai/apps/web && npm run typecheck`
Expected: No new errors

**Step 5: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): add provider state management to App.tsx"
```

---

### Task 1.2: Create ProviderSelector Component

**Files:**
- Create: `/opt/Klyde/projects/Devai/apps/web/src/components/ProviderSelector.tsx`

**Step 1: Create the component file**

```tsx
import React from 'react';
import { LLMProvider } from '../types';

interface ProviderSelectorProps {
  selectedProvider: LLMProvider;
  onProviderChange: (provider: LLMProvider) => void;
  availableProviders: {
    anthropic: boolean;
    openai: boolean;
    gemini: boolean;
  };
  disabled?: boolean;
}

const PROVIDER_INFO: Record<LLMProvider, { name: string; icon: string; color: string }> = {
  anthropic: { name: 'Claude', icon: '🟠', color: 'orange' },
  openai: { name: 'GPT', icon: '🟢', color: 'green' },
  gemini: { name: 'Gemini', icon: '🔵', color: 'blue' },
};

export function ProviderSelector({
  selectedProvider,
  onProviderChange,
  availableProviders,
  disabled = false,
}: ProviderSelectorProps) {
  const providers: LLMProvider[] = ['anthropic', 'openai', 'gemini'];

  return (
    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
      {providers.map((provider) => {
        const info = PROVIDER_INFO[provider];
        const isAvailable = availableProviders[provider];
        const isSelected = selectedProvider === provider;

        return (
          <button
            key={provider}
            onClick={() => isAvailable && onProviderChange(provider)}
            disabled={disabled || !isAvailable}
            className={`
              px-3 py-1.5 rounded-md text-sm font-medium transition-all
              ${isSelected
                ? 'bg-gray-700 text-white shadow-sm'
                : isAvailable
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                  : 'text-gray-600 cursor-not-allowed'
              }
            `}
            title={isAvailable ? info.name : `${info.name} (not configured)`}
          >
            <span className="mr-1">{info.icon}</span>
            {info.name}
          </button>
        );
      })}
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /opt/Klyde/projects/Devai/apps/web && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/components/ProviderSelector.tsx
git commit -m "feat(web): create ProviderSelector component"
```

---

### Task 1.3: Integrate ProviderSelector into Chat Header

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/web/src/App.tsx`

**Step 1: Import the component**

Add at the top of App.tsx:

```tsx
import { ProviderSelector } from './components/ProviderSelector';
```

**Step 2: Find the header section and add ProviderSelector**

Look for the header area (around line 400-500 where tabs/view switching happens) and add:

```tsx
{/* Provider Selector - add near the chat header */}
<ProviderSelector
  selectedProvider={selectedProvider}
  onProviderChange={setSelectedProvider}
  availableProviders={health?.providers ?? { anthropic: false, openai: false, gemini: false }}
  disabled={chatLoading}
/>
```

**Step 3: Test in browser**

Open https://devai.klyde.tech and verify:
- Provider buttons are visible
- Available providers show based on health endpoint
- Clicking changes selection
- Selection persists visually

**Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): integrate ProviderSelector into chat header"
```

---

### Task 1.4: Persist Provider Selection

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/web/src/App.tsx`

**Step 1: Load provider from settings on mount**

In the useEffect that loads settings (around line 150-200), add:

```tsx
// Load saved provider
fetchSetting('selectedProvider').then((saved) => {
  if (saved && ['anthropic', 'openai', 'gemini'].includes(saved)) {
    setSelectedProvider(saved as LLMProvider);
  }
});
```

**Step 2: Save provider when changed**

Create a new useEffect:

```tsx
useEffect(() => {
  saveSetting('selectedProvider', selectedProvider);
}, [selectedProvider]);
```

**Step 3: Test persistence**

1. Change provider to OpenAI
2. Refresh page
3. Verify OpenAI is still selected

**Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): persist provider selection to settings"
```

---

## Track 2: Actions History Improvements

### Task 2.1: Add Status Filter to ActionsPage

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/web/src/components/ActionsPage.tsx`

**Step 1: Read the current file**

Run: Read `/opt/Klyde/projects/Devai/apps/web/src/components/ActionsPage.tsx`

**Step 2: Add filter state**

```tsx
const [statusFilter, setStatusFilter] = useState<ActionStatus | 'all'>('all');
```

**Step 3: Add filter UI**

Add above the actions list:

```tsx
<div className="flex gap-2 mb-4 flex-wrap">
  {(['all', 'pending', 'approved', 'executing', 'done', 'failed', 'rejected'] as const).map((status) => (
    <button
      key={status}
      onClick={() => setStatusFilter(status)}
      className={`
        px-3 py-1 rounded-full text-xs font-medium transition-colors
        ${statusFilter === status
          ? 'bg-blue-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        }
      `}
    >
      {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
    </button>
  ))}
</div>
```

**Step 4: Filter the actions**

```tsx
const filteredActions = statusFilter === 'all'
  ? actions
  : actions.filter((a) => a.status === statusFilter);
```

**Step 5: Use filteredActions in render**

Replace `actions.map(...)` with `filteredActions.map(...)`

**Step 6: Commit**

```bash
git add apps/web/src/components/ActionsPage.tsx
git commit -m "feat(web): add status filter to ActionsPage"
```

---

### Task 2.2: Add Search to ActionsPage

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/web/src/components/ActionsPage.tsx`

**Step 1: Add search state**

```tsx
const [searchQuery, setSearchQuery] = useState('');
```

**Step 2: Add search input**

Add below the filter buttons:

```tsx
<input
  type="text"
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
  placeholder="Search actions by tool name or description..."
  className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
/>
```

**Step 3: Update filtering logic**

```tsx
const filteredActions = actions.filter((a) => {
  const matchesStatus = statusFilter === 'all' || a.status === statusFilter;
  const matchesSearch = searchQuery === '' ||
    a.toolName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.description.toLowerCase().includes(searchQuery.toLowerCase());
  return matchesStatus && matchesSearch;
});
```

**Step 4: Commit**

```bash
git add apps/web/src/components/ActionsPage.tsx
git commit -m "feat(web): add search functionality to ActionsPage"
```

---

### Task 2.3: Add Action Count Badges

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/web/src/components/ActionsPage.tsx`

**Step 1: Calculate counts**

```tsx
const counts = {
  all: actions.length,
  pending: actions.filter((a) => a.status === 'pending').length,
  approved: actions.filter((a) => a.status === 'approved').length,
  executing: actions.filter((a) => a.status === 'executing').length,
  done: actions.filter((a) => a.status === 'done').length,
  failed: actions.filter((a) => a.status === 'failed').length,
  rejected: actions.filter((a) => a.status === 'rejected').length,
};
```

**Step 2: Update filter buttons to show counts**

```tsx
<button ...>
  {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
  <span className="ml-1 opacity-60">({counts[status]})</span>
</button>
```

**Step 3: Commit**

```bash
git add apps/web/src/components/ActionsPage.tsx
git commit -m "feat(web): add action count badges to filters"
```

---

### Task 2.4: Add Timestamp Display and Sorting

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/web/src/components/ActionCard.tsx`

**Step 1: Read current ActionCard**

Run: Read `/opt/Klyde/projects/Devai/apps/web/src/components/ActionCard.tsx`

**Step 2: Add relative time helper**

```tsx
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
```

**Step 3: Display timestamps in ActionCard**

Add below the description:

```tsx
<div className="text-xs text-gray-500 mt-1">
  Created: {formatRelativeTime(action.createdAt)}
  {action.approvedAt && ` • Approved: ${formatRelativeTime(action.approvedAt)}`}
  {action.executedAt && ` • Executed: ${formatRelativeTime(action.executedAt)}`}
</div>
```

**Step 4: Commit**

```bash
git add apps/web/src/components/ActionCard.tsx
git commit -m "feat(web): add relative timestamps to ActionCard"
```

---

## Track 3: MCP Integration Expansion

### Task 3.1: Add Filesystem MCP Server Config

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/api/mcp-servers.json`

**Step 1: Read current config**

Run: Read `/opt/Klyde/projects/Devai/apps/api/mcp-servers.json`

**Step 2: Add filesystem server**

Add to the mcpServers array:

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@anthropic/mcp-server-filesystem", "/opt/Klyde/projects"],
  "requiresConfirmation": true,
  "toolPrefix": "fs_mcp",
  "enabledForAgents": ["chapo", "koda", "devo"]
}
```

**Step 3: Test server starts**

Run: `cd /opt/Klyde/projects/Devai && ssh root@77.42.90.193 "pm2 restart devai-api-dev"`

Check logs for MCP connection success.

**Step 4: Commit**

```bash
git add apps/api/mcp-servers.json
git commit -m "feat(api): add filesystem MCP server integration"
```

---

### Task 3.2: Add GitHub MCP Server Config

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/api/mcp-servers.json`

**Step 1: Add GitHub server**

```json
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@anthropic/mcp-server-github"],
  "env": {
    "GITHUB_TOKEN": "${GITHUB_TOKEN}"
  },
  "requiresConfirmation": true,
  "toolPrefix": "github_mcp",
  "enabledForAgents": ["chapo", "koda"]
}
```

**Step 2: Update MCP config loader to support env vars**

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/api/src/mcp/config.ts`

Add env variable expansion:

```typescript
function expandEnvVars(obj: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1);
      result[key] = process.env[envVar] || '';
    } else {
      result[key] = value;
    }
  }
  return result;
}
```

Use this when loading server config.

**Step 3: Commit**

```bash
git add apps/api/mcp-servers.json apps/api/src/mcp/config.ts
git commit -m "feat(api): add GitHub MCP server with env var support"
```

---

### Task 3.3: Create MCP Status Display Component

**Files:**
- Create: `/opt/Klyde/projects/Devai/apps/web/src/components/McpStatus.tsx`

**Step 1: Create the component**

```tsx
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
```

**Step 2: Commit**

```bash
git add apps/web/src/components/McpStatus.tsx
git commit -m "feat(web): create McpStatus component for MCP server display"
```

---

### Task 3.4: Add MCP Status API Endpoint

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/api/src/routes/health.ts`

**Step 1: Read current health route**

Run: Read `/opt/Klyde/projects/Devai/apps/api/src/routes/health.ts`

**Step 2: Add MCP status to health response**

Import mcpManager and add to response:

```typescript
import { mcpManager } from '../mcp';

// In the health handler:
const mcpStatus = mcpManager.getStatus(); // Need to implement this

return {
  status: 'ok',
  providers: { ... },
  mcp: mcpStatus,
};
```

**Step 3: Implement getStatus in McpManager**

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/api/src/mcp/manager.ts`

```typescript
getStatus(): Array<{ name: string; status: string; toolCount: number; error?: string }> {
  return Array.from(this.clients.entries()).map(([name, client]) => ({
    name,
    status: client.isConnected() ? 'connected' : 'disconnected',
    toolCount: this.tools.filter(t => t.serverName === name).length,
    error: client.getLastError(),
  }));
}
```

**Step 4: Commit**

```bash
git add apps/api/src/routes/health.ts apps/api/src/mcp/manager.ts
git commit -m "feat(api): add MCP status to health endpoint"
```

---

### Task 3.5: Integrate McpStatus into ToolsPanel

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/web/src/components/ToolsPanelContent.tsx`

**Step 1: Import McpStatus**

```tsx
import { McpStatus } from './McpStatus';
```

**Step 2: Add MCP section to the panel**

Find a suitable location (after skills or tools section) and add:

```tsx
{/* MCP Servers Section */}
<div className="border-t border-gray-700 pt-4 mt-4">
  <McpStatus servers={health?.mcp ?? []} />
</div>
```

**Step 3: Commit**

```bash
git add apps/web/src/components/ToolsPanelContent.tsx
git commit -m "feat(web): integrate McpStatus into ToolsPanel"
```

---

## Track 4: General UI Improvements

### Task 4.1: Add Loading Skeleton Components

**Files:**
- Create: `/opt/Klyde/projects/Devai/apps/web/src/components/Skeleton.tsx`

**Step 1: Create skeleton component**

```tsx
import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'rectangular' | 'circular';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className = '',
  variant = 'text',
  width,
  height,
}: SkeletonProps) {
  const baseClasses = 'animate-pulse bg-gray-700';
  const variantClasses = {
    text: 'rounded',
    rectangular: 'rounded-lg',
    circular: 'rounded-full',
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      style={style}
    />
  );
}

export function MessageSkeleton() {
  return (
    <div className="flex gap-3 p-4">
      <Skeleton variant="circular" width={32} height={32} />
      <div className="flex-1 space-y-2">
        <Skeleton height={16} width="30%" />
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="80%" />
      </div>
    </div>
  );
}

export function ActionSkeleton() {
  return (
    <div className="p-4 bg-gray-800 rounded-lg space-y-2">
      <div className="flex justify-between">
        <Skeleton height={16} width="40%" />
        <Skeleton height={16} width={60} />
      </div>
      <Skeleton height={14} width="100%" />
      <Skeleton height={14} width="60%" />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/Skeleton.tsx
git commit -m "feat(web): add Skeleton loading components"
```

---

### Task 4.2: Add Empty States

**Files:**
- Create: `/opt/Klyde/projects/Devai/apps/web/src/components/EmptyState.tsx`

**Step 1: Create empty state component**

```tsx
import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <span className="text-4xl mb-4">{icon}</span>
      <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-gray-400 max-w-sm mb-4">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/EmptyState.tsx
git commit -m "feat(web): add EmptyState component"
```

---

### Task 4.3: Use Empty States in ActionsPage

**Files:**
- Modify: `/opt/Klyde/projects/Devai/apps/web/src/components/ActionsPage.tsx`

**Step 1: Import EmptyState**

```tsx
import { EmptyState } from './EmptyState';
```

**Step 2: Add empty state when no actions**

```tsx
{filteredActions.length === 0 ? (
  <EmptyState
    icon={searchQuery || statusFilter !== 'all' ? '🔍' : '✨'}
    title={searchQuery || statusFilter !== 'all' ? 'No matching actions' : 'No actions yet'}
    description={
      searchQuery || statusFilter !== 'all'
        ? 'Try adjusting your search or filters'
        : 'Actions will appear here when tools require approval'
    }
  />
) : (
  filteredActions.map((action) => ...)
)}
```

**Step 3: Commit**

```bash
git add apps/web/src/components/ActionsPage.tsx
git commit -m "feat(web): add empty states to ActionsPage"
```

---

## Final Integration

### Task 5.1: Final Testing Checklist

**Manual Testing Steps:**

1. **Provider Selection:**
   - [ ] Provider buttons visible in header
   - [ ] Clicking changes provider
   - [ ] Unavailable providers are disabled
   - [ ] Selection persists after refresh
   - [ ] Chat uses selected provider

2. **Actions History:**
   - [ ] Filter by status works
   - [ ] Search filters actions
   - [ ] Count badges update correctly
   - [ ] Timestamps show relative time
   - [ ] Empty state shows when no results

3. **MCP Status:**
   - [ ] MCP servers show in ToolsPanel
   - [ ] Connection status is accurate
   - [ ] Tool counts are correct

4. **General UI:**
   - [ ] Skeletons show during loading
   - [ ] Empty states appear appropriately
   - [ ] No TypeScript errors
   - [ ] No console errors

### Task 5.2: Final Commit

```bash
git add -A
git commit -m "feat: complete UI, MCP, and actions improvements

- Add provider selection dropdown with persistence
- Add status filters and search to ActionsPage
- Add MCP status display to ToolsPanel
- Add filesystem and GitHub MCP servers
- Add loading skeletons and empty states
- Improve timestamp display in ActionCard"

git push origin dev
```

---

## Summary

| Track | Tasks | Components |
|-------|-------|------------|
| Provider Selection | 4 | ProviderSelector, App.tsx updates |
| Actions History | 4 | ActionsPage filters, ActionCard timestamps |
| MCP Integration | 5 | McpStatus, mcp-servers.json, health endpoint |
| UI Polish | 3 | Skeleton, EmptyState |

**Total Tasks:** 16
**Estimated Commits:** 16
