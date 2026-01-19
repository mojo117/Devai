# Devai - AI Development Assistant

> **Deployment**: Auto-deploys via GitHub Actions on push to `dev` or `staging`.
> See [DEPLOYMENT-PIPELINE.md](./DEPLOYMENT-PIPELINE.md) for architecture details.

## Quick Reference

| Environment | Branch | Auto-Deploy | URL |
|-------------|--------|-------------|-----|
| Preview | dev | On push | devai.klyde.tech |
| Staging | staging | On push + build | staging-devai.klyde.tech |
| Production | main | Manual | TBD |

## Project Structure

Devai is a **monorepo** with separate frontend and backend:

```
apps/
├── web/     # Frontend (Vite)
└── api/     # Backend API
```

**Important**: Both processes must be running for the app to work:
- `devai-dev` (port 3008) - Frontend
- `devai-api-dev` (port 3009) - API Backend

## Git Workflow

**Pipeline**: `dev` → `staging` → `main`

1. Make all changes on `dev` branch
2. Push to dev: `git push origin dev` (auto-deploys to preview)
3. Merge to staging for pre-production testing

## Deployment

### Automatic (Recommended)

```bash
# Deploy to preview
git push origin dev

# Deploy to staging
git push origin staging
```

### Manual (Fallback)

```bash
# Preview
ssh root@77.42.90.193 "cd /opt/shared-repos/Devai/worktree-preview && git pull origin dev && pm2 restart devai-dev devai-api-dev"

# Staging
ssh root@77.42.90.193 "cd /opt/shared-repos/Devai/worktree-staging && git pull origin staging && npm run build && pm2 restart devai-staging devai-api-staging"
```

### View Logs

```bash
ssh root@77.42.90.193 "pm2 logs devai-dev --lines 50"
ssh root@77.42.90.193 "pm2 logs devai-api-dev --lines 50"
```

## Server Details

| Server | Role | IP |
|--------|------|-----|
| Baso | Hosts dev/staging servers | 77.42.90.193 |
| Klyde | Routes preview domains | 46.224.197.7 |
| Infrit | Routes staging domains | 46.224.89.119 |

## Local Development with Mutagen Sync

Mutagen provides **real-time file synchronization** from Klyde to Baso, enabling instant hot-reload without commits.

### How It Works

```
Klyde Server                    Mutagen (~200-500ms)           Baso Server
/opt/Klyde/projects/Devai/  ───────────────────────►  /opt/shared-repos/Devai/worktree-preview/
                                                               ↓
                                                      Vite dev server (hot-reload)
                                                               ↓
                                                      devai.klyde.tech
```

1. Edit code in `/opt/Klyde/projects/Devai/` on Klyde
2. Mutagen automatically syncs changes to Baso (~200-500ms)
3. Vite dev server detects changes and hot-reloads
4. View live at `https://devai.klyde.tech`
5. **Commit and push to `dev` branch to persist changes**

### Mutagen Commands (run on Klyde)

```bash
# Check sync status
mutagen sync list

# Monitor this project's sync
mutagen sync monitor devai-dev

# Pause/resume sync
mutagen sync pause devai-dev
mutagen sync resume devai-dev
```

### Important Notes

- **One-way sync only**: Klyde → Baso (never syncs back)
- **`.env` files ignored**: Copy manually from `worktree-staging/` if needed
- **Changes not persisted**: Must commit & push to `dev` to save work
- **Ignored patterns**: `.git`, `node_modules`, `dist`, `.vite`, `.cache`, `*.log`
