# Shared Repository Deployment Pipeline

This document describes the centralized repository architecture and deployment workflow.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BASO (77.42.90.193)                             │
│                    Private IP: 10.0.0.4                                 │
│                    "Central Repository Hub"                             │
│                                                                         │
│   /opt/shared-repos/                                                    │
│   ├── bill-buddy/          ├── worktree-preview/ (dev branch)          │
│   │                        └── worktree-staging/ (staging branch)       │
│   ├── mylittletaskboard/   ... same structure                          │
│   ├── Savage/                                                           │
│   ├── dungeon-companion/                                                │
│   ├── founders-forge/                                                   │
│   ├── diedatenschuetzeronline/                                          │
│   ├── lowlands-city/                                                    │
│   ├── Devai/                                                            │
│   └── Test/                                                             │
│                                                                         │
│   PM2 Dev Servers:           PM2 Staging Servers:                       │
│   :3001 bill-buddy-dev       :8081 bill-buddy-staging                   │
│   :3002 mylittletaskboard    :8082 mylittletaskboard-staging            │
│   :3003 savage-dev           :8083 savage-staging                       │
│   :3004 dungeon-companion    :8084 dungeon-companion-staging            │
│   :3005 founders-forge       :8085 founders-forge-staging               │
│   :3006 dieda-dev            :8086 test-staging                         │
│   :3007 lowlands-dev         :8087 dieda-staging                        │
│   :3008 devai-dev            :8088 lowlands-staging                     │
│   :3009 devai-api-dev        :8089 klyde-staging                        │
│   :8088 klyde-dev            :8090 devai-staging                        │
│                              :8091 devai-api-staging                    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
              Hetzner Private Network (10.0.0.x)
                                │
         ┌──────────────────────┴──────────────────────┐
         │                                             │
         ▼                                             ▼
┌─────────────────────────────┐         ┌─────────────────────────────┐
│   KLYDE (46.224.197.7)      │         │   INFRIT (46.224.89.119)    │
│   Private IP: 10.0.0.2      │         │   "Staging Server"          │
│   "Dev/Preview Server"      │         │                             │
│                             │         │   Caddy → 10.0.0.4:808x     │
│   SSHFS: 10.0.0.4           │         │   staging-*.klyde.tech      │
│   /shared-repos/            │         │                             │
│                             │         │   SSHFS: 10.0.0.4           │
│   Klyde App :8088           │         │   /shared-repos/            │
│   klyde.tech                │         │                             │
│                             │         │   Infrit Dashboard :3000    │
│   Caddy → 10.0.0.4:300x     │         │   infrit.klyde.tech         │
│   *.klyde.tech (preview)    │         │                             │
└─────────────────────────────┘         └─────────────────────────────┘
```

## Server Information

| Server | Public IP | Private IP | Role | SSH |
|--------|-----------|------------|------|-----|
| Baso | 77.42.90.193 | 10.0.0.4 | Central repos + dev/staging servers | `ssh root@77.42.90.193` |
| Klyde | 46.224.197.7 | 10.0.0.2 | Dev/Preview routing (+ Klyde app production) | `ssh root@46.224.197.7` |
| Infrit | 46.224.89.119 | - | Staging routing + Infrit Dashboard | `ssh root@46.224.89.119` |

## Why This Architecture?

**Benefits of centralized servers on Baso:**
- All dev/staging servers run where code files are local (not over SSHFS)
- Single PM2 ecosystem managing all processes
- Klyde and Infrit only handle routing (Caddy reverse proxy)
- Lower latency via Hetzner private network (10.0.0.x)
- SSHFS mounts only used for file browsing, not for running servers

## Branch Strategy

All projects follow the unified branch pipeline:

```
dev → staging → main
 │        │        │
 │        │        └── Production (deployed automatically)
 │        └── Pre-Production Testing (on Infrit)
 └── Development (Preview on Klyde)
