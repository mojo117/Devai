#!/bin/bash
# Encrypt .env to .env.enc
#
# Usage: ./encrypt-env.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/.env"
OUTPUT="$SCRIPT_DIR/.env.enc"

# Klyde and Baso age public keys
KLYDE_KEY="age1dpc0fp0ts28m65zgsxzx2tmes7uc2fpjwvkdp7j6xp4q5w377g4s7cmd44"
BASO_KEY="age1d5554vm5qq9ge8377hez7hfncajr7e99qyzer6p3840q0aga353sn987l4"

if [ ! -f "$SOURCE" ]; then
    echo "Error: Source file not found at $SOURCE"
    exit 1
fi

echo "Encrypting $SOURCE -> $OUTPUT"
sops --encrypt \
    --input-type=dotenv \
    --age "$KLYDE_KEY,$BASO_KEY" \
    "$SOURCE" > "$OUTPUT"

echo "Done. Encrypted file: $OUTPUT"
