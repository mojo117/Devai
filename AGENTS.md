# AGENTS
> **Zentrale Deployment-Dokumentation:** [DEPLOYMENT-PIPELINE.md](./DEPLOYMENT-PIPELINE.md)

## Overview
- Devai runs on Klyde server with Mutagen sync to Baso.
- Preview: https://devai.klyde.tech (dev port 3008)
- API dev port: 3009
- Staging ports: 8090 (web), 8091 (api)

## Branch and Deploy (Standard)
- Pipeline: dev -> staging -> main. Never push directly to staging or main.
- Auto-deploy: Yes (GitHub Actions on push to dev or staging).
- Promote via Klyde deploy scripts (repo-level), do not push to staging/main directly.
- Default workflow: make code changes on branch `dev` in `/opt/Klyde/projects/Devai` (this Klyde worktree). Only switch branches/worktrees if the user explicitly asks.

## Servers and SSH (Standard)
- Baso (77.42.90.193, private 10.0.0.4): central repos + PM2 dev/staging servers.
- Klyde (46.224.197.7, private 10.0.0.2): preview routing + Klyde production.
- Infrit (46.224.89.119): staging routing + Infrit dashboard.
- SSH: ssh root@77.42.90.193 | ssh root@46.224.197.7 | ssh root@46.224.89.119

## Ports and Infra (Do Not Touch)
- Ports are centrally managed in Infrit/backend/src/config/projects.ts.
- Changing ports requires coordinated updates (PM2 ecosystem, Caddy, UFW). Do not change.

## Klyde Server Workflow
- Edit files in /opt/Klyde/projects/Devai/ (Klyde server).
- Mutagen syncs to /opt/shared-repos/Devai/worktree-preview on Baso.
- Check preview at https://devai.klyde.tech.
- Do not develop inside Baso `/opt/shared-repos/Devai/*` worktrees unless explicitly requested (those are deployment/runtime worktrees).

## Filesystem Access Policy (DevAI)
- Allowed roots (only):
  - `/opt/Klyde/projects/DeviSpace`
  - `/opt/Klyde/projects/Devai`
- For other repos/paths: ask the user to copy files into `DeviSpace` or explicitly expand access.

Default behavior:
- New demo projects (e.g. Hello World sites) go into `DeviSpace`.
- Do not overwrite DevAI UI entrypoints unless the user explicitly requests modifying DevAI itself.

## Do Not Do
- Do not change ports or PM2 configs.
- Do not run npm install on Klyde (dependencies live on Baso).
- Do not modify .env, node_modules, dist/build, or .git.

## Useful Checks
- mutagen sync list | grep devai-dev
- ssh root@77.42.90.193 "pm2 logs devai-dev --lines 50"

## External APIs (Appwrite)
- TaskForge task access is available via Appwrite Function executions: `POST https://appwrite.klyde.tech/v1/functions/api-project-access/executions`.
- Project ID header: `X-Appwrite-Project: 69805803000aeddb2ead`.
- The project API key (`tfapi_...`) is not committed; store it in `.env` (example name: `DEVAI_TASKBOARD_API_KEY`, managed/encrypted via SOPS; see `SECRETS.md`).
- Details/curl example: see `CLAUDE.md`.
