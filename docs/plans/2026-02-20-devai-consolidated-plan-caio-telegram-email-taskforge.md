# Devai Masterplan (Detailed): CAIO + Telegram + Email + TaskForge

**Date:** 2026-02-20  
**Status:** Active Implementation Master  
**Branch:** `dev`  
**Planning horizon:** Tasks 10-20 (open implementation block)

## 1. Ziel des Masterplans

Dieser Plan ersetzt eine lose Sammlung von Design-/Implementierungsnotizen durch einen ausfuehrbaren Umsetzungsplan mit:

1. klaren Workpackages
2. konkreten Dateien pro Workpackage
3. technischen Schritten in Implementierungsreihenfolge
4. testbaren Exit-Kriterien
5. Risiko- und Rollback-Vorgehen

Fokus bleibt strikt auf:

1. CAIO-Delegation in CHAPO
2. Telegram als externer Input/Output-Kanal
3. Scheduler -> `processRequest()` -> Telegram
4. stabile End-to-End-Funktion fuer TaskForge/Email/Reminder/Notifications

## 2. Konsolidierte Quellplaene

1. `docs/plans/2026-02-19-automation-assistant-design.md`
2. `docs/plans/2026-02-20-automation-assistant-implementation.md`
3. `docs/plans/2026-02-19-unified-workflow-event-pipeline.md`
4. `docs/plans/2026-02-19-agent-documentation-update.md`
5. `docs/plans/2026-02-19-userfile-ai-integration-design.md`

## 3. Verifizierter Ist-Stand (Codebasis 2026-02-20)

### 3.1 Bereits implementiert

1. CAIO agent + prompt vorhanden:
2. `apps/api/src/agents/caio.ts`
3. `apps/api/src/prompts/caio.ts`
4. TaskForge/Email tools vorhanden:
5. `apps/api/src/tools/taskforge.ts`
6. `apps/api/src/tools/email.ts`
7. Tool registration + executor cases vorhanden:
8. `apps/api/src/tools/registry.ts`
9. `apps/api/src/tools/executor.ts`
10. CAIO im Router registriert:
11. `apps/api/src/agents/router.ts`
12. Config keys fuer TaskForge/Resend/Telegram vorhanden:
13. `apps/api/src/config.ts`
14. Scheduler-Grundlage vorhanden:
15. `apps/api/src/scheduler/schedulerService.ts`
16. `apps/api/src/db/schedulerQueries.ts`

### 3.2 Noch offen (technisch bestaetigt)

1. CHAPO meta-tools `delegateToCaio` und `delegateParallel` fehlen in:
2. `apps/api/src/agents/chapo.ts`
3. CHAPO prompt routing fuer CAIO fehlt bzw. passt nicht zur Zielarchitektur:
4. `apps/api/src/prompts/chapo.ts`
5. CAIO-Delegation + Parallel-Delegation fehlen in:
6. `apps/api/src/agents/chapo-loop.ts`
7. Telegram client und external route fehlen:
8. `apps/api/src/external/telegram.ts` (neu)
9. `apps/api/src/routes/external.ts` (neu)
10. External output projection fehlt:
11. `apps/api/src/workflow/projections/externalOutputProjection.ts` (neu)
12. Projection registration fehlt:
13. `apps/api/src/workflow/projections/index.ts`
14. Server wiring ist noch placeholder:
15. `apps/api/src/server.ts`
16. External-session helper fuer projection/routing fehlen teilweise:
17. `apps/api/src/db/schedulerQueries.ts`
18. Scheduler error context injection in System Context fehlt:
19. `apps/api/src/agents/systemContext.ts`

## 4. Architektur- und Guardrail-Regeln

### 4.1 Architekturprinzipien

1. Kein neuer Decision Layer
2. Alle Inputs laufen durch den existierenden Dispatcher/Router-Pfad
3. CHAPO bleibt Orchestrator
4. Event-Projections bleiben fuer Side-Effects zustaendig

