# Secrets Management

See [secrets/README.md](./secrets/README.md) for complete documentation on SOPS + age encryption.

## 🔑 Encryption Keys

This project uses **SOPS + age** with dual-key encryption:

| Location | Public Key |
|----------|------------|
| **Klyde** (dev/preview) | `age1dpc0fp0ts28m65zgsxzx2tmes7uc2fpjwvkdp7j6xp4q5w377g4s7cmd44` |
| **Baso** (deployment) | `age1d5554vm5qq9ge8377hez7hfncajr7e99qyzer6p3840q0aga353sn987l4` |

## Quick Reference

### Encrypt Root .env (Local)
```bash
./encrypt-env.sh
```

### Encrypt Template (Local)
```bash
./secrets/encrypt.sh
```

### Decrypt Root .env (Local)
```bash
./decrypt-env.sh
```

### Deploy to Baso
```bash
# Deploy encrypted files
scp .env.enc root@77.42.90.193:/opt/Klyde/projects/Devai/
scp secrets/devai.env.enc root@77.42.90.193:/root/secrets/
```

### Decrypt on Baso
```bash
# Decrypt and restart dev environment
ssh root@77.42.90.193 '/opt/Klyde/projects/Devai/secrets/decrypt.sh dev'

# Decrypt and restart staging environment
ssh root@77.42.90.193 '/opt/Klyde/projects/Devai/secrets/decrypt.sh staging'
```

### One-liner: Encrypt + Deploy + Decrypt + Restart
```bash
./encrypt-env.sh && \
scp .env.enc root@77.42.90.193:/opt/Klyde/projects/Devai/ && \
ssh root@77.42.90.193 './decrypt-env.sh && pm2 restart devai-api-dev --update-env'
```

## 🚨 Security Rules

**NEVER commit:**
- `.env` (unencrypted)
- `secrets/templates/*.env` (unencrypted with real secrets)
- Any private keys

**DO commit:**
- `.env.enc` (encrypted)
- `secrets/devai.env.enc` (encrypted)
- `.env.example` (template without real values)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models | For Anthropic provider |
| `OPENAI_API_KEY` | OpenAI API key for GPT models | For OpenAI provider |
| `GEMINI_API_KEY` | Google API key for Gemini models | For Gemini provider |
| `GITHUB_TOKEN` | GitHub PAT for repo operations | For GitHub tools |
| `SUPABASE_URL` | Supabase project URL | For auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | For auth |
| `DEVAI_JWT_SECRET` | Secret for signing JWTs | For auth |
