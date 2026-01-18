# DevAI - Cloud-based AI Developer Assistant

Ein MVP fuer einen cloud-basierten AI Developer Assistant mit React Frontend und Node.js Backend.

## Features

- Chat UI mit LLM-Integration (Claude, OpenAI, Gemini)
- Kontrollierte DevOps-Aktionen (nur Staging, kein Prod)
- Confirmation Flow fuer riskante Aktionen
- Audit Logging aller Tool-Aktionen
- Admin-Login via Supabase (Single-User)
- API-Routen geschuetzt per JWT (alle /api ausser /api/health und /api/auth/*)

## Voraussetzungen

- Node.js 20+
- npm 10+

## Installation

```bash
# Dependencies installieren
npm install

# Environment konfigurieren
cp .env.example .env
# Dann .env bearbeiten und API Keys eintragen
```

## Entwicklung

```bash
# Backend und Frontend parallel starten
npm run dev

# Nur Backend
npm run dev:api

# Nur Frontend
npm run dev:web
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## Environment Variablen

| Variable | Beschreibung |
|----------|-------------|
| `SUPABASE_URL` | Supabase Projekt-URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key (nur Backend) |
| `DEVAI_JWT_SECRET` | JWT Secret fuer Login-Tokens |
| `JWT_EXPIRES_IN` | JWT Ablaufzeit (z. B. 24h) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API Key |
| `OPENAI_API_KEY` | OpenAI API Key |
| `GEMINI_API_KEY` | Google Gemini API Key |
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `GITHUB_OWNER` | GitHub Repository Owner |
| `GITHUB_REPO` | GitHub Repository Name |
| `PROJECT_ROOT` | Pfad zum verwalteten Projekt |

## Authentifizierung (Supabase)

- Login laeuft ueber `POST /api/auth/login` und Token-Check ueber `GET /api/auth/verify`.
- UI speichert das JWT lokal und sendet es als `Authorization: Bearer <token>`.
- Alle `/api/*` Routen sind geschuetzt, ausser `/api/health` und `/api/auth/*`.
- Datenbasis: Tabelle `admin_users` mit `email`, `password_hash` (bcrypt), optional `is_active`.
- Single-Admin-Setup, keine Rollenlogik.

## GitHub Actions Konfiguration

Workflows werden in `apps/api/config/workflows.json` konfiguriert:

```json
{
  "stagingDeployWorkflow": "deploy-staging.yml",
  "testWorkflow": "ci.yml"
}
```

### Workflows triggern (Staging/Test)

- Stelle sicher, dass `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` gesetzt sind.
- Im Chat kannst du z. B. schreiben: "Trigger staging deploy auf main".
- Der Assistent erzeugt eine Aktion via `askForConfirmation`; in der UI musst du die Aktion aktiv freigeben.
- Alternativ kannst du die Aktion per API freigeben:

```bash
# actionId aus /api/actions oder Chat-Antwort entnehmen
curl -X POST http://localhost:3001/api/actions/approve \
  -H "Content-Type: application/json" \
  -d '{"actionId":"<ACTION_ID>"}'
```

## Sicherheit

- API Keys sind nur serverseitig verfuegbar
- API-Zugriff erfordert JWT (ausser /api/health und /api/auth/*)
- Riskante Aktionen (writeFile, commit, deploy) erfordern explizite Bestaetigung
- Alle Aktionen werden in `var/audit.log` protokolliert

## Current State (Implementation Notes)

This repository contains a working MVP with a React/Vite frontend and Fastify API backend, aligned to `Projektziel.txt`.

### Implemented

- Monorepo layout: `apps/web`, `apps/api`, `shared`
- Chat API: `POST /api/chat` with LLM routing (Anthropic/OpenAI/Gemini)
- Auth API: `POST /api/auth/login`, `GET /api/auth/verify` (Supabase, JWT)
- API Guard: JWT-Pflicht fuer alle `/api/*` ausser /api/health und /api/auth/*
- Confirmation flow: tools that require approval must use `askForConfirmation`, creating pending actions
- Actions API: list actions and approve execution via `POST /api/actions/approve`
- Tool system (whitelisted): `fs.*`, `git.*`, `github.*`, `logs.*`
- Audit logging for tool/actions in `var/audit.log`
- Project scan: analyzes `package.json` and injects a short context block into the LLM system prompt
- GitHub Actions trigger: workflow_dispatch via `github.triggerWorkflow` with `apps/api/config/workflows.json`

### Configuration

- `.env` expected at repo root
- `PROJECT_ROOT` controls the default managed repo
- `ALLOWED_ROOTS` enables extra filesystem access (semicolon or comma separated)

### Frontend

- Simple chat UI, actions sidebar with approval buttons
- Tools slider shows available tools
- Access slider lists allowed filesystem roots (from `/api/health`)

### Known Gaps vs. Projektziel.txt

- Provider dropdown exists but is not yet wired in the UI (provider is currently fixed to OpenAI)
- Actions UI only shows pending actions in the sidebar (approved/done are not listed)
- Adam subpage in Klyde project is not implemented

### Quick Verify

```bash
npm run dev
```

- Web: http://localhost:5174 (if 5173 is taken)
- API: http://localhost:3001

## Lizenz

MIT
