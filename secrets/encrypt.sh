#!/bin/bash
# Encrypt devai.env template using SOPS + age
#
# Prerequisites:
#   - sops installed: brew install sops / apt install sops
#   - age installed: brew install age / apt install age
#   - age key generated (see README)
#
# Usage: ./encrypt.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/templates/devai.env"
OUTPUT="$SCRIPT_DIR/devai.env.enc"

# Check prerequisites
if ! command -v sops &> /dev/null; then
    echo "Error: sops not installed"
    echo "  macOS: brew install sops"
    echo "  Linux: apt install sops"
    exit 1
fi

if ! command -v age &> /dev/null; then
    echo "Error: age not installed"
    echo "  macOS: brew install age"
    echo "  Linux: apt install age"
    exit 1
fi

# Check for age public key
AGE_RECIPIENTS_FILE="$SCRIPT_DIR/.age-recipients"
if [ ! -f "$AGE_RECIPIENTS_FILE" ]; then
    echo "Error: $AGE_RECIPIENTS_FILE not found"
    echo "Create it with your age public key(s), one per line"
    echo "Example: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
    echo "Error: Template not found at $TEMPLATE"
    exit 1
fi

# Encrypt
echo "Encrypting $TEMPLATE -> $OUTPUT"
sops --encrypt \
    --age "$(cat "$AGE_RECIPIENTS_FILE" | tr '\n' ',')" \
    "$TEMPLATE" > "$OUTPUT"

echo "Done. Encrypted file: $OUTPUT"
echo ""
echo "To deploy to Baso:"
echo "  scp $OUTPUT root@77.42.90.193:/root/secrets/"
echo "  ssh root@77.42.90.193 'sops -d /root/secrets/devai.env.enc > /opt/Klyde/projects/Devai/.env'"
