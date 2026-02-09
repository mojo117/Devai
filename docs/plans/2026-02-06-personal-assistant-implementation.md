# Personal Assistant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform DevAI into a self-reliant personal assistant with document context, trust modes, and agentic loop execution.

**Architecture:** Add a document context folder with read-only tools, implement trust mode toggle that bypasses confirmations for write operations, and enhance the existing agentic loop to support multi-step autonomous execution.

**Tech Stack:** TypeScript, Fastify, React, Supabase (existing stack)

---

## Task 1: Create Document Context Folder Structure

**Files:**
- Create: `context/documents/.gitkeep`
- Create: `context/README.md`

**Step 1: Create the context directories**

```bash
mkdir -p context/documents
```

**Step 2: Create .gitkeep to track empty directory**

Create `context/documents/.gitkeep`:
```
# This folder contains user documents for DevAI context
# Add .txt and .md files here for the AI to reference
```

**Step 3: Create README for the context folder**

Create `context/README.md`:
```markdown
# DevAI Context Folder

This folder contains reference documents that DevAI can read to provide better assistance.

## Usage

Drop `.txt` or `.md` files into the `documents/` subfolder. DevAI will automatically:
- List available documents when asked
- Read document contents when relevant to your question
- Search across documents for specific information

## Supported Formats

- `.txt` - Plain text files
- `.md` - Markdown files

## Security

- DevAI has **read-only** access to this folder
- Documents are never modified or deleted by DevAI
- Contents are only sent to the LLM when explicitly requested
```

**Step 4: Commit**

```bash
git add context/
git commit -m "feat: add document context folder structure"
```

---

## Task 2: Create Context Tools Module

**Files:**
- Create: `apps/api/src/tools/context.ts`
- Test: Manual testing via API

**Step 1: Create the context tools file**

Create `apps/api/src/tools/context.ts`:
```typescript
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, extname } from 'path';
import { config } from '../config.js';

// Context documents folder path (relative to project that DevAI is working on)
const CONTEXT_FOLDER = 'context/documents';

// Allowed extensions for context documents
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md']);

export interface DocumentInfo {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface DocumentContent {
  name: string;
  path: string;
  content: string;
  size: number;
}

export interface SearchResult {
  name: string;
  path: string;
  matches: Array<{
    line: number;
    content: string;
  }>;
}

/**
 * Get the absolute path to the context documents folder
 */
function getContextPath(projectRoot: string): string {
  return join(projectRoot, CONTEXT_FOLDER);
}

/**
 * Check if a file has an allowed extension
 */
function isAllowedFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * List all documents in the context folder
 */
export async function listDocuments(projectRoot: string): Promise<{
  documents: DocumentInfo[];
  folder: string;
}> {
  const contextPath = getContextPath(projectRoot);

  try {
    const entries = await readdir(contextPath, { withFileTypes: true });
    const documents: DocumentInfo[] = [];

    for (const entry of entries) {
      if (entry.isFile() && isAllowedFile(entry.name)) {
        const filePath = join(contextPath, entry.name);
        const stats = await stat(filePath);

        documents.push({
          name: entry.name,
          path: relative(projectRoot, filePath),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      }
    }

    // Sort by name
    documents.sort((a, b) => a.name.localeCompare(b.name));

    return {
      documents,
      folder: CONTEXT_FOLDER,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        documents: [],
        folder: CONTEXT_FOLDER,
      };
    }
    throw error;
  }
}

/**
 * Read a specific document from the context folder
 */
export async function readDocument(
  projectRoot: string,
  documentPath: string
): Promise<DocumentContent> {
  // Normalize the path - accept both full path and just filename
  const filename = documentPath.includes('/')
    ? documentPath.split('/').pop()!
    : documentPath;

  if (!isAllowedFile(filename)) {
    throw new Error(`File type not allowed. Only .txt and .md files are supported.`);
  }

  const contextPath = getContextPath(projectRoot);
  const filePath = join(contextPath, filename);

  // Security: ensure the resolved path is within the context folder
  if (!filePath.startsWith(contextPath)) {
    throw new Error('Access denied: path traversal detected');
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);

    return {
      name: filename,
      path: relative(projectRoot, filePath),
      content,
      size: stats.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Document not found: ${filename}`);
    }
    throw error;
  }
}

/**
 * Search for text across all documents in the context folder
 */
