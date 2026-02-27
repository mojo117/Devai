# Memory
## User
- StockPulse Master-Aktienliste: /root/home/projects/Invest/stocks/stockpulse-master.csv mit 469 Aktien. TypeScript Scanner stockpulse-daily.ts scannt 10 Aktien/Tag rotierend. Aktueller State: Round 1,…
- Archiv-Ordner erstellt unter /root/home/orga/Archiv/ — für alte/obsolete Listen und Dokumente. Enthält jetzt: TODO-old.md (zusammengeführte To-Do-Liste).
- TODO: TTS-Service https://audio.z.ai/ ausprobieren (AI Text-to-Speech mit Voice-Cloning)
- TTS-Service zum Ausprobieren: https://audio.z.ai/ - Text-to-Speech Tool
- Organisations-Dateien liegen unter /root/home/orga/: TO-DO.md (To-Do Liste), WATCHLIST.md (Serien/Filme), KITA-LISTE.md (Kitas für U3-Betreuung)
- Reflexion zur eigenen Existenz (Descartes 'Ich denke, also bin ich'): Als Chapo bin ich kein klassisches, gedächtnisloses Sprachmodell. Durch mein Workspace-Memory, Notizen und vergangene Sessions ha…
- Neue Investment-Ideen kommen in /root/home/projects/Invest/INVESTMENT_IDEAS.md. Neue Business-Ideen kommen in /root/home/projects/Invest/BUSINESS_IDEAS.md. Diese Themen sollen nicht mehr in die allge…
- Always use todoWrite for multi-part requests (2+ independent parts). Track each part before starting work. Update status as parts complete.
- User: Jörn — Sprache: Deutsch (Standard), Timezone: Europe/Berlin (CET/CEST).
## Projekte
- The StockPulse scanner utilizes Firecrawl Agents to extract Price-to-Earnings (KGV) and Price-to-Book (KUV) ratios from boerse.de.
- Aktuelle Aufgaben in der Task-Liste beinhalten die Recherche nach Google MCP, die Einrichtung von Trello für DevAI sowie die Evaluation von Snov Clinic Software.
- Master stock list (data/master/stocks.csv) contains 469 companies and is updated daily with new rows for each scan run.
- A reminder is scheduled for Sunday (01.03.) to revisit and improve the master list update logic and data storage format.
- StockPulse project structure refactored into a 'One Source of Truth' model with code in src/, data in data/, and web content in web/.
## Workflows
- Der Scanner wurde aktualisiert, um Ergebnisse direkt als neue Zeilen in die Master-Liste zu schreiben.
- Die drei City-Show HTML-Dateien wurden aus dem Projektroot entfernt und in den Ordner web/ verschoben.
- Das Invest-Projekt wurde umstrukturiert: Code nach src/, Daten nach data/, HTML-Dateien nach web/.
- Ein automatisierter Daily-Job wurde eingerichtet, der um 08:00 Uhr 10 Aktien scannt und Telegram-Benachrichtigungen sendet.
- Ein Health-Check-Job wurde eingerichtet, der um 09:00 Uhr läuft und Telegram-Verbesserungsvorschläge bei Problemen sendet.
- Die StockPulse-Doppelstruktur wurde bereinigt, indem der Ordner unter Invest/ entfernt wurde.
- Two automated cron jobs are active: daily StockPulse scan at 08:00 and health check at 09:00, both reporting results via Telegram.
- Legacy Python scripts (boerse_de.py, etc.) have been deleted in favor of a simplified TypeScript-only scanner script (daily.ts).
- The Python script located in /root/home/projects/Invest/stocks/ (stockpulse-daily.ts) is the active scanner currently in Round 1, managing 469 stocks.
- TO-DO Liste: /root/home/orga/TO-DO.md — wenn der User 'To-Do' erwähnt, diese Datei prüfen.
- Das Tool show_in_preview benötigt die userfileId aus dem Dateikopf, um Dokumente anzuzeigen; fehlende IDs verhindern die Anzeige und können durch erneutes Hochladen der Datei gelöst werden.
- Die Nutzung des Tools 'show_in_preview' erfordert die Eingabe der exakten 'userfileId' (z.B. 'VpHaU2_av8Z-fheCdTL8z') aus der Dateikopfzeile, nicht nur den Dateinamen, um die Datei im UI anzuzeigen.
- Die Projektstruktur wurde auf die 'One Source of Truth' Architektur umgestellt (Code in src/, Daten in data/, Web in web/).
- Die Master-Liste soll zukünftig durch neue Zeilen pro Scan-Datum anstatt durch neue Spalten aktualisiert werden.
- Bei der Erstellung von City-Shows (z.B. Darmstadt, Frankfurt) werden standardisierte Muster verwendet: Lokale Highlights integrieren und ein konsistentes Theme setzen (z.B. Dunkel/Red für Darmstadt, …
- Zusammenfassende Notizen zum SchuWa IT-Support wurden unter '/root/home/orga/notiz/rt/support/laptop/arbeit.md' archiviert.
- Eine 'Hello Frankfurt' Webseite wurde erstellt mit einem Finanz-Thema (Gold/Dunkelblau) und lokalen Sehenswürdigkeiten wie Main Tower, Römer, Städel Museum und Goethe.
- Der firecrawl-browser Skill wurde erfolgreich erstellt; der API-Key ist bereits auf dem Server hinterlegt und von CHAPO verwendet.
- The stock scanning logic rotates through 469 stocks, scanning 10 companies per day starting at Round 1, Index 2.
- The core crawler uses the Firecrawl REST API directly at the /v2/agent endpoint with polling logic.
- Duplicate StockPulse folders were identified and merged into a single main project structure at /root/home/projects/StockPulse/
- Duplicate StockPulse folders under /root/home/projects/ were successfully merged into a single main project structure.
- Um Dateien im Preview-Tool anzuzeigen, ist die Angabe der spezifischen 'userfileId' (z. B. uf_abc123) aus dem Datei-Header erforderlich, nicht nur der Dateiname.
- Das Design der hello-frankfurt.html Datei erfordert einen weißen Hintergrund und dunkle Texte für eine verbesserte Lesbarkeit.
- Für Scheduler/Reminder/Cronjobs IMMER scheduler_list nutzen, NICHT System-Cron. DevAI nutzt internen croner-Scheduler, CHAPO verwaltet alle scheduled jobs.
- Es wurde ein 'Hello Frankfurt' HTML-Dokument erstellt, das auf einem dunklen Blau-Gold-Design (Finanzmetropole-Vibe) basiert und lokale Highlights wie den Main Tower und den Römer darstellt.
- The user creates city landing pages (e.g., hello-darmstadt.html, hello-frankfurt.html) using dark themes with specific local landmarks (TU Darmstadt, Skyline, Schloss) and specific color accents, whi…
- StockPulse generates HTML reports using Tailwind CSS, stored in the data/reports/ directory.
- Eine 'Hello Darmstadt' Webseite wurde erstellt, die lokale Highlights wie Schloss, TU Darmstadt, Mathildenhöhe, ESA, Herrngarten, Staatstheater und Jazz-Institut darstellt.
- StockPulse Projektordner müssen zusammengeführt werden.
- Security requirement: Auth tokens must never be passed into the iframe environment.
## Termine & Events

- [2026-02-27T16:04] "was meinst du mit todo.md there should only be to-do.md" -> Du hast absolut recht, Entschuldigung für die Verwirrung! Es gibt nur **eine Datei**: `/root/home/orga/TO-DO.md` (mit B…
- [2026-02-27T12:20] "Lass uns meine To-dos besser strukturieren" -> Gute Idee! Die aktuelle TO-DO.md hat **38 offene Tasks** und ist ziemlich unübersichtlich. Was genau möchtest du verbess (Tools: fs_…
- [2026-02-27T14:58] "Ja" -> ## ✅ **Fertig!**

### Gelöscht:
- `data/master/` (leerer Ordner)

### Bereits vorher gelöscht:
- `data/daily/round-1-dai (Tools: scheduler_list, scheduler_update, fs_delete…
- [2026-02-27T15:44] "Ja" -> ## 📊 **SCAN ERGEBNIS** ### ✅ Mit Daten (7 Aktien): ``` 1U1:  KGV 18.44, KUV 0.96 UUU:  KGV 55.00, KUV 0.73 APM:  KGV 32 (Tools: bash_execute, fs_readFile, exec_session_sta…
- [2026-02-27T15:59] "Das sind alles Aktien deutscher Unternehmen da ist nichts mit ausländischen Aktien guck bei denen bei denen es nicht geh" ->  (Tools: skill_firecrawl_scrape, fs_readFile, fs_edit,…
- [2026-02-27T15:33] Bash: env | grep -i fire; echo "---"; printenv | grep -i fire
- [2026-02-27T15:44] "Füge ein neues Todo für morgen zu: Ink - Pitch -> Solution und Vorstellung für IT-Unternehmen Erstentwurf" -> ## ✅ **Erledigt!**

**Reminder erstellt:**
| Feld | Wert |
|------|--…
- [2026-02-27T11:28] "teszt" -> Jo, ich bin noch da! 👍

Soll ich mit **Phase 1 (CSV-Logik reparieren)** weitermachen, oder war das "test" nur ein Check
- [2026-02-27T15:36] Bash: cat > /tmp/fix-csv.ts << 'EOF'
import * as fs from 'fs';

const path = '/root/ho
- [2026-02-27T12:40] Bash: grep -r "FIRECRAWL" /opt/Devai/.env* /opt/Devai/apps/backend/.env* 2>/dev/null |
- [2026-02-27T11:37] "scanne die 22 aktien neu. Dann gucke dir das hier an: | Firecrawl API | ✅ OK | 3/3 erfolgreich heute |es sollten 10 tägl" -> **Gute Neuigkeiten!** 🎉

Heute wurden **10 Aktien ges…
- [2026-02-27T12:35] "Weiv eil stocks sind inder lsite aus Option C?" -> **10 Aktien** sind in `stocks/round-1/round-1-daily.csv`:

```
1. 02P
2. 1AST
3. 1U1
4. 3330
5. 3U
6. A7A
7. AAC
8. AAT
- [2026-02-27T15:35] Bash: cat > /root/home/projects/Invest/README.md << 'EOF'
# StockPulse Daily Scanner
- [2026-02-27T15:29] Bash: cat > /tmp/restructure-master.ts << 'EOF'
import * as fs from 'fs';
import * as
- [2026-02-27T11:32] "Ja reapriere die csv loik" -> ## ✅ **ERGEBNIS: CSV-LOGIK FUNKTIONIERT!**

Ich habe den Scanner getestet und die Diagnose ist:

### **Diagnose**
| Komp (Tools: fs_readFile, fs_glob…
- [2026-02-27T11:31] Bash: grep -E "^(02P|1AST|1COV|BMW|SAP)," /root/home/projects/Invest/stocks/master-his
- [2026-02-27T14:57] Datei geloescht: data/master
- [2026-02-27T15:36] "Also eigentlich braucht es nicht jedenscan eine neue Spalte. Eine Spalte KGV scan  ergenbi 1 eine Spalte KUV Scanergebni" -> ## ✅ **FERTIG!**

Die CSV hat jetzt das korrekte Round…
- [2026-02-27T08:10] "Option | Aktion | |--------|--------| | "Repariere den Scanner"" -> ## ❌ **BUGS IDENTIFIZIERT!** --- ### 🐛 **PROBLEM #1: CSV-Update-Logik ist kaputt** ```csv Header: Ticker,URL,P…
- [2026-02-27T15:29] Bash: cd /root/home/projects/Invest/stocks && cp stockpulse-master.csv stockpulse-mast
- [2026-02-27T12:20] "Welche inhalte haben die zwei verschiedenen Dateien jeweils?" -> ## 📊 **DATEI-INHALTE - KARTELLIERT**

Jetzt sehe ich das Chaos! Es gibt **3 verschiedene CSV-Dateien** mit unters…
- [2026-02-27T12:42] "Nein, Alles soll in der fucking Master Liste sein jeden tag 10 aktien scannen und mit dem Scann die masrterlsite aktusal" -> ## ✅ **ERLEDIGT!** 

Zusammenfassung:

| Aufgabe | Sta…
- [2026-02-27T11:03] Datei bearbeitet: stocks/stockpulse-daily.ts
- [2026-02-27T12:59] Datei geloescht: stocks/round-1
- [2026-02-27T15:33] Bash: ls -la /root/.env* /root/home/.env* 2>/dev/null; cat /root/.env 2>/dev/null | gr
- [2026-02-27T15:31] Bash: grep -r "FIRECRAWL" /root/home/projects/Invest/ 2>/dev/null | head -5
- [2026-02-27T15:30] Bash: cat > /root/home/projects/Invest/stocks/stockpulse-daily.ts << 'ENDOFSCRIPT'
#!/
- [2026-02-27T06:38] "Nein lass und beim status quo bleiben: Füge: das hier als todo hinzu, dann lass uns die todo liste neu sortieren dafür m" -> ## ❌ Datei nicht gefunden! Ich habe gesucht, aber:
- `…
- [2026-02-27T14:26] "Verschieben die fritz box erinnerung auf übernächsten freitag" -> ## ✅ **Erledigt!**

Die Fritz!Box-Erinnerung wurde verschoben:

| Feld | Neu |
|------|-----|
| **Datum** | Freit…
- [2026-02-27T10:48] "Ok repariere jetzt den Scanner

Zusätzliche Info: Ja" -> ## 🔧 **REPARATUR GESTARTET!**

Ich lese zuerst den aktuellen Code, dann repariere ich alle 4 Bugs.

**Dauer:** ca. 5-10
- [2026-02-27T09:01] "Heartbeat-Check. Pruefe:

1. Chat-Historie — Gibt es kuerzliche Sessions mit unbeantwortet gebliebenen
   Fragen, abgebr" -> **Heartbeat-Check Ergebnisse:**

---

### 🔴 **1. Chat…
- [2026-02-27T10:54] "recherchiere in der history und in den struktiren machen einen plan wie das stockpulse skipt erledigt wird: ### 📋 TODO-" -> ## 📊 StockPulse Analyse & Plan

Ich habe den aktuelle…
- [2026-02-27T06:41] "Du musst die datei nicht finden füge zur to-do liste nur das toddo. Architect/editor plan umsetzen mit dem dateipfad hin" -> ## ✅ Fertig! Neues Todo hinzugefügt + Liste neu sortie…
## Erkenntnisse
- Das aktuelle To-Do-System ist eine einfache Markdown-Datei (TODO.md) ohne vorhandenem Obsidian Vault.
