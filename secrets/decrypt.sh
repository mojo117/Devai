#!/bin/bash
# Decrypt devai.env.enc on Baso server
#
# Prerequisites on Baso:
#   - sops installed
#   - age private key at /root/.config/sops/age/keys.txt
#
# Usage: ./decrypt.sh [target]
#   target: dev (default), staging, or path to .env location

set -e

ENCRYPTED="/root/secrets/devai.env.enc"

# Determine target
case "${1:-dev}" in
    dev)
        TARGET="/opt/Klyde/projects/Devai/.env"
        PM2_APP="devai-api-dev"
        ;;
    staging)
        TARGET="/opt/shared-repos/Devai/worktree-staging/.env"
        PM2_APP="devai-staging"
        ;;
    *)
        TARGET="$1"
        PM2_APP=""
        ;;
esac

# Check prerequisites
if [ ! -f "$ENCRYPTED" ]; then
    echo "Error: Encrypted file not found at $ENCRYPTED"
    echo "Copy it from local: scp secrets/devai.env.enc root@77.42.90.193:/root/secrets/"
    exit 1
fi

if [ ! -f "/root/.config/sops/age/keys.txt" ]; then
    echo "Error: age key not found at /root/.config/sops/age/keys.txt"
    echo "Generate with: age-keygen -o /root/.config/sops/age/keys.txt"
    exit 1
fi

# Decrypt
echo "Decrypting to $TARGET"
sops --decrypt "$ENCRYPTED" > "$TARGET"
chmod 600 "$TARGET"

echo "Done."

# Restart PM2 if applicable
if [ -n "$PM2_APP" ]; then
    echo "Restarting $PM2_APP..."
    pm2 restart "$PM2_APP" --update-env
fi
