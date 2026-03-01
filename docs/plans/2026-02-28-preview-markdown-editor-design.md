# Preview Panel Markdown Editor

## Problem

When DevAI shows a document in the preview panel via `show_in_preview`, the user can only view it. There's no way to edit the document, save changes back, and have the LLM aware of what changed. Since many documents are `.md` files, an inline editor in the preview panel is the natural place for this.

## Design

### UX

The preview panel gets an **Edit** button in its header, visible only for markdown artifacts that have editable content (inline content or a known file path).

**Default state** (rendered preview, same as today):
```
┌─────────────────────────────────────────────────┐
│  MARKDOWN  docs/plan.md              [✏ Edit] ✕ │
├─────────────────────────────────────────────────┤
│  # My Plan                                       │
│  - Step 1: Do the thing                          │
│  - Step 2: ...                                   │
│  (rendered markdown via MarkdownRenderer)         │
└─────────────────────────────────────────────────┘
```

**After clicking Edit** (editor replaces rendered view):
```
┌─────────────────────────────────────────────────┐
│  EDITING  docs/plan.md        [Cancel] [💾 Save] │
├─────────────────────────────────────────────────┤
│  1 │ # My Plan                                   │
│  2 │ - Step 1: Do the thing                      │
│  3 │ - Step 2: ...                               │
│  4 │                                             │
│    │ (raw text editor, monospace, line numbers)   │
└─────────────────────────────────────────────────┘
```

- **Save** writes the file back to its original source, injects a unified diff into chat, and closes the editor back to the rendered preview (with updated content).
- **Cancel** discards edits and returns to the rendered preview.
- Works on both desktop and mobile.

### Data Flow

```
User clicks Save
       │
       ▼
Frontend: compute unified diff (old content vs new content)
       │
       ▼
POST /preview/artifacts/:id/edit
  body: { newContent, diff, sessionId }
       │
       ▼
Backend: resolve original source from artifact metadata
  ├─ filePath → fs.writeFile(filePath, newContent)
  └─ userfileId → re-upload to Supabase Storage, update parsed_content
       │
       ▼
Backend: inject edit notification into chat
  → saveMessage(sessionId, { role: 'user', content: "[User edited docs/plan.md]\n```diff\n...\n```" })
  → broadcast via WS so it appears in real-time
       │
       ▼
Frontend: receives message via WS, adds to chat history
LLM sees the diff in conversation context on next turn
```

### LLM Awareness

After save, a user-role message is auto-injected into the chat:

```
[User edited docs/plan.md]
\`\`\`diff
--- docs/plan.md (before)
+++ docs/plan.md (after)
@@ -1,3 +1,4 @@
 # My Plan
 - Step 1: Do the thing
-- Step 2: ...
+- Step 2: Write the code
+- Step 3: Test it
\`\`\`
```

Unified diff format — compact, precise, and LLM-friendly.

## Implementation

### Files to Modify

| # | File | Change |
|---|------|--------|
| 1 | `apps/web/src/components/PreviewPanel/MarkdownEditor.tsx` | **NEW** — Raw text editor component |
| 2 | `apps/web/src/components/PreviewPanel/PreviewPanel.tsx` | Add edit state, Edit button, toggle between renderer/editor |
| 3 | `apps/web/src/api.ts` | Add `savePreviewEdit()` API client function |
| 4 | `apps/api/src/routes/preview.ts` | Add `POST /preview/artifacts/:id/edit` endpoint |
| 5 | `apps/api/src/preview/types.ts` | Extend artifact types if needed for edit metadata |

### 1. MarkdownEditor Component (NEW)

`apps/web/src/components/PreviewPanel/MarkdownEditor.tsx`

- `<textarea>` with monospace font (`font-mono`), dark theme matching existing preview styling
- Line numbers via CSS counters or a left gutter div
- Tab key inserts 2 spaces (prevent focus loss with `e.preventDefault()`)
- Auto-grows to fit content
- Props: `content: string`, `onSave: (newContent: string) => void`, `onCancel: () => void`
- Internal state: `editedContent` initialized from `content`
- Save button disabled when content hasn't changed
- Keyboard shortcut: Ctrl+S / Cmd+S to save

### 2. PreviewPanel Changes

