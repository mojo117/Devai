# Secrets Management (SOPS + age)

Devai secrets are managed with SOPS + age and stored encrypted in the Infrastructure repo.

## Encrypted File Location

- `C:\Users\joern\Repo\Infrastructure\secrets/devai.env.enc`

## Decrypt on Baso

Requirements on Baso:
- `sops` installed
- age key at `/root/.config/sops/age/keys.txt`

```bash
# Copy encrypted file to Baso
scp C:\Users\joern\Repo\Infrastructure\secrets\devai.env.enc root@77.42.90.193:/root/secrets/devai.env.enc

# Decrypt for dev and staging worktrees
sops --decrypt /root/secrets/devai.env.enc > /opt/shared-repos/Devai/worktree-preview/.env
chmod 600 /opt/shared-repos/Devai/worktree-preview/.env

sops --decrypt /root/secrets/devai.env.enc > /opt/shared-repos/Devai/worktree-staging/.env
chmod 600 /opt/shared-repos/Devai/worktree-staging/.env

# Reload env in PM2
pm2 restart devai-dev --update-env
pm2 restart devai-staging --update-env
```

## Updating Secrets

1. Edit template: `C:\Users\joern\Repo\Infrastructure\secrets\templates/devai.env`
2. Re-encrypt: `scripts/secrets/encrypt-env.sh devai`
3. Deploy encrypted file and decrypt on the server as shown above.
