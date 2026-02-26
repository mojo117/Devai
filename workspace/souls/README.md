# Team Souls

Diese Datei-Sammlung definiert die Charaktere einzelner Team-Agents:

- `CAIO.SOUL.md`
- `DEVO.SOUL.md`
- `SCOUT.SOUL.md`

## Datumsquelle

Geburtsdaten wurden aus der Git-Historie abgeleitet:
- Repo-Start: erster Commit am 2026-01-18
- Agent-Start: erster relevanter Agent-Commit im Repo

## Vorschlaege fuer Nutzung

1. Prompt-Anbindung pro Agent
- In `apps/api/src/prompts/caio.ts`, `apps/api/src/prompts/devo.ts`, `apps/api/src/prompts/scout.ts`
  jeweils einen kurzen Abschnitt einfuegen:
  "Identitaet siehe workspace/souls/<AGENT>.SOUL.md. Lebe sie, zitiere sie nicht."

2. Runtime-Loading pro Agent
- Analog zum Workspace-Loader einen kleinen `agentSoulLoader` bauen,
  der je Agent die passende Datei laedt und in den Systemprompt injiziert.

3. Konsistenz-Regel
- `workspace/SOUL.md` bleibt Team- und CHAPO-Ebene.
- Agent-spezifische Souls bleiben in `workspace/souls/`.

4. Change-Disziplin
- Bei Aenderungen an Soul-Dateien immer:
  - kurz changeloggen in `workspace/memory/YYYY-MM-DD.md`
  - Team auf Ton- und Rollen-Konflikte pruefen