`apps/web/src/components/PreviewPanel/PreviewPanel.tsx`

New state:
```tsx
const [editing, setEditing] = useState(false);
const [editableContent, setEditableContent] = useState<string | null>(null);
```

Header changes:
- Show `[✏ Edit]` button when: `artifact.type === 'markdown' && (artifact.content || artifact.filePath)`
- When `editing === true`: show `EDITING` badge + filename, hide Edit button, show Cancel/Save in header

Body changes:
- When `!editing`: render `<MarkdownRenderer>` (current behavior)
- When `editing`: render `<MarkdownEditor content={editableContent} onSave={handleSave} onCancel={handleCancel} />`

Save handler:
```tsx
async function handleSave(newContent: string) {
  const diff = computeUnifiedDiff(editableContent, newContent, artifact.title || 'document.md');
  await savePreviewEdit(artifact.id, {
    newContent,
    diff,
    sessionId: currentSessionId,
    filePath: artifact.filePath,
    userfileId: artifact.remote?.id,
  });
  // Update local artifact content so re-render shows new content
  setEditableContent(newContent);
  artifact.content = newContent;
  setEditing(false);
}
```

### 3. Diff Computation (inline utility)

Simple line-by-line unified diff — no external dependency needed. ~30 lines of code:

```tsx
function computeUnifiedDiff(oldText: string, newText: string, filename: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  // Simple LCS-based diff producing unified format
  // Output: "--- filename (before)\n+++ filename (after)\n@@ ... @@\n..."
}
```

This is for LLM context only (not a visual diff viewer), so a basic implementation is fine.

### 4. API Client

`apps/web/src/api.ts`

```tsx
export async function savePreviewEdit(
  artifactId: string,
  payload: {
    newContent: string;
    diff: string;
    sessionId: string;
    filePath?: string;
    userfileId?: string;
  },
): Promise<{ success: boolean; savedTo: string }> {
  const res = await apiFetch(`/preview/artifacts/${artifactId}/edit`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.json();
}
```

### 5. Backend Endpoint

`apps/api/src/routes/preview.ts`

```
POST /preview/artifacts/:id/edit
```

Logic:
1. Look up artifact by ID → get `filePath`, `userfileId`, `session_id`
2. Validate `sessionId` matches artifact's session
3. Save content:
   - If `filePath`: `await fs.promises.writeFile(filePath, newContent, 'utf-8')`
   - If `userfileId`: re-upload to Supabase Storage bucket, update `parsed_content` in user_files table
4. Update artifact's `inline_content` in DB with new content
5. Inject chat message:
   ```ts
   await saveMessage(sessionId, {
     id: nanoid(),
     role: 'user',
     content: `[User edited ${filename}]\n\`\`\`diff\n${diff}\n\`\`\``,
     timestamp: new Date().toISOString(),
   });
   ```
6. Broadcast message via WS (using existing chatGateway broadcast)
7. Return `{ success: true, savedTo: 'filesystem' | 'supabase' }`

### Security

- Filesystem writes are restricted to `config.allowedRoots` (same check as existing file tools)
- Supabase writes go through existing `uploadUserfileFromBuffer()` pipeline
- Session ID validation prevents cross-session edits
- JWT auth on the endpoint (same as all preview routes)

## Scope

**V1 (this plan):**
- Markdown files only
- Mode toggle: rendered view ↔ raw editor
- Save back to original source (filesystem or Supabase)
- Auto-inject unified diff into chat for LLM context

**Future (not in scope):**
- HTML / plain text / JSON editing
- Split view (editor + live preview side by side)
- WYSIWYG markdown editing
- Collaborative editing
- Version history / undo across saves

## Verification

1. Open devai.klyde.tech, ask Chapo to show a markdown file in preview
2. Verify "Edit" button appears in preview header
3. Click Edit → verify raw content appears in editor with line numbers
4. Make changes, click Save → verify:
   - Editor closes, rendered preview shows updated content
   - Chat shows the diff message (unified format)
   - File on disk (or in Supabase) has the new content
5. Click Edit again, make changes, click Cancel → verify changes are discarded
6. Test on mobile — verify editor fills the mobile preview overlay
7. Send a follow-up message to the LLM → verify it acknowledges the edit (sees the diff in history)
