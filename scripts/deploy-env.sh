#!/usr/bin/env bash
set -euo pipefail

HOST="root@77.42.90.193"
REMOTE_REPO_DIR="/opt/Klyde/projects/Devai"
REMOTE_SECRETS_DIR="/root/secrets"
TARGET_ENV="dev"

usage() {
  cat <<'EOF'
Usage: scripts/deploy-env.sh [options]

Deploys encrypted env files to Baso and runs remote decrypt + PM2 env reload.

Options:
  --host <ssh-host>               SSH target (default: root@77.42.90.193)
  --remote-repo-dir <path>        Remote repo dir for .env.enc (default: /opt/Klyde/projects/Devai)
  --remote-secrets-dir <path>     Remote secrets dir for devai.env.enc (default: /root/secrets)
  --target <dev|staging|path>     Target passed to secrets/decrypt.sh (default: dev)
  -h, --help                      Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="$2"
      shift 2
      ;;
    --remote-repo-dir)
      REMOTE_REPO_DIR="$2"
      shift 2
      ;;
    --remote-secrets-dir)
      REMOTE_SECRETS_DIR="$2"
      shift 2
      ;;
    --target)
      TARGET_ENV="$2"
      shift 2
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

echo "[deploy-env] Encrypting root .env -> .env.enc"
./encrypt-env.sh

if [[ -f "${REPO_ROOT}/secrets/encrypt.sh" ]]; then
  echo "[deploy-env] Encrypting secrets template -> secrets/devai.env.enc"
  ./secrets/encrypt.sh
fi

echo "[deploy-env] Ensuring remote directories exist"
ssh "${HOST}" "mkdir -p '${REMOTE_REPO_DIR}' '${REMOTE_SECRETS_DIR}'"

echo "[deploy-env] Uploading encrypted env files"
scp "${REPO_ROOT}/.env.enc" "${HOST}:${REMOTE_REPO_DIR}/.env.enc"
if [[ -f "${REPO_ROOT}/secrets/devai.env.enc" ]]; then
  scp "${REPO_ROOT}/secrets/devai.env.enc" "${HOST}:${REMOTE_SECRETS_DIR}/devai.env.enc"
fi

echo "[deploy-env] Running remote decrypt/reload workflow"
ssh "${HOST}" "cd '${REMOTE_REPO_DIR}' && ./decrypt-env.sh && ./secrets/decrypt.sh '${TARGET_ENV}'"

echo "[deploy-env] Completed successfully."
