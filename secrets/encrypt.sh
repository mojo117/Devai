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

# Klyde and Baso age public keys
KLYDE_KEY="age1dpc0fp0ts28m65zgsxzx2tmes7uc2fpjwvkdp7j6xp4q5w377g4s7cmd44"
BASO_KEY="age1d5554vm5qq9ge8377hez7hfncajr7e99qyzer6p3840q0aga353sn987l4"

if [ ! -f "$TEMPLATE" ]; then
    echo "Error: Template not found at $TEMPLATE"
    exit 1
fi

# Encrypt
echo "Encrypting $TEMPLATE -> $OUTPUT"
sops --encrypt \
    --input-type=dotenv \
    --age "$KLYDE_KEY,$BASO_KEY" \
    "$TEMPLATE" > "$OUTPUT"

echo "Done. Encrypted file: $OUTPUT"
echo ""
echo "IMPORTANT: Never commit the unencrypted files:"
echo "  - DO NOT commit: $TEMPLATE"
echo "  - DO commit: $OUTPUT"
echo ""
echo "To deploy to Baso:"
echo "  scp $OUTPUT root@77.42.90.193:/root/secrets/"
echo "  ssh root@77.42.90.193 'sops -d /root/secrets/devai.env.enc > /opt/Klyde/projects/Devai/.env'"