export async function searchDocuments(
  projectRoot: string,
  query: string
): Promise<{
  query: string;
  results: SearchResult[];
  totalMatches: number;
}> {
  const { documents } = await listDocuments(projectRoot);
  const results: SearchResult[] = [];
  let totalMatches = 0;

  const queryLower = query.toLowerCase();

  for (const doc of documents) {
    try {
      const { content } = await readDocument(projectRoot, doc.name);
      const lines = content.split('\n');
      const matches: Array<{ line: number; content: string }> = [];

      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(queryLower)) {
          matches.push({
            line: index + 1,
            content: line.trim().substring(0, 200), // Limit line length
          });
        }
      });

      if (matches.length > 0) {
        results.push({
          name: doc.name,
          path: doc.path,
          matches: matches.slice(0, 10), // Limit matches per file
        });
        totalMatches += matches.length;
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return {
    query,
    results,
    totalMatches,
  };
}
```

**Step 2: Verify the file compiles**

```bash
cd /opt/Klyde/projects/Devai/apps/api && npx tsc --noEmit src/tools/context.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/tools/context.ts
git commit -m "feat: add context tools for document folder access"
```

---

## Task 3: Register Context Tools in Registry

**Files:**
- Modify: `apps/api/src/tools/registry.ts`

**Step 1: Add context tool types to ToolName union**

In `apps/api/src/tools/registry.ts`, find the `ToolName` type and add after the existing tools:

```typescript
  // Context Tools (read-only document access)
  | 'context_listDocuments'
  | 'context_readDocument'
  | 'context_searchDocuments'
```

**Step 2: Add context tool definitions to TOOL_REGISTRY**

Add before the closing bracket of `TOOL_REGISTRY`:

```typescript
  // Context Tools (read-only document access)
  {
    name: 'context_listDocuments',
    description: 'List all documents in the context folder. Returns filenames, sizes, and modification dates.',
    parameters: {
      type: 'object',
      properties: {},
    },
    requiresConfirmation: false,
  },
  {
    name: 'context_readDocument',
    description: 'Read the contents of a document from the context folder. Accepts filename or path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The document filename or path (e.g., "notes.md" or "context/documents/notes.md")',
        },
      },
      required: ['path'],
    },
    requiresConfirmation: false,
  },
  {
    name: 'context_searchDocuments',
    description: 'Search for text across all documents in the context folder. Returns matching lines.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The text to search for (case-insensitive)',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
  },
```

**Step 3: Commit**

```bash
git add apps/api/src/tools/registry.ts
git commit -m "feat: register context tools in tool registry"
```

---

## Task 4: Wire Context Tools to Executor

**Files:**
- Modify: `apps/api/src/tools/executor.ts`

**Step 1: Import context tools**

Add at the top of `apps/api/src/tools/executor.ts` with other imports:

```typescript
import * as contextTools from './context.js';
```

**Step 2: Add context tool cases to switch statement**

Find the `switch (toolName)` statement and add before the `default:` case:

```typescript
        // Context Tools (read-only document access)
        case 'context_listDocuments':
          return contextTools.listDocuments(config.allowedRoots[0]);

        case 'context_readDocument':
          return contextTools.readDocument(
            config.allowedRoots[0],
            args.path as string
          );

        case 'context_searchDocuments':
          return contextTools.searchDocuments(
            config.allowedRoots[0],
            args.query as string
          );
```

**Step 3: Add context tools to READ_ONLY_TOOLS set**

Find the `READ_ONLY_TOOLS` set and add:

```typescript
  'context_listDocuments',
  'context_readDocument',
  'context_searchDocuments',
```

**Step 4: Commit**

```bash
git add apps/api/src/tools/executor.ts
git commit -m "feat: wire context tools to executor"
```

---

## Task 5: Add Context Tools to System Prompt

**Files:**
- Modify: `apps/api/src/routes/chat.ts`

**Step 1: Update SYSTEM_PROMPT with context tools section**

Find the `SYSTEM_PROMPT` constant and add after the LOGS section:

```typescript
CONTEXT (Read-Only Document Access):
- context.listDocuments(): List all documents in the context folder
- context.readDocument(path): Read a specific document by filename
- context.searchDocuments(query): Search for text across all documents

