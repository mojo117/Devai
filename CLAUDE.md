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

| Component | Value |
|-----------|-------|
| Dev Port (Frontend) | 3008 |
| Dev Port (API) | 3009 |
| Staging Port | 8090 |
| PM2 Dev Process | devai-dev, devai-api-dev |
| PM2 Staging Process | devai-staging, devai-api-staging |

## Port Assignments - DO NOT MODIFY

⚠️ **CRITICAL**: Port assignments are centrally managed. Do not change ports in vite.config, package.json, or PM2 configs.

**Central Registry**: Port assignments are defined in `Infrit/backend/src/config/projects.ts`

Changing ports requires coordinated updates to:
1. Infrit project registry (`backend/src/config/projects.ts`)
2. Baso PM2 ecosystem config (`/opt/shared-repos/ecosystem.config.cjs`)
3. Baso firewall rules (UFW)
4. Klyde/Infrit Caddy reverse proxy configs