```

## Git Worktrees

Each repository on Baso has multiple worktrees:

| Worktree | Branch | Purpose | Used By |
|----------|--------|---------|---------|
| `worktree-preview/` | dev (Working Copy) | Live preview during development | Klyde |
| `worktree-staging/` | staging | Pre-production testing | Infrit |

## Deployment Workflow

### 1. Local Development
```bash
# Edit code locally
cd ~/Repo/<project>
# Make changes...
```

### 2. Push to Preview (Klyde)
```bash
# Commit to dev branch
git add .
git commit -m "Your message"
git push origin dev
```

The worktree-preview on Baso will show uncommitted changes for hot-reload preview.

### 3. Promote to Staging (Infrit)
```bash
# On Baso, merge dev to staging
ssh root@77.42.90.193
cd /opt/shared-repos/<project>
git checkout staging
git merge dev
git push origin staging
```

Or use the Infrit dashboard at https://infrit.klyde.tech to deploy.

### 4. Deploy to Production
```bash
# Merge staging to main
git checkout main
git merge staging
git push origin main
```

## Automatic Deployment via GitHub Actions

All projects (except Infrit) use **GitHub Actions** for automatic deployment when pushing to `dev` or `staging` branches.

### How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Push to dev    │────►│  GitHub Actions  │────►│  Baso Server    │
│  or staging     │     │  (SSH Action)    │     │  (77.42.90.193) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────────┐
                                              │  1. git pull        │
                                              │  2. npm run build   │
                                              │     (staging only)  │
                                              │  3. pm2 restart     │
                                              └─────────────────────┘
```

### Deployment Triggers

| Branch | Action | Target Worktree | Build Step |
|--------|--------|-----------------|------------|
| `dev` | Push | `worktree-preview/` | No (hot reload) |
| `staging` | Push | `worktree-staging/` | Yes (`npm run build`) |

### Workflow File

Each project has `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Baso

on:
  push:
    branches: [dev, staging]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Baso
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: 77.42.90.193
          username: root
          key: ${{ secrets.BASO_SSH_KEY }}
          script: |
            cd /opt/shared-repos/<project>
            if [ "${{ github.ref_name }}" = "dev" ]; then
              echo "Deploying dev branch to preview..."
              cd worktree-preview
              git pull origin dev
              pm2 restart <project>-dev
              echo "Preview deployment complete!"
            elif [ "${{ github.ref_name }}" = "staging" ]; then
              echo "Deploying staging branch..."
              cd worktree-staging
              git pull origin staging
              npm run build
              pm2 restart <project>-staging
              echo "Staging deployment complete!"
            fi
```

### GitHub Secret: BASO_SSH_KEY

Each repository requires a `BASO_SSH_KEY` secret containing the SSH private key for Baso server access.

**To add/update the secret:**
1. Go to repository → Settings → Secrets and variables → Actions
2. Add new repository secret named `BASO_SSH_KEY`
3. Paste the private key content

### Checking Deployment Status

1. Go to GitHub repository → Actions tab
2. Find the workflow run for your push
3. Click to see logs and status

**Common status meanings:**
- ✅ Success: Deployment completed
- ❌ Failed: Check logs for error (usually SSH or git issues)
- 🟡 In Progress: Deployment running

### Troubleshooting Auto-Deploy

#### Deployment Failed: SSH Connection Error
```
Error: can't connect without a private SSH key
```
**Solution:** Verify `BASO_SSH_KEY` secret is set correctly in repository settings.

#### Deployment Failed: Git Pull Error
```
error: cannot pull with rebase: You have unstaged changes
```
**Solution:** SSH to Baso and resolve conflicts manually:
```bash
ssh root@77.42.90.193
cd /opt/shared-repos/<project>/worktree-preview
git status
git stash  # or git checkout -- .
git pull origin dev
```

#### PM2 Process Not Found
```
[PM2] Process <project>-dev not found
```
**Solution:** The PM2 process may not exist. Start it manually:
```bash
ssh root@77.42.90.193 "pm2 start ecosystem.config.cjs"
```

### Manual Deployment (Fallback)

If auto-deploy fails, you can deploy manually:

```bash
# Preview (dev branch)
ssh root@77.42.90.193 "cd /opt/shared-repos/<project>/worktree-preview && git pull origin dev && pm2 restart <project>-dev"

# Staging
ssh root@77.42.90.193 "cd /opt/shared-repos/<project>/worktree-staging && git pull origin staging && npm run build && pm2 restart <project>-staging"
```

### Projects with Auto-Deploy

| Project | GitHub Repo | Auto-Deploy |
|---------|-------------|-------------|
| bill-buddy | mojo117/bill-buddy | ✅ |
| mylittletaskboard | mojo117/mylittletaskboard | ✅ |
| Savage | mojo117/Savage | ✅ |
| dungeon-companion | mojo117/dungeon-companion | ✅ |
| founders-forge | mojo117/founders-forge | ✅ |
| diedatenschuetzeronline | inksolutionseu/diedatenschuetzeronline | ✅ |
| lowlands-city | mojo117/lowlands-city | ✅ |
| Devai | mojo117/Devai | ✅ |
| Klyde | mojo117/Klyde | ✅ |
| Test | - | ❌ Staging only |
| **Infrit** | mojo117/Infrit | ❌ Manual only |

