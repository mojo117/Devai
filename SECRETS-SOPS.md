# SOPS + Age Encryption for DevAI

This project uses [SOPS](https://github.com/getsops/sops) with [Age](https://age-encryption.org/) for encrypting sensitive environment files.

## 🔑 Keys

The following Age public keys are authorized for decryption:

- **Klyde** (development/preview): `age16t54dlj0u9jxafdywcy82h9q0xwakzfeqtj20tkpy9zaz5gpd5kqa6n4wp`
- **Baso** (deployment server): `age1d5554vm5qq9ge8377hez7hfncajr7e99qyzer6p3840q0aga353sn987l4`

## 📁 Encrypted Files

| File | Description |
|------|-------------|
| `.env.enc` | Main project environment (production secrets) |
| `secrets/devai.env.enc` | Template for server deployment |

## 🔒 Encryption

To encrypt the `.env` file after making changes:

```bash
./encrypt-env.sh
```

Or for the template file:

```bash
cd secrets && ./encrypt.sh
```

## 🔓 Decryption

To decrypt for local development:

```bash
./decrypt-env.sh
```

On the server (Baso):

```bash
cd /opt/Klyde/projects/Devai/secrets && ./decrypt.sh dev
```

## 🚨 CRITICAL: What NOT to Commit

**NEVER commit these unencrypted files:**
- `.env` (root)
- `secrets/templates/*.env`
- Any file containing real API keys

**DO commit:**
- `.env.enc`
- `secrets/devai.env.enc`
- `.env.example` (template without real values)

## 🔧 SOPS Configuration

The `.sops.yaml` file defines the encryption rules:

```yaml
creation_rules:
  - path_regex: \.env($|\.enc$)
    age: age16t54dlj0u9jxafdywcy82h9q0xwakzfeqtj20tkpy9zaz5gpd5kqa6n4wp,age1d5554vm5qq9ge8377hez7hfncajr7e99qyzer6p3840q0aga353sn987l4
```

## 📋 Deployment Workflow

1. Update `.env` with new secrets locally
2. Run `./encrypt-env.sh` to create `.env.enc`
3. Commit `.env.enc` only
4. On server, run `./decrypt-env.sh` to regenerate `.env`
5. Restart PM2 process