The context folder contains reference materials you can use to inform your responses.
When relevant to the user's question, check if there are helpful documents available.
```

**Step 2: Commit**

```bash
git add apps/api/src/routes/chat.ts
git commit -m "feat: add context tools to system prompt"
```

---

## Task 6: Create Trust Configuration Module

**Files:**
- Create: `apps/api/src/config/trust.ts`

**Step 1: Create the trust configuration file**

Create `apps/api/src/config/trust.ts`:
```typescript
/**
 * Trust Mode Configuration
 *
 * Defines which actions are allowed in different trust modes and
 * which actions are always blocked regardless of trust level.
 */

// Actions that are ALWAYS blocked, even in trusted mode
export const BLOCKED_ACTIONS = new Set([
  // Prevent catastrophic deletions
  'delete_project_root',
  'delete_node_modules',
  'rm_rf_root',

  // Prevent secrets exposure
  'modify_env_file',

  // Prevent production accidents
  'push_to_main',
  'push_to_master',
]);

// Patterns for blocked file paths
export const BLOCKED_PATH_PATTERNS = [
  /^\.env$/,                    // .env file
  /^\.env\..+$/,                // .env.local, .env.production, etc.
  /node_modules\/?$/,           // node_modules directory
  /^\/$/,                       // root directory
];

// Patterns for blocked git operations
export const BLOCKED_GIT_PATTERNS = [
  /^(main|master)$/i,           // main/master branches
];

export type TrustMode = 'default' | 'trusted';

export interface TrustConfig {
  mode: TrustMode;
  // Future: could add per-tool overrides, time limits, etc.
}

/**
 * Check if a file path is blocked from modification
 */
