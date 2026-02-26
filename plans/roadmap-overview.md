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

## Tier 5: Deferred — Safety & Control — [Detailed Plan](./tier5-deferred-plan.md)

> Moved from Tier 3. Lower priority than code quality improvements (#10).

| # | Feature | Engine | Effort | Status |
|---|---------|--------|--------|--------|
| 11 | Plan Mode / Pre-Execution Planning | ALL | ~3 days | Deferred |
| 12 | Sandboxed Execution Environment | ALL | ~5 days | Deferred |

---

## Priority Matrix

| Tier | Items | Total Effort | Impact |
|------|-------|-------------|--------|
| **Tier 1** | 4 items | ~3 days | **DONE** |
| **Tier 2** | 5 items (#5-#9) | ~12 days | High |
| **Tier 3** | 3 items (#10, #13, #14) | ~11 days | Transformative (2 done) |
| **Tier 4** | 2 items (#15-#16) | ~12 days | Long-term |
| **Tier 5** | 2 items (#11-#12) | ~8 days | Deferred |
