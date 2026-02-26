# Devai Code Guidelines Audit

**Status:** Sprint 1 abgeschlossen, Sprint 2-4 offen  
**Erstellt:** 2026-02-23

---

## ✅ Sprint 1 - ERLEDIGT

| # | Issue | Datei | Status |
|---|-------|-------|--------|
| 1 | `any` Type | `mcp/client.ts` | ✅ Interfaces definiert |
| 2 | `any` Type | `apps/web/src/api.ts` | ✅ Interfaces definiert |
| 3 | TypeScript Error | `services/fileParser.ts:96` | ✅ pdf-parse Import fix |

---

## 🟠 Sprint 2 - HOCH

### Große Dateien aufteilen

| # | Issue | Datei | Zeilen | Lösung |
|---|-------|-------|--------|--------|
| 6 | Datei zu groß | `tools/nativeToolRegistry.ts` | 1287 | Aufteilen in `registry/filesystem.ts`, `registry/bash.ts`, etc. |
| 7 | Datei zu groß | `scheduler/schedulerService.ts` | 727 | Service/Queries trennen |
| 8 | Datei zu groß | `tools/fs.ts` | 703 | Aufteilen nach Funktionsgruppen |
| 9 | Datei zu groß | `tools/executor.ts` | 631 | Executor/Handlers trennen |

---

## 🟡 Sprint 3 - MITTEL

### Code Style & Logging

| # | Issue | Datei | Problem |
|---|-------|-------|---------|
| 10 | Double quotes | `config.ts` | Double quotes statt single quotes |
| 11 | Import ohne .js | `config.ts:1-2` | Import ohne `.js` Extension |
| 12 | Funktionen zu lang | `routes/auth.ts` | Mehrere Funktionen >50 Zeilen |
| 13 | Funktionen zu lang | `routes/project.ts` | Mehrere Funktionen >50 Zeilen |
| 14 | Logging Format | `memory/compaction.ts`, `extraction.ts` | `console.log` ohne `[Modul]` Prefix |
| 15 | Logging Format | `routes/userfiles.ts:109,139` | Fehlendes `[Modul]` Prefix |

---

## 🟢 Sprint 4 - NIEDRIG

### Dateigrößen prüfen

| # | Issue | Datei | Zeilen |
|---|-------|-------|--------|
| 16 | Datei zu groß | `db/schedulerQueries.ts` | 496 |
| 17 | Datei zu groß | `db/queries.ts` | 479 |
| 18 | Datei zu groß | `agents/types.ts` | 468 |
| 19 | Datei zu groß | `agents/events.ts` | 440 |
| 20 | Semicolons | Diverse Dateien | Inkonsistent |

---

## Referenz

- **Code Guidelines:** `docs/CODE_GUIDELINES.md`
- **Fortschritt:** 5/20 Issues gelöst (25%)

## Nächste Schritte

1. Sprint 2: Große Dateien aufteilen (#6-9)
2. Sprint 3: Code Style korrigieren (#10-15)
3. Sprint 4: Restliche Dateien prüfen (#16-20)