### 4.2 Nicht-Ziele

1. Keine Ports/PM2/Proxy/UFW Aenderungen
2. Keine `.env`-Aenderungen in diesem Task
3. Kein Umbau der bestehenden WebSocket-Contracts

### 4.3 Qualitaetsregeln

1. Teilfehler in Parallel-Delegation duerfen Gesamtantwort nicht komplett abbrechen
2. Telegram-Route muss immer schnell mit 200 antworten
3. Projection-Fehler duerfen Workflow nicht crashen
4. Scheduler darf bei Fehlern nicht unendlich retryen

## 5. Detaillierter Umsetzungsplan (Workpackages)

## WP-10: CHAPO Meta-Tools erweitern

**Ziel:** CHAPO kann explizit an CAIO delegieren und parallel delegieren.

**Dateien:**

1. `apps/api/src/agents/chapo.ts`
2. optional: `apps/api/src/agents/types.ts` (nur falls weitere Typen benoetigt)

**Implementierungsschritte:**

1. In `CHAPO_AGENT.capabilities` `canDelegateToCaio: true` setzen.
2. In `CHAPO_AGENT.tools` neue Toolnamen aufnehmen:
3. `delegateToCaio`
4. `delegateParallel`
5. In `CHAPO_META_TOOLS` zwei neue Definitionen aufnehmen:
6. `delegateToCaio` mit required `task`, optional `context`.
7. `delegateParallel` mit required `delegations`.
8. `delegations`-Schema: array von `{ agent: 'devo' | 'caio' | 'scout', task: string, context?: string }`.
9. Bestehende `registerMetaTools(...)` und `registerAgentTools(...)` weiterverwenden.

**Tests/Checks:**

1. `rg -n "delegateToCaio|delegateParallel" apps/api/src/agents/chapo.ts`
2. Toolnamen im Registry-Zugriff fuer CHAPO sichtbar.

**Exit-Kriterien:**

1. CHAPO kann beide Tools an LLM exponieren.
2. Keine TypeScript-Fehler in `chapo.ts`.

## WP-11: CHAPO Prompt Routing aktualisieren

**Ziel:** Prompt reflektiert reale Delegationslogik inkl. CAIO.

**Dateien:**

1. `apps/api/src/prompts/chapo.ts`

**Implementierungsschritte:**

1. Abschnitt "Agent routing" hinzufuegen/ueberarbeiten:
2. DEVO fuer code/devops/system changes.
3. CAIO fuer tickets/email/scheduler/reminders/notifications.
4. SCOUT fuer research.
5. Regel fuer `delegateParallel` definieren:
6. nur bei unabhaengigen Teilaufgaben
7. bei Abhaengigkeit sequentiell delegieren
8. Veraltete Hinweise entfernen, die CAIO oder Delegations-Tools widersprechen.

**Tests/Checks:**

1. Prompt enthaelt `CAIO` + `delegateToCaio` + `delegateParallel`.
2. Keine widerspruechlichen Routing-Regeln.

**Exit-Kriterien:**

1. Prompt ist konsistent mit `CHAPO_META_TOOLS`.
2. Routing fuer ticket/email/scheduler ist eindeutig.

## WP-12: CAIO Delegation im ChapoLoop

**Ziel:** CHAPO kann CAIO Sub-Loop wie DEVO-Delegation ausfuehren.

**Dateien:**

1. `apps/api/src/agents/chapo-loop.ts`

**Implementierungsschritte:**

1. Im Tool-Call-Loop neuen Branch fuer `delegateToCaio` einfuegen.
2. Neue private Methode `delegateToCaio(task, context?)` implementieren analog zu `delegateToDevo`.
3. CAIO-Tools ueber `getToolsForAgent('caio')` filtern.
4. Eventing:
5. `agent_switch` chapo -> caio
6. `delegation` chapo -> caio
7. `agent_complete` fuer caio + switch zurueck zu chapo
8. Eskalation behandeln:
9. `escalateToChapo` aus CAIO-Subloop sauber zurueck an CHAPO geben.
10. Optional SCOUT-Delegation aus CAIO-Subloop zulassen (wie bei DEVO).
11. Max-Turn-Guard setzen (z. B. 10 Turns).