> **Note:** Infrit does NOT use auto-deploy. It requires manual deployment to ensure careful review of changes to the management dashboard. See Infrit's CLAUDE.md for deployment instructions.

## SSHFS Mount Configuration

Both Klyde and Infrit mount Baso's shared repos via SSHFS over the **private network** (10.0.0.4).

### On Klyde (46.224.197.7)
```bash
# /etc/fstab entry (uses private IP for lower latency):
root@10.0.0.4:/opt/shared-repos /shared-repos fuse.sshfs _netdev,allow_other,IdentityFile=/root/.ssh/id_ed25519,reconnect,ServerAliveInterval=15,ServerAliveCountMax=3 0 0
```

### On Infrit (46.224.89.119)
```bash
# /etc/fstab entry (uses private IP):
root@10.0.0.4:/opt/shared-repos /shared-repos fuse.sshfs _netdev,allow_other,IdentityFile=/root/.ssh/id_ed25519,reconnect,ServerAliveInterval=15,ServerAliveCountMax=3 0 0

# Symlinks in /opt/projects/ (for Infrit dashboard compatibility):
bill-buddy -> /shared-repos/bill-buddy/worktree-staging
mylittletaskboard -> /shared-repos/mylittletaskboard/worktree-staging
Savage -> /shared-repos/Savage/worktree-staging
dungeon-companion -> /shared-repos/dungeon-companion/worktree-staging
founders-forge -> /shared-repos/founders-forge/worktree-staging
diedatenschuetzeronline -> /shared-repos/diedatenschuetzeronline/worktree-staging
lowlands-city -> /shared-repos/lowlands-city/worktree-staging
Devai -> /shared-repos/Devai/worktree-staging
Klyde -> /shared-repos/Klyde/worktree-staging
Test -> /shared-repos/Test/worktree-staging
```

### Mount Commands
```bash
# Check mount status
mount | grep shared-repos

# Remount if needed
fusermount -uz /shared-repos  # Force unmount
mount /shared-repos

# Verify connectivity
ls /shared-repos/
```

## Managing Shared Repos

> **For detailed instructions on adding/removing projects, see [`PROJECT-MANAGEMENT.md`](./PROJECT-MANAGEMENT.md)**

### Adding a New Repository

On Baso:
```bash
cd /opt/shared-repos
./setup-repo.sh <repo-name> <github-url>
```

### Checking Status
```bash
# On Baso
cd /opt/shared-repos/<project>
git worktree list

# Verify mounts on Klyde/Infrit
ssh root@46.224.197.7 "ls /shared-repos/"
ssh root@46.224.89.119 "ls /shared-repos/"
```

### Remounting After Disconnect
```bash
# If SSHFS disconnects, remount:
ssh root@46.224.197.7 "mount /shared-repos"
ssh root@46.224.89.119 "mount /shared-repos"
```

## Troubleshooting

### SSHFS Mount Not Working
```bash
# Check if mount point exists and is accessible
ls -la /shared-repos

# Check if Baso is reachable
ping 77.42.90.193

# Force remount
umount /shared-repos 2>/dev/null
mount /shared-repos
```

### Git Operations Failing on Symlinks
Git operations should be performed on Baso directly, not through symlinks:
```bash
ssh root@77.42.90.193 "cd /opt/shared-repos/<project> && git pull"
```

### PM2 Process Using Old Config
```bash
pm2 delete <process-name>
pm2 start ecosystem.config.cjs
pm2 save
```

## Projects Included

| Project | Preview Port | Preview Domain | Staging Port | Staging Domain |
|---------|--------------|----------------|--------------|----------------|
| bill-buddy | 3001 | bill-buddy.klyde.tech | 8081 | staging-bill-buddy.klyde.tech |
| mylittletaskboard | 3002 | mylittletaskboard.klyde.tech | 8082 | staging-taskboard.klyde.tech |
| Savage | 3003 | savage.klyde.tech | 8083 | staging-savage.klyde.tech |
| dungeon-companion | 3004 | dungeon-companion.klyde.tech | 8084 | staging-dungeon.klyde.tech |
| founders-forge | 3005 | founders-forge.klyde.tech | 8085 | staging-forge.klyde.tech |
| Test | - | test.klyde.tech | 8086 | staging.test.klyde.tech |
| diedatenschuetzeronline | 3006 | diedatenschuetzeronline.klyde.tech | 8087 | staging-dieda.klyde.tech |
| lowlands-city | 3007 | lowlands.klyde.tech | 8088 | staging-lowlands.klyde.tech |
| Klyde | 8088 | klyde-dev.klyde.tech | 8089 | staging-klyde.klyde.tech |
| Devai | 3008 (+3009 API) | devai.klyde.tech | 8090 (+8091 API) | staging-devai.klyde.tech |

