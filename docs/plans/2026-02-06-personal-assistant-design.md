# DevAI Personal Assistant Design

**Date:** 2026-02-06
**Status:** Draft

## Overview

Transform DevAI from a coding assistant into a self-reliant personal AI assistant that:
- Works autonomously in agentic loops
- Reads freely from code AND external document sources
- Confirms writes by default, with optional "trusted mode" for full autonomy
- Plans complex tasks, executes simple ones directly

## 1. Document Context System

### Folder Structure

```
/opt/Klyde/projects/Devai/context/
├── documents/     # User's .txt and .md files
└── .index.json    # Optional: metadata cache
```

### New Tools

| Tool | Description | Confirmation |
|------|-------------|--------------|
| `context.listDocuments()` | List all files in documents folder | Never |
| `context.readDocument(path)` | Read a specific document | Never |
| `context.searchDocuments(query)` | Search across documents | Never |

All context tools are **read-only** and never require confirmation.

### System Prompt Addition

```
You have access to the user's document folder with reference materials.
Available documents: [list of filenames]
Use context.readDocument() to read them when relevant.
```

## 2. Trust Levels & Confirmation Flow

### Two Modes

| Mode | Reads | Writes | Git/Deploy |
|------|-------|--------|------------|
| **Default** | Always free | Asks permission | Asks permission |
| **Trusted** | Always free | Just does it | Just does it |

### UI Toggle

- Sidebar toggle: "Trusted Mode" (off by default)
- Persisted in settings
- Visual indicator when active (green border or badge)

### Safety Rails (Always Enforced)

Even in trusted mode, these actions are **blocked**:

| Action | Reason |
|--------|--------|
| Delete project root | Catastrophic |
| Modify `.env` files | Secrets exposure |
| Push to `main` branch | Production safety |
| Delete `node_modules` | Recovery time |
| `rm -rf /` style commands | System destruction |

## 3. Agentic Loop Execution

### Task Classification

| Task Type | Behavior |
|-----------|----------|
| Simple (single tool, clear action) | Executes immediately |
| Complex (multi-step, ambiguous, risky) | Shows plan first |

### Simple Task Examples (Just Does It)

- "Read the auth controller"
- "What's in my documents folder?"
- "Show git status"

### Complex Task Examples (Plans First)

- "Refactor the login flow to use JWT"
- "Fix the bug in the chat endpoint"
- "Set up a new API route for user profiles"

### The Loop

```
1. Receive task
2. Classify: simple or complex?
3. If simple → execute, return result
4. If complex → generate plan, show user
5. User approves (or in trusted mode, auto-approve)
6. Execute step by step
7. If stuck → report and ask for help
8. Done → summarize what was done
```

### Key Difference from Current DevAI

- **Current:** LLM makes one tool call, waits, responds
- **New:** LLM can chain multiple tool calls in a loop until task is complete

## 4. Integration with Existing DevAI

### What Stays the Same

- Chat UI, session management, LLM routing (Claude/OpenAI/Gemini)
- Existing tool system (`fs.*`, `git.*`, `github.*`)
- Audit logging
- Auth (single-user Supabase)

### What Changes

| Component | Change |
|-----------|--------|
| `apps/api/src/agents/` | Add agentic loop executor |
| `apps/api/src/tools/` | Add `context.*` tools for documents |
| `apps/api/src/tools/registry.ts` | Split tools into "read" vs "write" for trust model |
| `apps/web/src/App.tsx` | Add trusted mode toggle |
| System prompt | Include document list + agentic instructions |

### New Files

```
apps/api/src/agents/executor.ts      # Agentic loop logic
apps/api/src/tools/context.ts        # Document folder tools
apps/api/src/config/trust.ts         # Trust level definitions
context/documents/                    # Document folder (project root)
```

### Database Changes

- Add `trusted_mode` to settings table (new key in existing table)

## 5. Error Handling & Guardrails

### Loop Limits

- **Max 10 tool calls per loop** (prevents runaway)
- If stuck → stops, explains what happened, asks for guidance
- If tool fails → retries once, then reports error

### Audit Trail

- Every tool call logged (existing behavior)
- Trusted mode actions marked with `"trust_mode": true`
- Easy to review what happened after the fact

### Graceful Degradation

- Document folder missing → warns, continues without it
- LLM rate limited → backs off, retries
- Tool throws exception → catches, reports, continues

## 6. Implementation Order

1. **Document folder + context tools** (foundation)
2. **Trust mode toggle + settings**
3. **Agentic loop executor**
4. **UI updates** (toggle, loop status display)

## 7. Verification Checklist

- [ ] Drop a `.md` file in documents folder
- [ ] Ask "What documents do I have?" → should list it
- [ ] Ask "Summarize the document about X" → should read and summarize
- [ ] Toggle trusted mode, ask "Create a test file" → should create without asking
- [ ] Ask "Refactor function Y" → should show plan, then execute

## Future Extensions

- Email integration (Gmail/Outlook API)
- Design file access (Figma API or shared folder)
- Calendar integration
- Slack/Discord notifications