**Tests/Checks:**

1. `rg -n "delegateToCaio|agent_switch|caio" apps/api/src/agents/chapo-loop.ts`
2. Subloop endet immer mit Rueckgabe string.

**Exit-Kriterien:**

1. `delegateToCaio` funktioniert ohne Laufzeitfehler.
2. Agent-Switching Events sind nachvollziehbar im Stream/Log.

## WP-13: DELEGATE_PARALLEL Handler

**Ziel:** CHAPO kann mehrere Delegationen parallel ausfuehren und Teilergebnisse behalten.

**Dateien:**

1. `apps/api/src/agents/chapo-loop.ts`

**Implementierungsschritte:**

1. Tool-Call-Branch fuer `delegateParallel` einfuegen.
2. Argumente robust validieren (`delegations` muss nicht-leeres array sein).
3. Dispatch je Delegation:
4. agent `devo` -> `delegateToDevo`
5. agent `caio` -> `delegateToCaio`
6. agent `scout` -> `spawnScout`
7. Ausfuehrung mit `Promise.allSettled()` (nicht `Promise.all`) fuer Partial-Result-Sicherheit.
8. Ergebnisse in ein einheitliches Rueckgabeformat normalisieren.
9. Bei Teilfehlern:
10. erfolgreiche Ergebnisse behalten
11. Fehlertexte gesammelt zurueckgeben
12. Tool-Result fuer CHAPO so formulieren, dass LLM die naechste Aktion entscheiden kann.

**Tests/Checks:**

1. Simulierter Fall: eine Delegation failt, andere succeeden -> beide im Ergebnis sichtbar.
2. Keine uncaught rejection.

**Exit-Kriterien:**

1. Parallelisierung liefert stabile Teilergebnisse.
2. CHAPO-Loop bleibt bei Teilfehlern arbeitsfaehig.

## WP-14: Telegram Client + Webhook Route

**Ziel:** Telegram als externer Eingangskanal nutzbar machen.

**Dateien (neu):**

1. `apps/api/src/external/telegram.ts`
2. `apps/api/src/routes/external.ts`

**Dateien (bestehend):**

1. `apps/api/src/db/schedulerQueries.ts`
2. `apps/api/src/workflow/commands/dispatcher.ts` (nur falls helper noetig)

**Implementierungsschritte Telegram Client (`external/telegram.ts`):**

1. `sendTelegramMessage(chatId, text)` implementieren via `fetch` auf Bot API.
2. Bei fehlendem `config.telegramBotToken` kontrolliert abbrechen + log.
3. Telegram Laengenlimit beachten (4000 Zeichen cutoff).
4. Erstversuch mit Markdown parse mode.
5. Bei Fehler retry ohne parse mode.
6. `isAllowedChat(chatId)` gegen `config.telegramAllowedChatId` implementieren.
7. `TelegramUpdate` Interface fuer relevante Felder definieren.

**Implementierungsschritte Route (`routes/external.ts`):**

1. Fastify plugin `externalRoutes` erstellen.
2. Endpoint `POST /telegram/webhook` anlegen.
3. Ungueltige/irrelevante Updates sofort mit 200 quittieren.
4. Authorisierung ueber `isAllowedChat` (unerlaubte chat IDs ignorieren, 200 zurueck).
5. Externe Session aufloesen:
6. vorhandene Session laden oder neu erzeugen (`external_sessions`).
7. Eingehende Message einem Command zuordnen:
8. Wenn offene Approval vorhanden und Text = ja/nein -> `user_approval_decided`.
9. Wenn offene Frage vorhanden -> `user_question_answered`.
10. Sonst `user_request`.
11. Dispatch ueber `commandDispatcher.dispatch(...)` mit no-op `joinSession`.
12. Fire-and-forget Verarbeitung:
13. Route antwortet sofort `200 { ok: true }`
14. Verarbeitung in async branch.

