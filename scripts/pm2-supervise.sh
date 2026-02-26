#!/usr/bin/env bash
set -euo pipefail

HOST="root@77.42.90.193"
RESTART_MISSING="false"
TAIL_LOGS="false"
APPS=("devai-dev" "devai-api-dev")

usage() {
  cat <<'EOF'
Usage: scripts/pm2-supervise.sh [options]

Checks PM2 process state for DevAI services on Baso and optionally restarts missing/offline apps.

Options:
  --host <ssh-host>        SSH target (default: root@77.42.90.193)
  --restart-missing        Restart app if missing or not online
  --tail-logs              Tail recent logs after checks
  -h, --help               Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="$2"
      shift 2
      ;;
    --restart-missing)
      RESTART_MISSING="true"
      shift
      ;;
    --tail-logs)
      TAIL_LOGS="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

status_for_app() {
  local app="$1"
  ssh "${HOST}" "pm2 show '${app}' 2>/dev/null | awk -F': ' '/status/ {print \$2; exit}' | tr -d '[:space:]'" || true
}

restart_app() {
  local app="$1"
  echo "[pm2-supervise] Restarting ${app} on ${HOST}"
  ssh "${HOST}" "pm2 restart '${app}' --update-env"
}

echo "[pm2-supervise] Checking PM2 app status on ${HOST}"
all_healthy="true"

for app in "${APPS[@]}"; do
  status="$(status_for_app "${app}")"
  if [[ -z "${status}" ]]; then
    echo "  - ${app}: missing"
    all_healthy="false"
    if [[ "${RESTART_MISSING}" == "true" ]]; then
      restart_app "${app}"
    fi
    continue
  fi

  echo "  - ${app}: ${status}"
  if [[ "${status}" != "online" ]]; then
    all_healthy="false"
    if [[ "${RESTART_MISSING}" == "true" ]]; then
      restart_app "${app}"
    fi
  fi
done

if [[ "${TAIL_LOGS}" == "true" ]]; then
  echo "[pm2-supervise] Tailing logs for API and web"
  ssh "${HOST}" "pm2 logs devai-api-dev --lines 60 --nostream; pm2 logs devai-dev --lines 60 --nostream"
fi

if [[ "${all_healthy}" == "true" ]]; then
  echo "[pm2-supervise] All monitored apps are online."
else
  echo "[pm2-supervise] One or more apps are unhealthy."
fi
