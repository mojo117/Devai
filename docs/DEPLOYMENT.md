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
│  - .env file (development defaults)                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Mutagen Sync (~200-500ms)
                                    │ (excludes: .env, node_modules, dist)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BASO SERVER                                       │
│                    (77.42.90.193 / internal: 10.0.0.4)                       │
│                                                                              │
│  /opt/shared-repos/Devai/worktree-preview/    ← Dev environment             │
│  /opt/shared-repos/Devai/worktree-staging/    ← Staging environment         │
│                                                                              │
│  - PM2 runs all services                                                     │
│  - Vite dev server (frontend)                                                │
│  - Fastify API server (backend)                                              │
│  - .env file (production secrets - NOT synced!)                              │
│  - node_modules installed here                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Infrit Reverse Proxy
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PUBLIC ACCESS                                        │
│                                                                              │
│  https://devai.klyde.tech     → Dev environment                             │
│  https://devai-staging.klyde.tech → Staging environment                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Port Configuration

**IMPORTANT: Never change these ports!**

### Development Environment
| Service | Port | PM2 Name | Description |
|---------|------|----------|-------------|
| Frontend | 3008 | devai-dev | Vite dev server |
| API | 3009 | devai-api-dev | Fastify API |

### Staging Environment
| Service | Port | PM2 Name | Description |
|---------|------|----------|-------------|
| Frontend | 8090 | devai-staging | Vite preview/build |
| API | 8091 | devai-api-staging | Fastify API |

## PM2 Service Management

### Starting Services (on Baso)

```bash
# Frontend (Vite)
cd /opt/shared-repos/Devai/worktree-preview
VITE_PORT=3008 VITE_API_TARGET=http://localhost:3009 pm2 start 'npm run dev' --name devai-dev --cwd apps/web

# API (Fastify)
cd /opt/shared-repos/Devai/worktree-preview
PORT=3009 pm2 start 'npm run dev' --name devai-api-dev --cwd apps/api
```

### Checking Status
```bash
ssh root@10.0.0.4 "pm2 list | grep devai"
ssh root@10.0.0.4 "pm2 logs devai-api-dev --lines 50"
```

### Restarting Services
```bash
ssh root@10.0.0.4 "pm2 restart devai-api-dev"
ssh root@10.0.0.4 "pm2 restart devai-dev"
```

## Environment Variables

### Location
- **Klyde**: `/opt/Klyde/projects/Devai/.env` (dev defaults, synced to git)
- **Baso Dev**: `/opt/shared-repos/Devai/worktree-preview/.env` (production secrets)
- **Baso Staging**: `/opt/shared-repos/Devai/worktree-staging/.env` (staging secrets)

**CRITICAL**: `.env` files are NOT synced by Mutagen. You must manually update them on Baso.

### Required Variables (Baso .env)

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

## File Access via SSHFS

DevAI runs on Baso but needs to access project files stored on Klyde. This is achieved via an SSHFS mount:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  KLYDE (10.0.0.2 / 46.224.197.7)                                            │
│                                                                              │
│  /opt/Klyde/projects/          ← Actual project files                       │
│    ├── Devai/                                                                │
│    ├── bill-buddy/                                                           │
│    ├── Infrit/                                                               │
│    └── ...                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ SSHFS Mount (root@10.0.0.2)
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BASO (10.0.0.4 / 77.42.90.193)                                             │
│                                                                              │
│  /mnt/klyde-projects/          ← SSHFS mount point (read-write)             │
│    ├── Devai/                  ← Same files as Klyde                        │
│    ├── bill-buddy/                                                           │
│    └── ...                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### SSHFS Mount Command
```bash
# On Baso - mount Klyde projects
sshfs root@10.0.0.2:/opt/Klyde/projects /mnt/klyde-projects -o allow_other,default_permissions

# Verify mount
mount | grep sshfs
ls /mnt/klyde-projects
```

### Allowed Roots (Security)

DevAI can only access files under these hardcoded paths (see `apps/api/src/config.ts`):
```typescript
const HARDCODED_ALLOWED_ROOTS: readonly string[] = [
  '/opt/Klyde/projects',      // Direct access (if running on Klyde)
  '/mnt/klyde-projects',      // SSHFS mount (when running on Baso)
] as const;
```

This means:
- DevAI tools (fs.readFile, fs.writeFile, etc.) can access any project under these roots
- The user selects a project root in the UI, which must be under one of these paths
- Paths outside these roots are blocked for security

## Troubleshooting

### "Error in input stream" on chat
- Check API logs: `ssh root@10.0.0.4 "pm2 logs devai-api-dev --lines 50"`
- Usually means missing/invalid API keys in .env
- Verify: should show "Configured LLM providers: Anthropic, OpenAI, Gemini"

### 502 Bad Gateway
- Check if services are running: `ssh root@10.0.0.4 "pm2 list | grep devai"`
- Check ports: `ssh root@10.0.0.4 "netstat -tlpn | grep -E '3008|3009'"`
- Restart services if needed

### Login fails with "Unknown error"
- Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
- Note: auth.ts needs BOTH prefixed (DEVAI_) and non-prefixed versions

### .env changes not taking effect
- PM2 caches env vars. Restart with: `pm2 restart devai-api-dev`
- Or delete and recreate the PM2 process

## Development Workflow

1. **Edit files** on Klyde at `/opt/Klyde/projects/Devai/`
2. **Mutagen syncs** changes to Baso (~500ms)
3. **Vite hot-reloads** the frontend automatically
4. **API restarts** via tsx watch automatically
5. **View changes** at https://devai.klyde.tech

## Recent Changes (2026-01-20)

### SQLite → Supabase Migration
- Replaced SQLite with Supabase due to Mutagen sync corruption
- All DB operations now async
- Files changed:
  - `apps/api/src/db/index.ts` - Supabase client
  - `apps/api/src/db/queries.ts` - Async queries
  - `apps/api/src/routes/*.ts` - Added await to DB calls

### Port Configuration Fix
- Frontend: 3008 (was incorrectly on 5173)
- API: 3009 (was incorrectly on 3000)
- Added VITE_PORT and VITE_API_TARGET for Vite

### Environment Variable Fix
- Added non-prefixed SUPABASE_URL for auth.ts compatibility
- Added all LLM API keys to Baso .env

## Recent Changes (2026-01-20 - Session 2)

### UI Layout Overhaul
All panels now on the right side for cleaner layout:
- **AI Prompts** (blue): Shows system prompt, top position
- **Tools** (gray): Center position, includes skills/files/tools
- **Access** (gray): Below Tools, shows allowed paths
- **History** (purple): Bottom position, session history

### Enhanced Path Handling
- AI now receives working directory in Project Context
- Added explicit 4-step path verification process
- Case-insensitive path resolution for target paths (e.g., `/test` → `/Test`)
- Fixed `validateTargetPath` to handle paths like `/test/adam` correctly

### New Features
- `GET /api/system-prompt` - Exposes AI system prompt for UI
- `PromptsPanel` component - Shows AI system prompt in collapsible panel
- Added `fs.move` and `fs.delete` to system prompt documentation

### Files Changed
- `apps/api/src/routes/chat.ts` - System prompt endpoint, enhanced PATH HANDLING
- `apps/api/src/tools/fs.ts` - Fixed validateTargetPath case-insensitive matching
- `apps/web/src/components/PromptsPanel.tsx` - New component
- `apps/web/src/components/HistoryPanel.tsx` - Moved to right side
- `apps/web/src/App.tsx` - Added PromptsPanel
- `apps/web/src/api.ts` - Added fetchSystemPrompt