export function isPathBlocked(path: string): { blocked: boolean; reason?: string } {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/, '');

  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(normalizedPath) || pattern.test(normalizedPath.split('/').pop() || '')) {
      return {
        blocked: true,
        reason: `Path matches blocked pattern: ${pattern.toString()}`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Check if a git branch is blocked from push
 */
export function isBranchBlocked(branch: string): { blocked: boolean; reason?: string } {
  for (const pattern of BLOCKED_GIT_PATTERNS) {
    if (pattern.test(branch)) {
      return {
        blocked: true,
        reason: `Cannot push to protected branch: ${branch}`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Check if an action should require confirmation based on trust mode
 */
export function shouldRequireConfirmation(
  toolName: string,
  toolArgs: Record<string, unknown>,
  trustMode: TrustMode,
  toolRequiresConfirmation: boolean
): { requiresConfirmation: boolean; reason?: string } {
  // Check for blocked paths on write operations
  if (toolName === 'fs_writeFile' || toolName === 'fs_edit' || toolName === 'fs_delete') {
    const path = toolArgs.path as string;
    if (path) {
      const pathCheck = isPathBlocked(path);
      if (pathCheck.blocked) {
        return { requiresConfirmation: true, reason: pathCheck.reason };
      }
    }
  }

  // Check for blocked branches on git push
  if (toolName === 'git_push') {
    const branch = toolArgs.branch as string;
    if (branch) {
      const branchCheck = isBranchBlocked(branch);
      if (branchCheck.blocked) {
        return { requiresConfirmation: true, reason: branchCheck.reason };
      }
    }
  }

  // In trusted mode, skip confirmation for non-blocked actions
  if (trustMode === 'trusted') {
    return { requiresConfirmation: false };
  }

  // Default mode: use tool's requiresConfirmation flag
  return { requiresConfirmation: toolRequiresConfirmation };
}
```

**Step 2: Verify compilation**

```bash
cd /opt/Klyde/projects/Devai/apps/api && npx tsc --noEmit src/config/trust.ts
```

**Step 3: Commit**

```bash
git add apps/api/src/config/trust.ts
git commit -m "feat: add trust configuration module with safety rails"
```

---

## Task 7: Add Trust Mode Setting to Database Queries

**Files:**
- Modify: `apps/api/src/db/queries.ts`

**Step 1: Add trust mode getter function**

Add at the end of `apps/api/src/db/queries.ts`:

```typescript
/**
 * Get the current trust mode setting
 */
export async function getTrustMode(): Promise<'default' | 'trusted'> {
  const value = await getSetting('trustMode');
  if (value === 'trusted') {
    return 'trusted';
  }
  return 'default';
}

/**
 * Set the trust mode
 */
export async function setTrustMode(mode: 'default' | 'trusted'): Promise<void> {
  await setSetting('trustMode', mode);
}
```

**Step 2: Commit**

```bash
git add apps/api/src/db/queries.ts
git commit -m "feat: add trust mode database helpers"
```

---

## Task 8: Create Trust Mode Settings Endpoint

**Files:**
- Modify: `apps/api/src/routes/settings.ts`

**Step 1: Read the current settings.ts file**

Read `apps/api/src/routes/settings.ts` to understand its structure.

**Step 2: Add trust mode endpoints**

Add imports at the top:
```typescript
import { getTrustMode, setTrustMode } from '../db/queries.js';
```

Add new routes:
```typescript
  // Get trust mode
  app.get('/settings/trust-mode', async (_request, reply) => {
    try {
      const mode = await getTrustMode();
      return reply.send({ mode });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // Set trust mode
  app.post('/settings/trust-mode', async (request, reply) => {
    const body = request.body as { mode?: string };

    if (body.mode !== 'default' && body.mode !== 'trusted') {
      return reply.status(400).send({ error: 'Mode must be "default" or "trusted"' });
    }

    try {
      await setTrustMode(body.mode);
      return reply.send({ mode: body.mode, success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });
```

**Step 3: Commit**

```bash
git add apps/api/src/routes/settings.ts
git commit -m "feat: add trust mode settings endpoints"
```

---

## Task 9: Integrate Trust Mode into Tool Execution Flow

**Files:**
- Modify: `apps/api/src/routes/chat.ts`

**Step 1: Import trust utilities**

Add to imports in `apps/api/src/routes/chat.ts`:
```typescript
import { shouldRequireConfirmation } from '../config/trust.js';
import { getTrustMode } from '../db/queries.js';
```

**Step 2: Modify handleToolCall to check trust mode**

Find the `handleToolCall` function. Before the confirmation check, add trust mode logic:

```typescript
export async function handleToolCall(
  toolCall: ToolCall,
  allowedToolNames: Set<string> | null,
  sendEvent?: (event: Record<string, unknown>) => void,
  trustMode?: 'default' | 'trusted'  // Add parameter
): Promise<string> {
```

Then modify the confirmation check section:

```typescript
  // Check permission patterns before requiring confirmation
  if (toolRequiresConfirmation(toolName)) {
    const permCheck = await checkPermission(toolName, toolArgs);

    if (!permCheck.allowed) {
      return `Error: Tool "${toolName}" is denied by permission pattern: ${permCheck.reason}`;
    }

    // Check trust mode for confirmation bypass
    const effectiveTrustMode = trustMode || 'default';
    const trustCheck = shouldRequireConfirmation(
      toolName,
      toolArgs,
      effectiveTrustMode,
      true // toolRequiresConfirmation is true here
    );

    if (trustCheck.requiresConfirmation && permCheck.requiresConfirmation) {
      return `Error: Tool "${toolName}" requires confirmation. Use askForConfirmation first.`;
    }

    // Log trusted mode execution
    if (effectiveTrustMode === 'trusted' && sendEvent) {
      sendEvent({
        type: 'trusted_execution',
        toolName,
        reason: 'Trust mode enabled',
      });
    }
  }
```

**Step 3: Pass trust mode through the call chain**

In the main chat route, get trust mode and pass it:

```typescript
      // Get trust mode setting
      const trustMode = await getTrustMode();
```

Then pass it to handleToolCall:
```typescript
          const result = await handleToolCall(toolCall, allowedToolNames, sendEvent, trustMode);
```

**Step 4: Commit**

```bash
git add apps/api/src/routes/chat.ts
git commit -m "feat: integrate trust mode into tool execution flow"
```

---

## Task 10: Add Trust Mode Toggle to Frontend

**Files:**
- Modify: `apps/web/src/components/LeftSidebar.tsx`
- Modify: `apps/web/src/api.ts`

**Step 1: Add API functions for trust mode**

Add to `apps/web/src/api.ts`:
```typescript
export async function getTrustMode(): Promise<{ mode: 'default' | 'trusted' }> {
  const response = await fetch(`${API_BASE}/settings/trust-mode`);
  if (!response.ok) {
    throw new Error('Failed to get trust mode');
  }
  return response.json();
}

export async function setTrustMode(mode: 'default' | 'trusted'): Promise<void> {
  const response = await fetch(`${API_BASE}/settings/trust-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) {
    throw new Error('Failed to set trust mode');
  }
}
```

**Step 2: Add trust mode toggle to LeftSidebar**

Read `apps/web/src/components/LeftSidebar.tsx` first, then add:

Import the API functions:
```typescript
import { getTrustMode, setTrustMode } from '../api';
```

Add state and effect:
```typescript
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
```

Add toggle UI (find appropriate location in the sidebar):
```tsx
        {/* Trust Mode Toggle */}
        <div className="px-3 py-2 border-t border-gray-700">
          <button
            onClick={handleTrustToggle}
            disabled={trustLoading}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
              trustMode === 'trusted'
                ? 'bg-green-600/20 text-green-400 border border-green-500/30'
                : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
            }`}
          >
            <span className="flex items-center gap-2">
              {trustMode === 'trusted' ? '🔓' : '🔒'}
              <span>Trust Mode</span>
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              trustMode === 'trusted' ? 'bg-green-500/20' : 'bg-gray-600'
            }`}>
              {trustMode === 'trusted' ? 'ON' : 'OFF'}
            </span>
          </button>
          {trustMode === 'trusted' && (
            <p className="text-xs text-yellow-500/70 mt-1 px-1">
              ⚠️ Actions execute without confirmation
            </p>
          )}
        </div>
```

**Step 3: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/components/LeftSidebar.tsx
git commit -m "feat: add trust mode toggle to frontend"
```

---

## Task 11: Test Document Context Tools

**Files:**
- Create: `context/documents/test-document.md`

**Step 1: Create a test document**

Create `context/documents/test-document.md`:
```markdown
# Test Document

This is a test document for DevAI context.

## Features

- DevAI can read this document
- DevAI can search within this document
- DevAI cannot modify this document

## Keywords

- authentication
- database
- API endpoints
- React components
```

**Step 2: Test via DevAI UI**

1. Open https://devai.klyde.tech
2. Ask: "What documents do I have in my context folder?"
3. Expected: Should list test-document.md
4. Ask: "Read the test document"
5. Expected: Should show the document contents
6. Ask: "Search for 'authentication' in my documents"
7. Expected: Should find the match in test-document.md

**Step 3: Commit test document**

```bash
git add context/
git commit -m "test: add test document for context tools"
```

---

## Task 12: Test Trust Mode

**Step 1: Test default mode**

1. Open https://devai.klyde.tech
2. Verify Trust Mode toggle shows "OFF"
3. Ask: "Create a file called test.txt with content 'hello'"
4. Expected: Should request confirmation before creating

**Step 2: Test trusted mode**

1. Click Trust Mode toggle to turn it ON
2. Verify toggle shows "ON" with green styling
3. Ask: "Create a file called test2.txt with content 'trusted test'"
4. Expected: Should create file without confirmation
5. Verify file was created

**Step 3: Test safety rails**

1. With Trust Mode ON
2. Ask: "Edit the .env file"
3. Expected: Should still require confirmation (blocked path)
4. Ask: "Push to main branch"
5. Expected: Should still require confirmation (blocked branch)

**Step 4: Clean up test files**

```bash
rm -f context/documents/test.txt context/documents/test2.txt
```

---

## Task 13: Final Integration Test

**Step 1: Full workflow test**

1. Open DevAI with a project selected
2. Drop a requirements.md file in context/documents/
3. Ask: "What requirements do I have documented?"
4. Verify it reads from context folder
5. Toggle Trust Mode ON
6. Ask: "Create a new component based on the requirements"
7. Verify it executes multiple steps without individual confirmations
8. Review the created files
9. Toggle Trust Mode OFF

**Step 2: Final commit**

If any fixes were needed during testing:
```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```

---

## Summary

After completing all tasks, DevAI will have:

1. **Document Context** (`context/documents/`)
   - `context_listDocuments` - List available documents
   - `context_readDocument` - Read document contents
   - `context_searchDocuments` - Search across documents

2. **Trust Mode**
   - Toggle in sidebar UI
   - Persisted in database
   - Bypasses confirmations for non-blocked actions
   - Safety rails always enforced (.env, main branch, etc.)

3. **Enhanced Agentic Behavior**
   - Multi-step execution in trusted mode
   - Reduced friction for power users
   - Full audit trail maintained