**DB Helper Erweiterungen (`schedulerQueries.ts`):**

1. `getExternalSessionBySessionId(sessionId)` hinzufuegen.
2. `getOrCreateExternalSession(platform, externalUserId, externalChatId)` hinzufuegen.

**Tests/Checks:**

1. `POST /api/telegram/webhook` antwortet immer mit 200.
2. Unauthorisierte Chats starten keinen Workflow.
3. Autorisierte Chat-Nachricht startet Workflow-Dispatch.

**Exit-Kriterien:**

1. Telegram Input ist stabil und blockiert die API nicht.
2. Session-Mapping Telegram <-> Devai funktioniert.

## WP-15: Server Routing + Auth-Ausnahme fuer Telegram

**Ziel:** External route ist registriert und nicht von JWT auth blockiert.

**Datei:**

1. `apps/api/src/server.ts`

**Implementierungsschritte:**

1. `externalRoutes` importieren.
2. Route mit Prefix `/api` registrieren.
3. Auth preHandler erweitern:
4. `/api/telegram` explizit von JWT-Pruefung ausnehmen.
5. Sonstige API-Auth-Regeln unveraendert lassen.

**Tests/Checks:**

1. Telegram webhook ohne JWT erreichbar.
2. Andere API-Routen bleiben geschuetzt.

**Exit-Kriterien:**

1. Keine ungewollte Auth-Aufweichung.
2. External route erreichbar und aktiv.

## WP-16: ExternalOutputProjection

**Ziel:** Workflow-Ausgaben werden fuer externe Sessions nach Telegram gespiegelt.

**Datei (neu):**

1. `apps/api/src/workflow/projections/externalOutputProjection.ts`

**Dateien (bestehend):**

1. `apps/api/src/workflow/events/catalog.ts`
2. `apps/api/src/db/schedulerQueries.ts`
3. `apps/api/src/external/telegram.ts`

**Implementierungsschritte:**

1. Projection Interface implementieren (`name`, `handle(event)`).
2. Nur folgende Eventtypen behandeln:
3. `workflow.completed`
4. `gate.question.queued`
5. `gate.approval.queued`
6. Session-Mapping ueber `getExternalSessionBySessionId`.
7. Wenn keine externe Session -> no-op.
8. Telegram Versand:
9. Completion -> Antworttext
10. Question -> klarer Frage-Prefix
11. Approval -> "ja/nein" Handlungsanweisung
12. Fehler beim Versand nur loggen, nicht werfen.

**Tests/Checks:**

1. Projection reagiert nur auf definierte Eventtypen.
2. Keine Regression in bestehender Stream-/Markdown-/Audit-Projection.

**Exit-Kriterien:**

1. Externe Sessions erhalten Antworten, Fragen und Approval-Prompts.
2. Event-Pipeline bleibt robust bei Telegram-Ausfall.

## WP-17: Projection Registrierung

**Ziel:** ExternalOutputProjection wird beim Start registriert.

**Datei:**

1. `apps/api/src/workflow/projections/index.ts`

**Implementierungsschritte:**

1. `ExternalOutputProjection` importieren.
2. In `registerProjections()` registrieren.
3. Reihenfolge konsistent halten (state -> stream -> external -> markdown -> audit empfohlen).

**Tests/Checks:**

1. `workflowBus.getProjectionNames()` enthaelt `external-output`.
2. Keine doppelte Registrierung.

**Exit-Kriterien:**

1. Projection ist aktiv ohne Seiteneffekte auf bestehende Clients.

## WP-18: Scheduler Notifications nach Telegram verdrahten

**Ziel:** Scheduler meldet Ergebnisse und Fehler an Telegram.

**Dateien:**

