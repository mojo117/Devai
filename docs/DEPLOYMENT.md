# DevAI Deployment Architecture

## Overview

DevAI runs on a two-server architecture with Mutagen sync for development:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            KLYDE SERVER                                      │
│                         (46.224.197.7)                                       │
│                                                                              │
│  /opt/Klyde/projects/Devai/     ← Source code edited here                   │
│                                                                              │
│  - Git repository (origin)                                                   │
│  - Where Claude Code makes edits                                             │
│  - Caddy reverse proxy for devai.klyde.tech                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Mutagen Sync (~500ms)
                                    │ (excludes: .env, node_modules, dist)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLAWD SERVER                                      │
│                    (46.225.162.103 / internal: 10.0.0.5)                     │
│                                                                              │
│  /opt/Devai/                     ← Dev runtime environment                  │
│                                                                              │
│  - PM2 runs all services                                                     │
│  - Vite dev server (frontend)                                                │
│  - Fastify API server (backend)                                              │
│  - .env file (production secrets - NOT synced!)                              │
│  - node_modules installed here                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Caddy Reverse Proxy (on Klyde)
                                    │ devai.klyde.tech → 10.0.0.5:3008/3009
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PUBLIC ACCESS                                        │
│                                                                              │
│  https://devai.klyde.tech     → Dev environment                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Port Configuration

**IMPORTANT: Never change these ports!**

| Service | Port | PM2 Name | Description |
|---------|------|----------|-------------|
| Frontend | 3008 | devai-dev | Vite dev server |
| API | 3009 | devai-api-dev | Fastify API |

## PM2 Service Management

### Starting Services (on Clawd)

```bash
# Frontend (Vite)
cd /opt/Devai
VITE_PORT=3008 VITE_API_TARGET=http://localhost:3009 pm2 start 'npm run dev' --name devai-dev --cwd apps/web

# API (Fastify)
cd /opt/Devai
PORT=3009 pm2 start 'npm run dev' --name devai-api-dev --cwd apps/api
```

### Checking Status
```bash
ssh root@10.0.0.5 "pm2 list | grep devai"
ssh root@10.0.0.5 "pm2 logs devai-api-dev --lines 50"
```

### Restarting Services
```bash
ssh root@10.0.0.5 "pm2 restart devai-api-dev"
ssh root@10.0.0.5 "pm2 restart devai-dev"
```

## Environment Variables

### Location
- **Klyde**: `/opt/Klyde/projects/Devai/.env` (dev defaults, synced to git)
- **Clawd**: `/opt/Devai/.env` (production secrets, NOT synced by Mutagen)

**CRITICAL**: The `.env` file on Clawd is NOT synced by Mutagen. You must manually update it on Clawd.

### Required Variables (Clawd .env)

```bash
# Server
NODE_ENV=production
PORT=3009  # For API, but PM2 overrides this

# Authentication (shared with Infrit)
DEVAI_JWT_SECRET=<long-random-secret>
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-key>

# Also needed without prefix (for auth.ts)
DEVAI_SUPABASE_URL=https://your-project.supabase.co
DEVAI_SUPABASE_SERVICE_ROLE_KEY=<supabase-service-key>

# LLM Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIza...
```

### Vite Environment Variables
Vite uses different env var names:
- `VITE_PORT` - Frontend port (not `PORT`)
- `VITE_API_TARGET` - API URL for proxy (e.g., `http://localhost:3009`)

## Database (Supabase)

DevAI uses Supabase for:
- **Sessions** - Chat session metadata
- **Messages** - Chat history
- **Settings** - User preferences
- **Audit Logs** - Tool execution history
- **Admin Users** - Authentication (shared with Infrit)

### Tables
```sql
-- Created in Supabase dashboard
users (id, name, created_at)
sessions (id, user_id, title, created_at)
messages (id, session_id, role, content, timestamp)
settings (id, user_id, key, value, updated_at)
audit_logs (id, action, data, created_at)
admin_users (email, password_hash, is_active)  -- Shared with Infrit
```

## Filesystem Access

DevAI runs directly on Clawd and has local access to the filesystem. No SSHFS mounts are needed.

### Allowed Roots (Security)

DevAI can only access files under these hardcoded paths (see `apps/api/src/config.ts`):
```typescript
const HARDCODED_ALLOWED_ROOTS: readonly string[] = [
  '/root',
  '/opt',
] as const;
```

This means:
- DevAI tools (fs.readFile, fs.writeFile, etc.) can access any path under `/root` or `/opt`
- This gives full access to the Clawd server filesystem where needed
- The user selects a project root in the UI, which must be under one of these paths
- Paths outside these roots are blocked for security

## Troubleshooting

### "Error in input stream" on chat
- Check API logs: `ssh root@10.0.0.5 "pm2 logs devai-api-dev --lines 50"`
- Usually means missing/invalid API keys in .env
- Verify: should show "Configured LLM providers: Anthropic, OpenAI, Gemini"

### 502 Bad Gateway
- Check if services are running: `ssh root@10.0.0.5 "pm2 list | grep devai"`
- Check ports: `ssh root@10.0.0.5 "netstat -tlpn | grep -E '3008|3009'"`
- Restart services if needed

### Login fails with "Unknown error"
- Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env on Clawd
- Note: auth.ts needs BOTH prefixed (DEVAI_) and non-prefixed versions

### .env changes not taking effect
- PM2 caches env vars. Restart with: `ssh root@10.0.0.5 "pm2 restart devai-api-dev"`
- Or delete and recreate the PM2 process

## Development Workflow

1. **Edit files** on Klyde at `/opt/Klyde/projects/Devai/`
2. **Mutagen syncs** changes to Clawd at `/opt/Devai/` (~500ms)
3. **Vite hot-reloads** the frontend automatically
4. **API restarts** via tsx watch automatically
5. **View changes** at https://devai.klyde.tech
