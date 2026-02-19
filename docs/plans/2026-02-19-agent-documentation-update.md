# Plan: Agent Documentation Update — agents.md + CLAUDE.md + Commands

**Status:** Completed (2026-02-19)
**Branch:** dev

---

## Goal

Create a canonical `docs/agents.md` reference and update `CLAUDE.md` with agent system overview and operational commands. Both files should be the go-to documentation for understanding and operating the DevAI multi-agent system.

---

## What Was Done

### 1. Created `docs/agents.md`

New comprehensive agent reference document covering:

- **Overview** — CHAPO Decision Loop diagram and action mapping
- **Agent definitions** — CHAPO, DEVO, SCOUT with models, tools, capabilities, source files
- **Agent → Tool mapping** — Complete matrix showing which tools each agent can access
- **Coordination meta-tools** — `delegateToDevo`, `delegateToScout`, `askUser`, `requestApproval`, `escalateToChapo`
- **CHAPO Decision Loop** — Configuration, lifecycle, error handling, self-validation, ambiguity detection
- **System context loading** — Load order (devai.md → CLAUDE.md → workspace → global context → memory behavior)
- **Memory architecture** — Daily + long-term memory via workspace markdown files
- **Plan mode** — Multi-perspective analysis (CHAPO + DEVO perspectives)
- **Approval system** — Trust modes (trusted/default)
- **Streaming protocol** — WebSocket event categories
- **Operational commands** — Health, status, restart, logs, sync, git, npm
- **File structure** — Complete directory listing for agents, prompts, tools
- **Server topology** — Klyde → Mutagen → Clawd diagram with ports

### 2. Updated `CLAUDE.md`

Added to the existing CLAUDE.md:

- **Multi-Agent System section** — Quick reference table (agents, roles, models, access levels), decision flow summary, key files
- **Quick Commands section** — Organized by category:
  - Health & Status (curl, pm2 status, logs)
  - Restart Services (API + frontend)
  - Session Logs (list + read)
  - Sync & Preview (mutagen, curl)
  - Git (status, log, push)
  - NPM on Clawd (install, build)
- **Updated Project Info** — Added API port (3009), links to docs
- **Updated Reference section** — Added links to agents.md, architecture.md, plans/

### 3. Created this plan document

Documents what was changed and why, for traceability in `docs/plans/`.

---

## Files Changed

| File | Action |
|------|--------|
| `docs/agents.md` | **Created** — Full agent system reference |
| `CLAUDE.md` | **Updated** — Added agent overview + commands |
| `docs/plans/2026-02-19-agent-documentation-update.md` | **Created** — This plan |

---

## Plan Index (All Plans)

For reference, here is the complete index of plans in `docs/plans/`:

| Date | Plan | Status |
|------|------|--------|
| 2026-02-05 | [Agent Workflow Redesign](./2026-02-05-agent-workflow-redesign.md) | Superseded by CHAPO Loop |
| 2026-02-05 | [Agent Workflow Implementation](./2026-02-05-agent-workflow-implementation.md) | Superseded by CHAPO Loop |
| 2026-02-05 | [Conversation Persistence & Global Context](./2026-02-05-conversation-persistence-and-global-context.md) | Implemented |
| 2026-02-05 | [Perplexity Integration Design](./2026-02-05-perplexity-integration-design.md) | Implemented |
| 2026-02-05 | [UI MCP Actions Improvements](./2026-02-05-ui-mcp-actions-improvements.md) | Implemented |
| 2026-02-06 | [Personal Assistant Design](./2026-02-06-personal-assistant-design.md) | Implemented |
| 2026-02-06 | [Personal Assistant Implementation](./2026-02-06-personal-assistant-implementation.md) | Implemented |
| 2026-02-18 | [OpenClaw Parity — MD Memory Plan](./2026-02-18-openclaw-parity-md-memory-plan.md) | In Progress |
| 2026-02-18 | [Looper Refactor → CHAPO Decision Loop](./2026-02-18-Looper.md) | Done (Phase 6 verification remaining) |
| 2026-02-19 | [Unified Workflow Event Pipeline](./2026-02-19-unified-workflow-event-pipeline.md) | Ready for Implementation |
| 2026-02-19 | [Agent Documentation Update](./2026-02-19-agent-documentation-update.md) | Completed |