1. `apps/api/src/server.ts`
2. optional: `apps/api/src/db/schedulerQueries.ts` (channel resolution helper)

**Implementierungsschritte:**

1. Placeholder-Notifier in `schedulerService.configure(...)` ersetzen.
2. Notification-Logik:
3. Wenn `targetChannel` gesetzt -> dahin senden.
4. Sonst Default Channel aus DB ermitteln (`getDefaultNotificationChannel`).
5. Versand ueber `sendTelegramMessage`.
6. Fehler robust loggen; Scheduler-Ausfuehrung darf nicht crashen.

**Tests/Checks:**

1. Job mit `notification_channel` sendet an gesetzten Kanal.
2. Job ohne Kanal nutzt Default Channel.
3. Ohne Kanal/Default kein Crash.

**Exit-Kriterien:**

1. Scheduler Outputs landen konsistent auf Telegram.

## WP-19: Scheduler Job Executor nach `processRequest()` verdrahten

**Ziel:** Scheduler feuert echte CHAPO-Workflows statt Placeholder-Text.

**Datei:**

1. `apps/api/src/server.ts`

**Implementierungsschritte:**

1. Placeholder-Executor durch echten Call ersetzen:
2. `processRequest(sessionId, instruction, [], null, sendEventNoop)`
3. Session-ID-Schema fuer Scheduler einfuehren:
4. `scheduler-${jobId}-${Date.now()}`
5. Rueckgabewert fuer Scheduler als string normalisieren.
6. Fehler sauber nach oben werfen, damit Scheduler Failure-Handling greift.

**Tests/Checks:**

1. Scheduler-Job erzeugt echte Agent-Historie.
2. Rueckgabe fliesst in `last_result`.
3. Fehlerpfade triggern `handleJobFailure`.

**Exit-Kriterien:**

1. Scheduler nutzt exakt denselben Workflow-Kern wie Web/Telegram.

## WP-20: Scheduler Error Context Injection

**Ziel:** CHAPO bekommt aktuelle Scheduler-Fehler als Kontext zur besseren Problemloesung.

**Dateien:**

1. `apps/api/src/scheduler/schedulerService.ts`
2. `apps/api/src/agents/systemContext.ts`

**Implementierungsschritte:**

1. In `schedulerService` oeffentliche accessor API bereitstellen:
2. `getSchedulerErrors()` (letzte max 20 Fehler)
3. Ringbuffer-Limit strikt halten.
4. In `systemContext` Fehler abfragen und als eigener Block anfuegen:
5. nur wenn mindestens ein Fehler vorhanden
6. max letzte 5 Fehler in Kontexttext aufnehmen
7. Format kurz und maschinenlesbar halten.

**Tests/Checks:**

1. Bei leeren Fehlern kein Kontextblock.
2. Bei Fehlern erscheint Abschnitt `Letzte Scheduler-Fehler`.
3. Max 5 Eintraege im Context Block.

**Exit-Kriterien:**

1. CHAPO kann Scheduler-Stoerungen proaktiv sehen und adressieren.

## 6. Reihenfolge, Milestones und Commits

## Milestone M1: Orchestration fertig

1. WP-10
2. WP-11
3. WP-12
4. WP-13

**Commit-Empfehlung:**

1. `feat(chapo): add caio delegation and parallel delegation support`

## Milestone M2: Telegram Kanal live (Input + Output)

1. WP-14
2. WP-15
3. WP-16
4. WP-17

**Commit-Empfehlung:**

1. `feat(external): add telegram webhook, client, and external output projection`

## Milestone M3: Scheduler End-to-End integriert

1. WP-18
2. WP-19
3. WP-20

**Commit-Empfehlung:**

1. `feat(scheduler): wire execution and notifications through core workflow`

## 7. Detaillierte Teststrategie

## 7.1 Statische Checks

1. `cd /opt/Klyde/projects/Devai && npx tsc --noEmit`
2. `cd /opt/Klyde/projects/Devai && npx vitest run`

