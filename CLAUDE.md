# Devai - KLYDE SERVER (46.224.197.7)

> **REMOTE SERVER** - You are on Klyde server (46.224.197.7), NOT a local machine.
> **Zentrale Deployment-Dokumentation:** [DEPLOYMENT-PIPELINE.md](./DEPLOYMENT-PIPELINE.md) (Symlink)
> This is a production server accessed via SSH. Edits sync via Mutagen to Clawd for live preview.

## Quick Reference
| Item | Value |
|------|-------|
| **Preview URL** | https://devai.klyde.tech |
| **Branch** | `dev` (NEVER push to main/staging directly) |
| **Sync** | Mutagen (~200-500ms hot-reload) |
| **Dev Port** | 3008 |

**Default:** work on branch `dev` in this worktree (`/opt/Klyde/projects/Devai`). Only switch branches or work on Clawd worktrees if the user explicitly asks.

## How This Works

You are editing files in `/opt/Klyde/projects/Devai/` on the Klyde server.

## Boundary: Devai vs OpenClaw

**Devai and OpenClaw are independent services that share the Clawd server.**

| | Devai (this project) | OpenClaw |
|---|---|---|
| **Purpose** | AI developer assistant (web UI, code editing) | Personal AI assistant (messaging channels) |
| **Runtime** | PM2 processes | systemd service |
| **Workspace** | `/opt/Devai/workspace/` | `/root/.openclaw/workspace/` |
| **Config** | `/opt/Devai/.env` | `/root/.openclaw/openclaw.json` |

**Rules:**
- Devai MUST NOT access `/root/.openclaw/` — this is enforced via `HARDCODED_DENIED_PATHS` in `config.ts`
- Devai has its own workspace at `/opt/Devai/workspace/` (and `workspace/` in this repo)
- Each system has its own SOUL.md, AGENTS.md, MEMORY.md — they are NOT shared
- Do not read, copy, or reference OpenClaw's personality/workspace files

## Filesystem Access Policy (DevAI)


```
Your Edits                    Mutagen Sync                  Live Preview
+-----------------------+    --------------->    +-----------------------+
|  Klyde Server         |       ~200-500ms       |  Clawd Server         |
|  (46.224.197.7)       |                        |  (46.225.162.103)     |
|                       |                        |  Private: 10.0.0.5   |
|  /opt/Klyde/          |                        |                       |
|  projects/Devai/      |                        |  /opt/Devai/          |
+-----------------------+                        +-----------------------+
                                                          |
                                                          v
                                                   Vite Dev Server
                                                   (port 3008)
                                                          |
                                                          v
                                              https://devai.klyde.tech
```

**Runtime server:** Clawd (46.225.162.103 / 10.0.0.5)
**Files on Clawd:** `/opt/Devai/`

**The flow:**
1. You edit files here on the Klyde server
2. Mutagen syncs changes to Clawd's `/opt/Devai/` folder (~500ms)
3. Vite detects changes and hot-reloads
4. View your changes at the preview URL

## Workflow

### Making Changes
1. Edit files directly in this directory
2. Wait ~500ms for Mutagen sync
3. Check preview at https://devai.klyde.tech
4. Iterate until satisfied

### Committing Changes
```bash
git add -A
git commit -m "Description of changes"
git push origin dev
```

### Serena (MCP) Workspace Notes
- Serena will create a local `.serena/` folder (cache, generated project config, tool/memory artifacts).
- This is **runtime/editor state** and should stay **uncommitted**; we ignore it via `.gitignore`.
- Follow-up (eventually): add a small startup/CI guard that auto-ensures `.serena/` is in `.gitignore` (or warns) so it can’t accidentally show up again.

## IMPORTANT: What NOT to Do

### ⚠️ NEVER CHANGE PORTS ⚠️
**DO NOT modify port configurations under any circumstances.** The port assignments are fixed:
- **devai-dev (frontend)**: port 3008
- **devai-api-dev (API)**: port 3009

If something isn't working, the issue is NOT the ports. Debug the actual problem instead.

### ASK USER FIRST Before Changing Infrastructure
**NEVER modify without explicit user consent:**
- **Port configurations** - NEVER CHANGE THESE (see above)
- **Server/machine assignments** - IP addresses, hostnames, server roles
- **PM2 process configs** - Process names, cluster settings
- **Nginx/proxy configs** - Domain routing, SSL settings
- **Environment variables** - Especially in `.env` files
- **Database connections** - Connection strings, credentials

If you think infrastructure changes are needed, **ASK THE USER FIRST**.

### Never Push to Protected Branches
- **NEVER** `git push origin main`
- **NEVER** `git push origin staging`
- Use deployment scripts from main Klyde repo instead

