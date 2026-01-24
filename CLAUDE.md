# Devai - KLYDE SERVER (46.224.197.7)

> **REMOTE SERVER** - You are on Klyde server (46.224.197.7), NOT a local machine.
> **Zentrale Deployment-Dokumentation:** [DEPLOYMENT-PIPELINE.md](./DEPLOYMENT-PIPELINE.md) (Symlink)
> This is a production server accessed via SSH. Edits sync via Mutagen to Baso for live preview.

## Quick Reference
| Item | Value |
|------|-------|
| **Preview URL** | https://devai.klyde.tech |
| **Branch** | `dev` (NEVER push to main/staging directly) |
| **Sync** | Mutagen (~200-500ms hot-reload) |
| **Dev Port** | 3008 |

## How This Works

You are editing files in `/opt/Klyde/projects/Devai/` on the Klyde server.

```
Your Edits                    Mutagen Sync                  Live Preview
+-----------------------+    --------------->    +-----------------------+
|  Klyde Server         |       ~200-500ms       |  Baso Server          |
|  (46.224.197.7)       |                        |  (77.42.90.193)       |
|                       |                        |                       |
|  /opt/Klyde/          |                        |  /opt/shared-repos/   |
|  projects/Devai/  |                 |  Devai/    |
|                       |                        |  worktree-preview/    |
+-----------------------+                        +-----------------------+
                                                          |
                                                          v
                                                   Vite Dev Server
                                                   (port 3008)
                                                          |
                                                          v
                                              https://devai.klyde.tech
```

**The flow:**
1. You edit files here on the Klyde server
2. Mutagen syncs changes to Baso's `worktree-preview` folder (~500ms)
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

## IMPORTANT: What NOT to Do

### ⚠️ NEVER CHANGE PORTS ⚠️
**DO NOT modify port configurations under any circumstances.** The port assignments are fixed:
- **devai-dev (frontend)**: port 3008
- **devai-api-dev (API)**: port 3009
- **devai-staging (frontend)**: port 8090
- **devai-api-staging (API)**: port 8091

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
| `.env` | Contains secrets, not synced by Mutagen |
| `node_modules/` | Not synced, managed on Baso server |
| `dist/` or `build/` | Build artifacts, regenerated on Baso |
| `.git/` | Version control metadata |
| `package-lock.json` | Only modify via npm on Baso |
| `vite.config.*` | Port/server config - ASK FIRST |
| `ecosystem.config.*` | PM2 config - ASK FIRST |

### Never Run These Commands
- `npm install` - Dependencies are installed on Baso only
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

### View Baso Dev Server Logs
```bash
ssh root@77.42.90.193 "pm2 logs devai-dev --lines 50"
```

### Check PM2 Status on Baso
```bash
ssh root@77.42.90.193 "pm2 status"
```

## Git Branch Strategy

| Branch | Purpose | How to Deploy |
|--------|---------|---------------|
| `dev` | Active development | Auto-syncs via Mutagen |
| `staging` | Pre-production | Run project's deploy-to-staging script |
| `main` | Production | Run project's deploy-main script |

## Project Info

- **GitHub**: https://github.com/mojo117/Devai
- **PM2 Process**: devai-dev
- **Mutagen Sync**: devai-dev
- **Dev Port**: 3008

## Troubleshooting

### Preview Not Updating?
1. Check Mutagen sync: `mutagen sync list`
2. Check Vite server: `ssh root@77.42.90.193 "pm2 logs devai-dev --lines 20"`
3. Check for build errors in Vite output

### Can't Push to GitHub?
1. Check SSH key: `ssh -T git@github.com`
2. Check branch: `git branch --show-current` (should be `dev`)
3. Check remote: `git remote -v`

### Need to Run npm Commands?
Run them on Baso, not here:
```bash
ssh root@77.42.90.193 "cd /opt/shared-repos/Devai/worktree-preview && npm install"
```

## Reference

- Main Klyde docs: `/opt/Klyde/CLAUDE.md`
- Monitor sync: `mutagen sync monitor devai-dev`
- Baso SSH: `ssh root@77.42.90.193`
