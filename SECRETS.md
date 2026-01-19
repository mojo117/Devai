# Secrets Management

See [secrets/README.md](./secrets/README.md) for complete documentation on SOPS + age encryption.

## Quick Reference

### Encrypt (Local)
```bash
./secrets/encrypt.sh
```

### Deploy to Baso
```bash
scp secrets/devai.env.enc root@77.42.90.193:/root/secrets/
```

### Decrypt on Baso
```bash
ssh root@77.42.90.193 '/opt/Klyde/projects/Devai/secrets/decrypt.sh dev'
```

### One-liner: Encrypt + Deploy + Decrypt + Restart
```bash
./secrets/encrypt.sh && \
scp secrets/devai.env.enc root@77.42.90.193:/root/secrets/ && \
ssh root@77.42.90.193 'sops -d /root/secrets/devai.env.enc > /opt/Klyde/projects/Devai/.env && pm2 restart devai-api-dev --update-env'
```

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