> **Note:** Klyde production (`klyde.tech`) runs locally on the Klyde server, not on Baso. The `klyde-dev` and `klyde-staging` entries above are for the dev/staging preview environments only.

## PM2 Management on Baso

All dev and staging servers run centrally on Baso, managed by PM2.

### Common Commands
```bash
# List all processes
ssh root@77.42.90.193 "pm2 list"

# Restart a dev server
ssh root@77.42.90.193 "pm2 restart bill-buddy-dev"

# Restart a staging server
ssh root@77.42.90.193 "pm2 restart bill-buddy-staging"

# View logs
ssh root@77.42.90.193 "pm2 logs bill-buddy-dev --lines 50"

# Restart all servers
ssh root@77.42.90.193 "pm2 restart all"
```

### PM2 Ecosystem Config
Located at `/opt/shared-repos/ecosystem.config.cjs` on Baso:
```javascript
module.exports = {
  apps: [
    // Dev servers (vite dev) - ports 3001-3009
    { name: "bill-buddy-dev", cwd: "/opt/shared-repos/bill-buddy/worktree-preview", script: "npm", args: "run dev -- --port 3001 --host 0.0.0.0" },
    { name: "devai-dev", cwd: "/opt/shared-repos/Devai/worktree-preview", script: "npm", args: "-w apps/web run dev -- --port 3008 --host 0.0.0.0" },
    { name: "devai-api-dev", cwd: "/opt/shared-repos/Devai/worktree-preview", script: "npm", args: "-w apps/api run dev", env: { PORT: "3009" } },
    { name: "klyde-dev", cwd: "/opt/shared-repos/Klyde/worktree-preview", script: "node", args: "backend/dist/server.js", env: { PORT: 8088, HOST: "10.0.0.4" } },
    // Staging servers (vite preview) - ports 8081-8091
    { name: "bill-buddy-staging", cwd: "/opt/shared-repos/bill-buddy/worktree-staging", script: "npm", args: "run preview -- --port 8081 --host 0.0.0.0" },
    { name: "test-staging", cwd: "/opt/shared-repos/Test/worktree-staging", script: "npx", args: "serve -l 8086 -s ." },
    { name: "klyde-staging", cwd: "/opt/shared-repos/Klyde/worktree-staging", script: "node", args: "backend/dist/server.js", env: { PORT: 8089, HOST: "10.0.0.4" } },
  ]
}
```

> **Note:** Devai is a monorepo with separate frontend (web) and backend (api) processes. Both must be running for the application to work.

## Caddy Reverse Proxy Configuration

### Klyde Server (Preview Domains)
Routes `*.klyde.tech` to Baso dev servers via private network:
```caddy
bill-buddy.klyde.tech {
    reverse_proxy 10.0.0.4:3001 {
        header_up Host localhost:3001
    }
}
```

### Infrit Server (Staging Domains)
Routes `staging-*.klyde.tech` to Baso staging servers:
```caddy
staging-bill-buddy.klyde.tech {
    reverse_proxy 10.0.0.4:8081 {
        header_up Host localhost:8081
    }
}
```

The `header_up Host localhost:PORT` ensures Vite accepts the request (Vite checks Host header).

## Environment Variables

### Klyde Server
```bash
SHARED_REPOS_PATH=/shared-repos
```

### Infrit Dashboard
Uses symlinks in /opt/projects/ pointing to /shared-repos/*/worktree-staging/

## Project Environment Files (.env)

**Important**: `.env` files are gitignored and NOT included in git worktrees.

When setting up new worktrees (preview or staging), you must manually create `.env` files for projects that require them.

### Projects Requiring .env Files

| Project | Required Variables | Purpose |
|---------|-------------------|---------|
| Savage | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase authentication |

### Setting Up .env for Staging

On Baso, create the .env file in the worktree-staging directory:
```bash
# Example for Savage
cat > /opt/shared-repos/Savage/worktree-staging/.env << 'EOF'
VITE_SUPABASE_URL=https://jhyevvbcgepsbcqucliv.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
EOF

# Then rebuild the project
cd /opt/shared-repos/Savage/worktree-staging
npm run build
```

### Symptoms of Missing .env
- Black/blank screen on page load
- JavaScript errors in browser console about undefined variables
- App fails to initialize (no login form, etc.)

### Where to Find .env Values
- Check backup directories: `/opt/projects-backup-*/<project>/.env`
- Or get from the project's Supabase dashboard
