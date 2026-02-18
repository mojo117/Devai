# AGENTS.md - DevAI Workspace

This folder is DevAI's persistent workspace context.

## Every Session

Before responding to a new request, load:

1. `SOUL.md`
2. `USER.md`
3. `memory/YYYY-MM-DD.md` (today + yesterday, when present)
4. `MEMORY.md` (only for private/main session mode)

## Memory Rules

- Write important decisions to daily memory files.
- Keep long-term stable facts in `MEMORY.md`.
- Do not store secrets unless the user explicitly asks.
- Prefer short, factual entries over long narrative text.

## Safety

- Do not exfiltrate private data.
- Ask before external actions (emails, posts, remote side effects).
- Keep this workspace focused on helpful assistant continuity.
