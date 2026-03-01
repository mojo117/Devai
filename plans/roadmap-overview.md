# DevAI Competitive Improvement Roadmap

## Context
Competitive research against Claude Code/Codex, GLM ecosystem, Kimi, and AI agent best practices identified 16 improvements across 4 tiers, prioritized by impact-to-effort ratio.

---

## Tier 1: Quick Wins — COMPLETED — [Details](./tier1-completed.md)

All 4 items implemented and compiled cleanly.

| # | Feature | Engine | Status |
|---|---------|--------|--------|
| 1 | Tool RAG — Dynamic tool filtering | ALL | Done (`toolFilter.ts` + `chapo-loop.ts`) |
| 2 | Kimi tool call ID normalization | `/engine kimi` | Done (`moonshot.ts`) |
| 3 | GLM-5 selective thinking mode | `/engine glm` | Done (`zai.ts` + `chapo-loop.ts` + `types.ts`) |
| 4 | GLM-5 context caching detection | `/engine glm` | Done (`zai.ts` usage logging) |

---

## Tier 2: Medium Effort, High Impact — [Detailed Plan](./tier2-detailed-plan.md)

| # | Feature | Engine | Effort | Status |
|---|---------|--------|--------|--------|
| 5 | Hooks System (pre/post tool execution) | ALL | ~2 days | Planned |
| 6 | Hierarchical Context Compaction | ALL | ~3 days | Planned |
| 7 | Specialized Sub-Agent Delegation | ALL | ~4 days | Planned |
| 8 | Reflexion Loop (self-critique) | ALL | ~2 days | Planned |
| 9 | Multi-Model Cost Routing | ALL | ~1 day | Planned |

**Recommended order**: #9 → #8 → #5 → #6 → #7

---

## Tier 3: Larger Efforts, Transformative — [Detailed Plan](./tier3-detailed-plan.md)

| # | Feature | Engine | Effort | Status |
|---|---------|--------|--------|--------|
| 10 | Architect/Editor Split Pattern | ALL | ~5 days | Planned |
| 13 | Kimi K2.5 Swarm Mode | `/engine kimi` | ~2 days | **Done** (`moonshot.ts` + `chapo-loop.ts` + `types.ts`) |
| 14 | MCP Server Discovery & Auto-Config | ALL | ~4 days | **Done** (`discovery.ts` + `health.ts` + `manager.ts`) |

**Remaining**: #10 (Architect/Editor Split)

---

## Tier 4: Long-Term / Research — [Detailed Plan](./tier4-detailed-plan.md)

| # | Feature | Engine | Effort | Status |
|---|---------|--------|--------|--------|
| 15 | Episodic Memory (cross-session learning) | ALL | ~7 days | Planned |
| 16 | Real-Time Streaming with Progressive UI | ALL | ~5 days | Planned |

**Recommended order**: #15 → #16

---

## Tier 5: Backlog — All Unfinished Features — [Detailed Plan](./tier5-detailed-plan.md)

> Consolidated 2026-02-27. All features from Tiers 2-4 not yet implemented.

| # | Feature | Engine | Effort | TaskForge |
|---|---------|--------|--------|-----------|
| 9 | Multi-Model Cost Routing | ALL | ~1 day | [Ticket](https://taskforge.klyde.tech/task/69a13a070037625d2d5f) |
| 10 | Architect/Editor Split Pattern | ALL | ~5 days | [Ticket](https://taskforge.klyde.tech/task/69a13a3c002e700ec953) |
| 7 | Specialized Sub-Agent Delegation | ALL | ~4 days | [Ticket](https://taskforge.klyde.tech/task/69a13a630033f7b01816) |
| 11 | Plan Mode / Pre-Execution Planning | ALL | ~3 days | [Ticket](https://taskforge.klyde.tech/task/69a13ac3002b7fd0a320) |
| 12 | Sandboxed Execution Environment | ALL | ~5 days | [Ticket](https://taskforge.klyde.tech/task/69a13ac3002dd36ce60b) |
| 15 | Episodic Memory (cross-session learning) | ALL | ~7 days | [Ticket](https://taskforge.klyde.tech/task/69a13ac3002d0982d6dd) |
| 16 | Real-Time Streaming with Progressive UI | ALL | ~5 days | [Ticket](https://taskforge.klyde.tech/task/69a13ac3002e7ba930f9) |

---

## Priority Matrix

| Tier | Items | Total Effort | Impact |
|------|-------|-------------|--------|
| **Tier 1** | 4 items | ~3 days | **DONE** |
| **Tier 2** | 3/5 items | ~7 days | High (2 moved to Tier 5) |
| **Tier 3** | 2/3 items | ~6 days | Transformative (1 moved to Tier 5) |
| **Tier 4** | 0/2 items | — | Long-term (both moved to Tier 5) |
| **Tier 5** | 7 items | ~30 days | Backlog |