### Never Modify These Files/Folders
| Path | Reason |
|------|--------|
| `.env` | Contains secrets, managed on Clawd at `/opt/Devai/.env` |
| `node_modules/` | Not synced, managed on Clawd server |
| `dist/` or `build/` | Build artifacts, regenerated on Clawd |
| `.git/` | Version control metadata |
| `package-lock.json` | Only modify via npm on Clawd |
| `vite.config.*` | Port/server config - ASK FIRST |
| `ecosystem.config.*` | PM2 config - ASK FIRST |

### Never Run These Commands
- `npm install` - Dependencies are installed on Clawd only
- `npm ci` - Same reason
- `rm -rf` on important directories

## Verifying Changes

### Check Mutagen Sync Status
```bash
mutagen sync list | grep devai-dev
```

### Check Preview is Responding
```bash
curl -I https://devai.klyde.tech
```

### View Clawd Dev Server Logs
```bash
ssh root@10.0.0.5 "pm2 logs devai-dev --lines 50"
```

### Check PM2 Status on Clawd
```bash
ssh root@10.0.0.5 "pm2 status"
```

## Git Branch Strategy

| Branch | Purpose | How to Deploy |
|--------|---------|---------------|
| `dev` | Active development | Auto-syncs via Mutagen |
| `staging` | staging branch
| `main` | Production | 

## Project Info

- **GitHub**: https://github.com/mojo117/Devai
- **PM2 Process**: devai-dev (frontend), devai-api-dev (API)
- **Mutagen Sync**: devai-dev
- **Dev Port**: 3008 (frontend), 3009 (API)
- **Docs**: [Architecture](./docs/architecture.md) | [Agents](./docs/agents.md) | [Plans](./docs/plans/)

## Database (Supabase / PostgreSQL)

| Item | Value |
|------|-------|
| **Provider** | Supabase |
| **Project Ref** | `zzmvofskibpffcxbukuk` |
| **URL** | `https://zzmvofskibpffcxbukuk.supabase.co` |
| **Config** | `/opt/Devai/.env` on Clawd (`DEVAI_SUPABASE_URL`, `DEVAI_SUPABASE_KEY`) |

**Tables:**
- `sessions` — chat sessions (id, title, created_at)
- `messages` — chat messages (id, session_id, role, content, timestamp, tool_events JSONB)
- `settings` — key-value user settings

**Access from code:** `apps/api/src/db/index.ts` (Supabase client), `apps/api/src/db/queries.ts` (queries)

## Multi-Agent System (CHAPO Decision Loop)

> **Full reference:** [docs/agents.md](./docs/agents.md)

DevAI uses a three-agent system orchestrated by the CHAPO Decision Loop:

| Agent | Role | Model | Access |
|-------|------|-------|--------|
| **CHAPO** | Coordinator + Assistant | Opus 4.5 (fallback: Sonnet 4) | Read-only + delegation + memory |
| **DEVO** | Developer & DevOps | Sonnet 4 | Full read/write + bash + SSH + git + PM2 |
| **SCOUT** | Exploration Specialist | Sonnet 4 (fallback: Haiku 3.5) | Read-only + web search |

**Decision flow:** No separate decision engine — the LLM's `tool_calls` ARE the decisions:
- No tool calls → **ANSWER** (self-validate, respond)
- `askUser` → **ASK** (pause, wait for user)
- `delegateToDevo` / `delegateToScout` → **DELEGATE** (sub-loop)
- Any other tool → **TOOL** (execute, feed result back)
- Errors → feed back as context, never crash

**Key files:**
- Loop: `apps/api/src/agents/chapo-loop.ts`
- Agents: `apps/api/src/agents/{chapo,devo,scout}.ts`
- Prompts: `apps/api/src/prompts/{chapo,devo,scout}.ts`
- Tools: `apps/api/src/tools/registry.ts`
- Router: `apps/api/src/agents/router.ts`
- Types: `apps/api/src/agents/types.ts`

## Memory System

### Architecture
- Three-layer memory: Working Memory (180k sliding window) -> Session Summary (compaction at 160k) -> Long-Term Memory (Supabase pgvector)
- All memory code lives in `apps/api/src/memory/`
- Uses OpenAI text-embedding-3-small at 512 dimensions for embeddings
- Supabase project "Infrit" (zzmvofskibpffcxbukuk) hosts the devai_memories table

### Key Integration Points
- `agents/chapo-loop.ts` -- `checkAndCompact()` fires at 160k tokens
- `agents/systemContext.ts` -- `warmMemoryBlockForSession()` retrieves memories before CHAPO loop
- `websocket/chatGateway.ts` -- triggers extraction on session disconnect
- `server.ts` -- daily decay job (Ebbinghaus: strength *= 0.95^days)

