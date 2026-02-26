# Delegation Cards — Inline Agent Communication Visualization

**Date:** 2026-02-24
**Status:** Design
**Author:** Brainstorm session

---

## Context

When CHAPO delegates to DEVO, SCOUT, or CAIO, the user currently sees only a small inline badge ("agent_switch") and the agent name changes in the header. The delegation prompt, sub-agent tool usage, and sub-agent response are hidden behind collapsible badges. Users can't see the "journey" — what was asked, what happened, and what came back.

**Goal:** Replace implicit agent switches with explicit **Delegation Cards** that show the agent-to-agent communication inline in the chat stream.

---

## Design

### Delegation Card (Collapsed — Default View)

```
┌─────────────────────────────────────────────┐
│ 🎯 CHAPO → 🔧 DEVO                    12.3s │
│                                              │
│ Fix login validation — check auth/login.ts   │
│ for missing null check on email field        │
│                                              │
│ ■■■■■■■■■■  Tools: 4  Status: ✓ completed   │
│                                              │
│ ▸ Show delegation details                    │
└─────────────────────────────────────────────┘
```

**Elements:**
- **Agent arrow** — color-coded icons (CHAPO purple, DEVO orange, SCOUT cyan, CAIO emerald)
- **Duration** — total time from delegation start to agent_complete
- **Task summary** — from the `task` field of the delegation event
- **Progress bar** — fills as tool_call/tool_result events arrive
- **Tool count** — number of tools executed in the sub-loop
- **Status badge** — completed / failed / escalated / working (animated)

### Delegation Card (Expanded — On Click)

```
┌─────────────────────────────────────────────┐
│ 🎯 CHAPO → 🔧 DEVO                    12.3s │
│ Fix login validation — check auth/login.ts   │
│ ■■■■■■■■■■  Tools: 4  Status: ✓ completed   │
│                                              │
│ ┌─ Delegation Prompt ─────────────────────┐  │
│ │ Fix the login validation bug in         │  │
│ │ auth/login.ts. The email field accepts  │  │
│ │ null values. Add a null check before... │  │
│ └─────────────────────────────────────────┘  │
│                                              │
│  1. ✓ fs_readFile  auth/login.ts      0.2s  │
│  2. ✓ fs_grep      "email.*null"      0.1s  │
│  3. ✓ fs_edit      auth/login.ts      0.3s  │
│  4. ✓ git_diff     —                  0.2s  │
│                                              │
│ ┌─ DEVO Response ─────────────────────────┐  │
│ │ Fixed: Added null/empty check for email │  │
│ │ in validateLoginForm(). The field now   │  │
│ │ rejects null, undefined, and empty...   │  │
│ └─────────────────────────────────────────┘  │
│                                              │
│ ▾ Hide delegation details                    │
└─────────────────────────────────────────────┘
```

**Expanded elements:**
- **Delegation prompt** — full text CHAPO sent to the sub-agent
- **Tool timeline** — numbered steps with OK/ERROR icon, tool name, primary argument preview, duration per step. Each step clickable for full args/result.
- **Sub-agent response** — the finalContent from the sub-agent that fed back to CHAPO

### Parallel Delegations

For `delegateParallel`, show a grouped card:

```
┌─────────────────────────────────────────────┐
│ 🎯 CHAPO → 🔧 DEVO + 📋 CAIO         8.1s  │
│ Parallel: Fix auth bug + Update ticket       │
│                                              │
│ 🔧 DEVO   ■■■■■■■■■■  3 tools  ✓ completed │
│ 📋 CAIO   ■■■■■■■■■■  2 tools  ✓ completed │
│                                              │
│ ▸ Show delegation details                    │
└─────────────────────────────────────────────┘
```

Each sub-agent expandable independently within the card.

### SCOUT Delegations

SCOUT delegations (from CHAPO or DEVO) use the same card pattern but with the cyan color and exploration-specific summary:

```
│ 🔧 DEVO → 🔍 SCOUT                    3.1s │
│ Research: How does auth middleware work?      │
```

---

## Data Mapping

All data already exists in the WebSocket event stream:

| Existing Event | Card Element |
|---|---|
| `delegation` (`from`, `to`, `task`) | Card header: arrows, agent names, task summary |
| `agent_switch` | Marks start/end of delegation scope |
| `tool_call` (with sub-agent name) | Tool timeline step (name, args) |
| `tool_result` (with sub-agent name) | Step status, result preview |
| `agent_complete` (sub-agent) | DEVO/SCOUT/CAIO response, status |
| `tool_result` with `decision_path` | CHAPO routing decision (pre-delegation) |

### Backend Enhancement (Minimal)

Add `durationMs` and `toolCount` to the `agent_complete` event for sub-agents. Currently only `result` is emitted.

**File:** `apps/api/src/agents/chapo-loop/delegationRunner.ts`
**Change:** ~5 lines — capture start time, count tools, add to event payload.

---

## Implementation

### New Components

1. **`DelegationCard.tsx`** — Main card component
   - Props: `delegation: DelegationData` (from, to, task, status, duration, tools, prompt, response)
   - State: `expanded: boolean`
   - Collapsed: header + summary + progress + status
   - Expanded: + prompt block + tool timeline + response block

2. **`ToolTimeline.tsx`** — Reusable numbered tool step list
   - Props: `steps: ToolStep[]` (name, args preview, result preview, duration, success)
   - Each step expandable for full args/result (reuse existing expand pattern)

### Modified Components

3. **`MessageList.tsx`** — Detect delegation event sequences
   - Group events between `delegation` and next `agent_switch` back to parent
   - Render `DelegationCard` instead of individual badges for grouped events
   - Keep non-delegation events (CHAPO's own tool calls) as current badges

4. **`ChatUI.tsx`** — State management
   - Add `activeDelegations: Map<string, DelegationData>` to track in-flight delegations
   - On `delegation` event: create entry
   - On `tool_call`/`tool_result` within delegation: append to entry
   - On `agent_complete` for sub-agent: finalize entry, attach to message

### Styling

- Follow existing Tailwind patterns and devai color scheme
- Agent colors: CHAPO purple (`text-purple-400`), DEVO orange (`text-devai-accent`), SCOUT cyan (`text-cyan-400`), CAIO emerald (`text-emerald-400`)
- Card uses `bg-devai-card` with `border-devai-border`
- Progress bar: thin line matching agent color
- Expand/collapse: smooth CSS transition (existing pattern)

---

## Verification

1. **Manual test:** Open devai.klyde.tech, send a message that triggers DEVO delegation (e.g. "Read the README file and summarize it"). Verify:
   - Delegation card appears inline in chat
   - Card shows CHAPO→DEVO with task summary
   - Progress bar fills as tools execute
   - Status updates to "completed" when done
   - Clicking expands to show full prompt, tool steps, and DEVO response

2. **Parallel test:** Trigger `delegateParallel` (e.g. complex task requiring DEVO + CAIO). Verify grouped card.

3. **Error test:** Trigger a delegation that fails (e.g. ask DEVO to read a non-existent file). Verify card shows "failed" status with error in expanded view.

4. **Replay test:** Reload the page, navigate to an old session. Verify delegation cards reconstruct from stored events.

---

## Future Extensions (Not in Scope)

These were discussed during brainstorming and can be added later:

- **Visual proof of work** — Firecrawl screenshots, deployment previews, before/after screenshots rendered inline as evidence
- **Rich content rendering** — HTML/iframe previews, rendered code diffs, images inline in chat
- **Side panel timeline** — chronological activity feed as an alternative to inline cards