## 7.2 Zielgerichtete technische Checks

1. `rg -n "delegateToCaio|delegateParallel" apps/api/src/agents`
2. `rg -n "externalRoutes|/api/telegram" apps/api/src/server.ts apps/api/src/routes`
3. `rg -n "ExternalOutputProjection|external-output" apps/api/src/workflow/projections`
4. `rg -n "processRequest\\(|sendTelegramMessage\\(" apps/api/src/server.ts`

## 7.3 E2E Smoke Matrix

1. Telegram -> user request -> CHAPO Antwort kommt in Telegram an.
2. Telegram -> Approval-Prompt -> Antwort "ja"/"nein" steuert Workflow korrekt.
3. Web UI -> "Erstelle Ticket" -> CAIO TaskForge path.
4. Web UI -> "Sende Email" -> CAIO email path.
5. Web UI -> "Fix bug und erstelle Ticket" -> Parallel Delegation Devo+Caio.
6. Scheduler Job -> `processRequest()` execution -> Ergebnis als Telegram Notification.
7. Scheduler Fehler 3x -> Auto-disable + Notification + Fehler im CHAPO Context sichtbar.

## 8. Risiken und Gegenmassnahmen

1. **Risiko:** Telegram update format variiert (z. B. edit_message, callback_query).
2. **Gegenmassnahme:** defensives parsing, nur text message verarbeiten, sonst 200/no-op.

3. **Risiko:** Parallel delegation erzeugt unklare Ergebnisaggregation.
4. **Gegenmassnahme:** einheitliches result schema + `Promise.allSettled()` + klare summary.

5. **Risiko:** External projection blockiert event pipeline bei Telegram API Fehlern.
6. **Gegenmassnahme:** projection errors nur loggen, nie throw.

7. **Risiko:** Auth-Ausnahme fuer Telegram wird zu breit.
8. **Gegenmassnahme:** nur Prefix `/api/telegram` whitelisten, restliche `/api` strikt auth.

9. **Risiko:** Scheduler erzeugt viele neue Sessions.
10. **Gegenmassnahme:** Session naming pattern und spaeteres retention cleanup separat einplanen.

## 9. Rollback-Strategie

1. Feature rollback granular pro Milestone ueber git revert auf jeweilige Commit-Grenze.
2. Bei Telegram Problemen:
3. `externalRoutes` Registrierung entfernen.
4. `ExternalOutputProjection` deregistrieren.
5. Scheduler kann weiter lokal laufen ohne externen Kanal.
6. Bei Orchestration Problemen:
7. `delegateParallel` temporar deaktivieren (Tool im CHAPO entfernen).
8. `delegateToCaio` kann getrennt von Parallelisierung bestehen bleiben.

## 10. Definition of Done (Finale Abnahme)

Done ist erreicht, wenn alle Punkte erfuellt sind:

1. CHAPO hat `delegateToCaio` und `delegateParallel` produktiv aktiv.
2. CHAPO prompt routing ist konsistent fuer DEVO/CAIO/SCOUT.
3. Telegram webhook verarbeitet autorisierte Nachrichten robust.
4. Externe Antworten/Fragen/Approval-Prompts werden nach Telegram ausgeliefert.
5. Scheduler fuehrt Jobs ueber `processRequest()` aus.
6. Scheduler Notifications gehen nach Telegram (job channel oder default channel).
7. Scheduler Fehler erscheinen im CHAPO System Context.
8. `tsc` und `vitest` laufen ohne neue Regressionen.
9. E2E Smoke Matrix ist komplett gruen.

## 11. Bezug zu anderen Plaenen

1. Der Event-Pipeline-Plan bleibt Architekturgrundlage; dieses Dokument setzt nur den benoetigten Teil fuer externe Outputs um.
2. Agent-Dokumentationsplan bleibt abgeschlossen und unveraendert.
3. Userfile-Plan bleibt separat priorisiert und blockiert diese Umsetzung nicht.