### Debugging
- If memory retrieval returns nothing: check Supabase `devai_memories` table has rows with `is_valid = true` and `strength > 0.05`
- If compaction doesn't fire: check `conversation.getTokenUsage()` -- threshold is 160k tokens
- If embeddings fail: check `OPENAI_API_KEY` in `.env` -- embeddings use OpenAI even when LLM uses ZAI/Anthropic
- Memory extraction uses ZAI/glm-4.7-flash by default for cost efficiency

## Quick Commands

### Health & Status
```bash
# API health
curl -s https://devai.klyde.tech/api/health | jq

# PM2 status
ssh root@10.0.0.5 "pm2 status"

# API server logs
ssh root@10.0.0.5 "pm2 logs devai-api-dev --lines 50 --nostream"

# Frontend logs
ssh root@10.0.0.5 "pm2 logs devai-dev --lines 50 --nostream"
```

### Restart Services
```bash
# Restart API
ssh root@10.0.0.5 "pm2 restart devai-api-dev"

# Restart frontend
ssh root@10.0.0.5 "pm2 restart devai-dev"
```

### Session Logs
```bash
# List recent session logs
ssh root@10.0.0.5 "ls -la /opt/Devai/var/logs/ | tail -10"

# Read specific session log
ssh root@10.0.0.5 "cat /opt/Devai/var/logs/<session-id>.md"
```

### Sync & Preview
```bash
# Check Mutagen sync
mutagen sync list | grep devai-dev

# Monitor sync live
mutagen sync monitor devai-dev

# Preview URL
curl -I https://devai.klyde.tech
```

### Git
```bash
# Status
cd /opt/Klyde/projects/Devai && git status

# Recent commits
cd /opt/Klyde/projects/Devai && git log --oneline -10

# Push to dev
cd /opt/Klyde/projects/Devai && git push origin dev
```

### NPM (on Clawd only)
```bash
ssh root@10.0.0.5 "cd /opt/Devai && npm install"
ssh root@10.0.0.5 "cd /opt/Devai && npm run build"
```

## External API: TaskForge Task Access (Appwrite)

Use this Appwrite Function execution endpoint to access **TaskForge** tasks from Devai.

- **Endpoint**: `POST https://appwrite.klyde.tech/v1/functions/api-project-access/executions`
- **Project header** (required): `X-Appwrite-Project: 69805803000aeddb2ead`
- **Auth**: pass the project API key (`tfapi_...`) in the execution **body** as `apiKey` (see example below)

**Security:** Do not hardcode or commit the API key. Store it in `.env` on Clawd at `/opt/Devai/.env`.

**Where to find/set the key:**
- The `tfapi_...` key is generated in TaskForge: Projects -> select project -> "API-Zugriff" -> "API-Key generieren".
- On Clawd, store it in `/opt/Devai/.env` (example name: `DEVAI_TASKBOARD_API_KEY`).


Example (curl):
```bash
curl -sS -X POST 'https://appwrite.klyde.tech/v1/functions/api-project-access/executions' \
  -H 'Content-Type: application/json' \
  -H 'X-Appwrite-Project: 69805803000aeddb2ead' \
  -d "{\"body\": \"{\\\"apiKey\\\": \\\"${DEVAI_TASKBOARD_API_KEY}\\\", \\\"task\\\": \\\"TASK_ID\\\"}\"}" \
  | jq -r '.responseBody' | jq
```

Notes:
- When calling Appwrite Functions via REST (`/v1/functions/{id}/executions`), use `body` (not `data`).
- Appwrite wraps the function response; parse `.responseBody` (JSON string).


## Troubleshooting

### Preview Not Updating?
1. Check Mutagen sync: `mutagen sync list`
2. Check Vite server on Clawd: `ssh root@10.0.0.5 "pm2 logs devai-dev --lines 20"`
3. Check for build errors in Vite output

### Can't Push to GitHub?
1. Check SSH key: `ssh -T git@github.com`
2. Check branch: `git branch --show-current` (should be `dev`)
3. Check remote: `git remote -v`

### Need to Run npm Commands?
Run them on Clawd, not here:
```bash
ssh root@10.0.0.5 "cd /opt/Devai && npm install"
```

## Reference

- Main Klyde docs: `/opt/Klyde/CLAUDE.md`
- Agent system docs: [docs/agents.md](./docs/agents.md)
- Architecture docs: [docs/architecture.md](./docs/architecture.md)
- Plans: [docs/plans/](./docs/plans/)
- Monitor sync: `mutagen sync monitor devai-dev`
- Clawd SSH: `ssh root@10.0.0.5`
