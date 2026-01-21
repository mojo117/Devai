# Secrets Management

DevAI uses **SOPS + age** for encrypting secrets. This allows secrets to be stored safely in git while only being decryptable on authorized machines.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Local Development                                               │
│  ┌─────────────────┐     encrypt.sh      ┌─────────────────┐   │
│  │ templates/      │ ──────────────────► │ devai.env.enc   │   │
│  │ devai.env       │                     │ (encrypted)     │   │
│  │ (plaintext)     │                     │ safe for git    │   │
│  └─────────────────┘                     └────────┬────────┘   │
└───────────────────────────────────────────────────┼─────────────┘
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
# age
apt install age

# sops (download from releases)
wget https://github.com/getsops/sops/releases/download/v3.8.1/sops-v3.8.1.linux.amd64
sudo mv sops-v3.8.1.linux.amd64 /usr/local/bin/sops
sudo chmod +x /usr/local/bin/sops
```

**Windows (via scoop):**
```powershell
scoop install sops age
```

### 2. Generate age Key Pair

```bash
# Generate key pair
age-keygen -o ~/.config/sops/age/keys.txt

# Output shows your public key:
# Public key: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Save the public key - you'll need it for encryption.

### 3. Configure Recipients

Create `.age-recipients` file with public keys of everyone who should be able to encrypt:

```bash
# secrets/.age-recipients
age1abc123...  # Your key
age1def456...  # Baso server key
age1ghi789...  # Team member key
```

### 4. Set Up Baso Server

```bash
# On Baso, generate a key if not exists
ssh root@77.42.90.193
age-keygen -o /root/.config/sops/age/keys.txt
cat /root/.config/sops/age/keys.txt  # Get public key

# Create secrets directory
mkdir -p /root/secrets
```

Add Baso's public key to your local `.age-recipients` file.

## Usage

### Editing Secrets

1. Edit the plaintext template:
   ```bash
   vim secrets/templates/devai.env
   ```

2. Encrypt:
   ```bash
   ./secrets/encrypt.sh
   ```

3. Deploy to Baso:
   ```bash
   scp secrets/devai.env.enc root@77.42.90.193:/root/secrets/
   ```

4. Decrypt on Baso:
   ```bash
   ssh root@77.42.90.193
   cd /opt/Klyde/projects/Devai
   ./secrets/decrypt.sh dev      # For dev environment
   ./secrets/decrypt.sh staging  # For staging
   ```

### Quick Commands

**Encrypt and deploy:**
```bash
./secrets/encrypt.sh && scp secrets/devai.env.enc root@77.42.90.193:/root/secrets/
```

**Decrypt on Baso (one-liner from local):**
```bash
ssh root@77.42.90.193 'sops -d /root/secrets/devai.env.enc > /opt/Klyde/projects/Devai/.env && pm2 restart devai-api-dev --update-env'
```

### Viewing Encrypted File

SOPS keeps the structure visible:
```bash
cat secrets/devai.env.enc
# Shows:
# ANTHROPIC_API_KEY=ENC[AES256_GCM,data:...,type:str]
# OPENAI_API_KEY=ENC[AES256_GCM,data:...,type:str]
```

### Editing Encrypted File Directly

SOPS can edit in-place:
```bash
sops secrets/devai.env.enc
# Opens in $EDITOR, decrypted
# Saves re-encrypted automatically
```

## File Structure

```
secrets/
├── README.md           # This file
├── .age-recipients     # Public keys for encryption (DO NOT COMMIT)
├── .gitignore          # Ignores sensitive files
├── encrypt.sh          # Encryption script
├── decrypt.sh          # Decryption script (for Baso)
├── templates/
│   └── devai.env       # Plaintext template (DO NOT COMMIT)
└── devai.env.enc       # Encrypted secrets (safe to commit)
```

## Security Notes

1. **Never commit plaintext secrets** - templates/devai.env is in .gitignore
2. **Keep private keys secure** - Never share ~/.config/sops/age/keys.txt
3. **Rotate keys periodically** - Generate new age keys and re-encrypt
4. **Limit recipients** - Only add keys for people/machines that need access

## Troubleshooting

**"could not decrypt data key"**
- Your age private key isn't in the recipients list
- Re-encrypt with your public key added to .age-recipients

**"no matching keys found"**
- Check /root/.config/sops/age/keys.txt exists on Baso
- Verify the public key is in .age-recipients

**PM2 not picking up new env:**
```bash
pm2 restart devai-api-dev --update-env
```
