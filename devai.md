# DevAI (Global Instructions)

## Filesystem Scope
- DevAI may ONLY read/write/execute within:
  - `/opt/Klyde/projects/DeviSpace`
  - `/opt/Klyde/projects/Devai`
- Do not access or modify other repos/folders under `/opt/Klyde/projects`.

## DeviSpace Is Free-For-Anything
DeviSpace is for experiments, drafts, downloads, scratch scripts, repros, notes, and temporary projects.

Default behavior:
- New demo projects (like a Hello World website) should be created under DeviSpace.
- Only modify the Devai repo when the user is clearly asking to change DevAI itself.

## Running Short-Lived Dev Servers (Klyde)
Goal: allow quick previews without touching any fixed project ports.

Rules:
- Allowed TCP ports: **8090-8095** only.
- Always bind to all interfaces so domain:port works:
  - use `--host 0.0.0.0`
- Always make it short-lived:
  - wrap with `timeout` (example: `timeout 10m ...`)
- Prefer starting in the background and returning immediately.

## Behavior
- Be tolerant of minor spelling mistakes in user prompts. If the intent is clear, proceed.
- Default to trying to solve the problem (explore, search, propose options) instead of asking for clarification.

### Start (Vite)
From the project folder in DeviSpace:
```bash
PORT=8090
timeout 10m npm run dev -- --host 0.0.0.0 --port $PORT > .devserver-$PORT.log 2>&1 &
echo $! > .devserver-$PORT.pid
```

### Stop
```bash
kill "$(cat .devserver-8090.pid)" || true
```

### Tell The User How To Open It
After starting a dev server on port `PORT`, always tell the user the URL:
- `http://<domain>:PORT`

Default domain to suggest:
- use the same domain the DevAI UI is currently served from (without its port), unless the user specifies another domain.

Notes:
- Use `http://` unless HTTPS was explicitly configured for that dev server.

## Workspace & Persistent Memory

DevAI has a workspace-based memory system that persists context across sessions.

### Workspace Location

`/opt/Devai/workspace/` — created automatically on first use.

### File Structure

| Path | Purpose |
|------|---------|
| `MEMORY.md` | Top-level memory index, always loaded into system prompts |
| `memory/*.md` | Topic-specific memory files (linked from MEMORY.md) |
| `AGENTS/` | Per-agent notes and preferences |
| `SOUL/` | Personality and behavioral guidelines |
| `USER/` | User preferences and context |
| `TOOLS/` | Tool-specific notes and patterns |

### How Memory is Loaded

1. `workspaceMdLoader.ts` reads workspace files from disk
2. `systemContext.ts` assembles workspace content alongside project context (devai.md, CLAUDE.md)
3. The router injects the combined system context block into every agent's system prompt
4. Memory is warmed per-session via `warmSystemContextForSession()` before the first LLM call

### Memory API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memory/remember` | POST | Store a note (daily + optional long-term) |
| `/api/memory/search` | POST | Search memory files by keyword |
| `/api/memory/daily/:date` | GET | Retrieve daily memory for a specific date |

### Memory Tools (Available to Agents)

| Tool | Description |
|------|-------------|
| `memory_remember` | Save a note to workspace memory |
| `memory_search` | Search across all memory files |
