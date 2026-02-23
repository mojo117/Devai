#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-/opt/Klyde/projects/Devai/var/devai.db}"
KEEP_LAST="${2:-14}"

if [[ ! -f "${DB_PATH}" ]]; then
  echo "DB file not found: ${DB_PATH}" >&2
  exit 1
fi

if ! [[ "${KEEP_LAST}" =~ ^[0-9]+$ ]]; then
  echo "KEEP_LAST must be a non-negative integer, got: ${KEEP_LAST}" >&2
  exit 1
fi

db_dir="$(dirname "${DB_PATH}")"
db_name="$(basename "${DB_PATH}")"
db_base="${db_name%.db}"
backup_dir="${db_dir}/backups"
timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
destination="${backup_dir}/${db_base}-${timestamp}.db"

mkdir -p "${backup_dir}"
cp "${DB_PATH}" "${destination}"

echo "[backup-local-db] Created backup: ${destination}"

mapfile -t backups < <(ls -1t "${backup_dir}/${db_base}-"*.db 2>/dev/null || true)

if (( ${#backups[@]} > KEEP_LAST )); then
  for old_backup in "${backups[@]:KEEP_LAST}"; do
    rm -f "${old_backup}"
    echo "[backup-local-db] Removed old backup: ${old_backup}"
  done
fi
