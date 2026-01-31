#!/bin/bash
# Decrypt .env.enc to .env for local development
#
# Usage: ./decrypt-env.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENCRYPTED="$SCRIPT_DIR/.env.enc"
TARGET="$SCRIPT_DIR/.env"

if [ ! -f "$ENCRYPTED" ]; then
    echo "Error: Encrypted file not found at $ENCRYPTED"
    exit 1
fi

if [ ! -f "$HOME/.config/sops/age/keys.txt" ]; then
    echo "Error: age key not found at ~/.config/sops/age/keys.txt"
    echo "You need to have the private key to decrypt."
    exit 1
fi

echo "Decrypting $ENCRYPTED to $TARGET"
sops --input-type=dotenv --output-type=dotenv --decrypt "$ENCRYPTED" > "$TARGET"
chmod 600 "$TARGET"

echo "Done. .env file created."
