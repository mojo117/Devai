# Workflow Events and Logs Runbook

## Purpose

This runbook describes how to diagnose DevAI workflow and automation issues using the new health telemetry, scheduler execution logs, and fallback logs.

## Primary Signals

1. Health endpoint
```bash
curl -sS http://localhost:3009/api/health | jq
```

2. Scheduler execution logs (Supabase table)
```sql
select job_name, execution_type, phase, message, created_at
from scheduler_execution_logs
order by created_at desc
limit 50;
```

3. Fallback scheduler log file (used when Supabase insert fails)
```bash
tail -n 200 /opt/Klyde/projects/Devai/var/scheduler-events-fallback.jsonl
```

4. PM2 process checks (Baso)
```bash
scripts/pm2-supervise.sh --host root@77.42.90.193
```

## Health Interpretation

`/api/health` returns:
- `200` with `status: "ok"` when critical dependencies are healthy.
- `503` with `status: "degraded"` when at least one critical dependency is down.

Critical checks:
- Supabase data plane (`users` query)
- Scheduler runtime running state
- At least one configured LLM provider

Useful fields:
- `dependencies.supabase.*` for last check, latency, and error
- `dependencies.scheduler.*` for scheduled/internal job counts and recovery status
- `latestEvents.schedulerFailure*` and `latestEvents.watchdog*` for last known failures

## Internal Maintenance Jobs

The scheduler now manages internal jobs:
- `maintenance-userfile-cleanup`
- `maintenance-memory-decay`
- `maintenance-local-db-backup`
- `system-health-watchdog`

If an internal job fails 3 times consecutively:
- It is auto-disabled.
- A scheduler execution log entry is written with `phase = 'disabled'`.
- Auto-recovery attempts run after cooldown windows.

## Incident Playbook

1. Confirm degraded status:
```bash
curl -sS http://localhost:3009/api/health | jq '.status, .dependencies.supabase, .dependencies.scheduler'
```

2. Check recent scheduler failures:
```sql
select job_name, phase, message, created_at
from scheduler_execution_logs
where phase in ('failure', 'disabled')
order by created_at desc
limit 20;
```

3. Check PM2 status and restart only if required:
```bash
scripts/pm2-supervise.sh --host root@77.42.90.193 --restart-missing
```

4. If Supabase telemetry writes fail, inspect fallback log:
```bash
tail -n 200 /opt/Klyde/projects/Devai/var/scheduler-events-fallback.jsonl
```

5. Verify recovery:
```bash
curl -sS http://localhost:3009/api/health | jq '.status, .latestEvents'
```

## Backup / Restore Notes

Daily local DB backup job writes snapshots under:
- `/opt/Klyde/projects/Devai/var/backups/`

Manual backup:
```bash
scripts/backup-local-db.sh /opt/Klyde/projects/Devai/var/devai.db 14
```

Retention is enforced by both:
- Internal maintenance backup job
- `scripts/backup-local-db.sh` when run manually
