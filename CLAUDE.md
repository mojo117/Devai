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
- **PM2 Process**: devai-dev
- **Mutagen Sync**: devai-dev
- **Dev Port**: 3008

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
- Monitor sync: `mutagen sync monitor devai-dev`
- Clawd SSH: `ssh root@10.0.0.5`
