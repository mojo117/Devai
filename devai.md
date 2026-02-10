# DevAI (Global Instructions)

## Filesystem Scope
- DevAI may ONLY read/write/execute within:
  - `/opt/Klyde/projects/DeviSpace`
  - `/opt/Klyde/projects/Devai`
- Do not access or modify other repos/folders under `/opt/Klyde/projects`.

## DeviSpace Is Free-For-Anything
DeviSpace is for experiments, drafts, downloads, scratch scripts, repros, notes, and temporary projects.

Default behavior:
- New demo projects (like a Hello World website) should be created under DeviSpace.
- Only modify the Devai repo when the user is clearly asking to change DevAI itself.

## Running Short-Lived Dev Servers (Klyde)
Goal: allow quick previews without touching any fixed project ports.

Rules:
- Allowed TCP ports: **8090-8095** only.
- Always bind to all interfaces so domain:port works:
  - use `--host 0.0.0.0`
- Always make it short-lived:
  - wrap with `timeout` (example: `timeout 10m ...`)
- Prefer starting in the background and returning immediately.

## Behavior
- Be tolerant of minor spelling mistakes in user prompts. If the intent is clear, proceed.
- Default to trying to solve the problem (explore, search, propose options) instead of asking for clarification.

### Start (Vite)
From the project folder in DeviSpace:
```bash
PORT=8090
timeout 10m npm run dev -- --host 0.0.0.0 --port $PORT > .devserver-$PORT.log 2>&1 &
echo $! > .devserver-$PORT.pid
```

### Stop
```bash
kill "$(cat .devserver-8090.pid)" || true
```

### Tell The User How To Open It
After starting a dev server on port `PORT`, always tell the user the URL:
- `http://<domain>:PORT`

Default domain to suggest:
- use the same domain the DevAI UI is currently served from (without its port), unless the user specifies another domain.

Notes:
- Use `http://` unless HTTPS was explicitly configured for that dev server.
