# Secrets Management

DevAI uses **SOPS + age** for encrypting secrets. This allows secrets to be stored safely in git while only being decryptable on authorized machines.

## 🔑 Keys

The following Age public keys are authorized for decryption:

| Location | Public Key |
|----------|------------|
| **Klyde** (dev/preview) | `age16t54dlj0u9jxafdywcy82h9q0xwakzfeqtj20tkpy9zaz5gpd5kqa6n4wp` |
| **Baso** (deployment) | `age1d5554vm5qq9ge8377hez7hfncajr7e99qyzer6p3840q0aga353sn987l4` |

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Local Development (Klyde)                                       │
│  ┌─────────────────┐     encrypt.sh      ┌─────────────────┐   │
│  │ templates/      │ ──────────────────► │ devai.env.enc   │   │
│  │ devai.env       │                     │ (encrypted)     │   │
│  │ (plaintext)     │                     │ safe for git    │   │
│  └─────────────────┘                     └────────┬────────┘   │
│         ▲                                         │            │
│         │              ┌─────────────┐            │            │
│         └──────────────│   .env.enc  │◄───────────┘            │
│              decrypt   │  (committed)│    encrypt               │
│                        └─────────────┘                         │
└────────────────────────────────────────────────────────────────┘
                           │ scp
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Baso Server (77.42.90.193)                                     │
│  ┌─────────────────┐     decrypt.sh      ┌─────────────────┐   │
│  │ /root/secrets/  │ ──────────────────► │ /opt/Klyde/     │   │
│  │ devai.env.enc   │                     │ projects/Devai/ │   │
│  │                 │                     │ .env            │   │
│  └─────────────────┘                     └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## How It Works

### SOPS (Secrets OPerationS)
- Mozilla's tool for encrypting/decrypting files
- Encrypts values but keeps keys visible (easy to see what's configured)
- Supports multiple encryption backends (age, GPG, AWS KMS, etc.)

### age
- Modern, simple encryption tool
- Uses public/private key pairs
- Public key encrypts, private key decrypts
- Keys are short and easy to manage

## Initial Setup

### 1. Install Tools

**macOS:**
```bash
brew install sops age
```

**Linux (Ubuntu/Debian):**
```bash
apt install sops age
```

### 2. Generate age Key Pair (if needed)

```bash
# Create config directory
mkdir -p ~/.config/sops/age

# Generate key pair
age-keygen -o ~/.config/sops/age/keys.txt

# Output shows your public key:
# Public key: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Usage

### Quick Start

**Encrypt root .env:**
```bash
cd /opt/Klyde/projects/Devai
./encrypt-env.sh
```

**Decrypt root .env:**
```bash
cd /opt/Klyde/projects/Devai
./decrypt-env.sh
```

**Encrypt template:**
```bash
cd /opt/Klyde/projects/Devai/secrets
./encrypt.sh
```

**Decrypt on Baso:**
```bash
ssh root@77.42.90.193
cd /opt/Klyde/projects/Devai/secrets
./decrypt.sh dev      # For dev environment
./decrypt.sh staging  # For staging
```

### Detailed Workflow

1. **Edit secrets:**
   ```bash
   # Edit root .env or secrets/templates/devai.env
   vim .env
   ```

2. **Encrypt:**
   ```bash
   # For root .env
   ./encrypt-env.sh
   
   # For template
   ./secrets/encrypt.sh
   ```

3. **Commit:**
   ```bash
   git add .env.enc secrets/devai.env.enc
   git commit -m "Update encrypted secrets"
   git push
   ```

4. **Deploy to Baso:**
   ```bash
   scp .env.enc root@77.42.90.193:/opt/Klyde/projects/Devai/
   scp secrets/devai.env.enc root@77.42.90.193:/root/secrets/
   ```

5. **Decrypt and restart on Baso:**
   ```bash
   ssh root@77.42.90.193
   cd /opt/Klyde/projects/Devai
   ./decrypt-env.sh
   pm2 restart devai-api-dev --update-env
   ```

## File Structure

```
Devai/
├── .env                          # Plaintext (DO NOT COMMIT - in .gitignore)
├── .env.enc                      # Encrypted (COMMIT THIS)
├── .env.example                  # Template without real values (COMMIT)
├── .sops.yaml                    # SOPS configuration (COMMIT)
├── encrypt-env.sh                # Root encryption script
├── decrypt-env.sh                # Root decryption script
├── SECRETS-SOPS.md               # Quick reference
└── secrets/
    ├── README.md                 # This file
    ├── .gitignore                # Ignores unencrypted templates
    ├── encrypt.sh                # Template encryption script
    ├── decrypt.sh                # Server decryption script
    ├── templates/
    │   └── devai.env             # Plaintext (DO NOT COMMIT)
    └── devai.env.enc             # Encrypted (COMMIT THIS)
```

## 🚨 Security Notes

1. **NEVER commit plaintext secrets:**
   - `.env` (root)
   - `secrets/templates/*.env`
   - Any file containing real API keys

2. **DO commit:**
   - `.env.enc`
   - `secrets/devai.env.enc`
   - `.env.example` (template without real values)

3. **Keep private keys secure:**
   - Never share `~/.config/sops/age/keys.txt`
   - Never commit private keys

4. **Rotate keys periodically:**
   - Generate new age keys and re-encrypt

## Troubleshooting

**"could not decrypt data key"**
- Your age private key isn't in the recipients list
- Check the public key in `.sops.yaml` matches your private key

**"no matching keys found"**
- Check `~/.config/sops/age/keys.txt` exists
- Verify the public key is in `.sops.yaml`

**SOPS tries to parse as JSON:**
- Use `--input-type=dotenv --output-type=dotenv` flags
- This is now handled automatically in scripts

**PM2 not picking up new env:**
```bash
pm2 restart devai-api-dev --update-env
```
