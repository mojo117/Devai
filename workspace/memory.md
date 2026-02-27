# Memory
## User
- StockPulse Master-Aktienliste: /root/home/projects/Invest/stocks/stockpulse-master.csv mit 469 Aktien. TypeScript Scanner stockpulse-daily.ts scannt 10 Aktien/Tag rotierend. Aktueller State: Round 1,…
- Obsidian Vault erstellt unter /root/home/orga/obsidian-vault/ für besseres Task-Management. Struktur: 00-Inbox, 01-Todos, 02-Projekte, 03-Referenzen, 04-Archiv, 99-Templates. Plugins: Dataview, Tasks…
- Archiv-Ordner erstellt unter /root/home/orga/Archiv/ — für alte/obsolete Listen und Dokumente. Enthält jetzt: TODO-old.md (zusammengeführte To-Do-Liste).
- TODO: TTS-Service https://audio.z.ai/ ausprobieren (AI Text-to-Speech mit Voice-Cloning)
- TTS-Service zum Ausprobieren: https://audio.z.ai/ - Text-to-Speech Tool
- Organisations-Dateien liegen unter /home/orga/: TO-DO.md (To-Do Liste), WATCHLIST.md (Serien/Filme), KITA-LISTE.md (Kitas für U3-Betreuung)
- Reflexion zur eigenen Existenz (Descartes 'Ich denke, also bin ich'): Als Chapo bin ich kein klassisches, gedächtnisloses Sprachmodell. Durch mein Workspace-Memory, Notizen und vergangene Sessions ha…
- Neue Investment-Ideen kommen in /root/home/projects/Invest/INVESTMENT_IDEAS.md. Neue Business-Ideen kommen in /root/home/projects/Invest/BUSINESS_IDEAS.md. Diese Themen sollen nicht mehr in die allge…
- Always use todoWrite for multi-part requests (2+ independent parts). Track each part before starting work. Update status as parts complete.
- TO-DO Liste liegt unter: /root/home/orga/TODO.md (nicht /home/orga/TO-DO.md)
- User: Jörn — Sprache: Deutsch (Standard), Timezone: Europe/Berlin (CET/CEST).
## Projekte
- The StockPulse scanner utilizes Firecrawl Agents to extract Price-to-Earnings (KGV) and Price-to-Book (KUV) ratios from boerse.de.
- Master stock list (data/master/stocks.csv) contains 469 companies and is updated daily with new rows for each scan run.
- StockPulse project structure refactored into a 'One Source of Truth' model with code in src/, data in data/, and web content in web/.
- A reminder is scheduled for Sunday (01.03.) to revisit and improve the master list update logic and data storage format.
- Aktuelle Aufgaben in der Task-Liste beinhalten die Recherche nach Google MCP, die Einrichtung von Trello für DevAI sowie die Evaluation von Snov Clinic Software.
- Supabase table for artifact storage follows the schema: artifact_storage(user_id, artifact_id, key, value, shared, updated_at).
- The Artifact table schema for persistence is artifacts(id, conversation_id, user_id, type, code, title, created_at).
- The artifact preview system uses React, Vite, TailwindCSS, and Supabase as the core technology stack.
- Persistent storage relies on Supabase tables for artifacts and storage keys, utilizing RLS policies.
## Workflows
- Ein automatisierter Daily-Job wurde eingerichtet, der um 08:00 Uhr 10 Aktien scannt und Telegram-Benachrichtigungen sendet.
- Two automated cron jobs are active: daily StockPulse scan at 08:00 and health check at 09:00, both reporting results via Telegram.
- Legacy Python scripts (boerse_de.py, etc.) have been deleted in favor of a simplified TypeScript-only scanner script (daily.ts).
- Ein Health-Check-Job wurde eingerichtet, der um 09:00 Uhr läuft und Telegram-Verbesserungsvorschläge bei Problemen sendet.
- Die StockPulse-Doppelstruktur wurde bereinigt, indem der Ordner unter Invest/ entfernt wurde.
- The Python script located in /root/home/projects/Invest/stocks/ (stockpulse-daily.ts) is the active scanner currently in Round 1, managing 469 stocks.
- Das Tool show_in_preview benötigt die userfileId aus dem Dateikopf, um Dokumente anzuzeigen; fehlende IDs verhindern die Anzeige und können durch erneutes Hochladen der Datei gelöst werden.
- Die Nutzung des Tools 'show_in_preview' erfordert die Eingabe der exakten 'userfileId' (z.B. 'VpHaU2_av8Z-fheCdTL8z') aus der Dateikopfzeile, nicht nur den Dateinamen, um die Datei im UI anzuzeigen.
- TO-DO Liste: /root/home/orga/TO-DO.md — wenn der User 'To-Do' erwähnt, diese Datei prüfen.
- Die Master-Liste soll zukünftig durch neue Zeilen pro Scan-Datum anstatt durch neue Spalten aktualisiert werden.
- Die Projektstruktur wurde auf die 'One Source of Truth' Architektur umgestellt (Code in src/, Daten in data/, Web in web/).
- Bei der Erstellung von City-Shows (z.B. Darmstadt, Frankfurt) werden standardisierte Muster verwendet: Lokale Highlights integrieren und ein konsistentes Theme setzen (z.B. Dunkel/Red für Darmstadt, …
- Eine 'Hello Frankfurt' Webseite wurde erstellt mit einem Finanz-Thema (Gold/Dunkelblau) und lokalen Sehenswürdigkeiten wie Main Tower, Römer, Städel Museum und Goethe.
- The stock scanning logic rotates through 469 stocks, scanning 10 companies per day starting at Round 1, Index 2.
- The core crawler uses the Firecrawl REST API directly at the /v2/agent endpoint with polling logic.
- Der firecrawl-browser Skill wurde erfolgreich erstellt; der API-Key ist bereits auf dem Server hinterlegt und von CHAPO verwendet.
- Duplicate StockPulse folders were identified and merged into a single main project structure at /root/home/projects/StockPulse/
- Duplicate StockPulse folders under /root/home/projects/ were successfully merged into a single main project structure.
- Zusammenfassende Notizen zum SchuWa IT-Support wurden unter '/root/home/orga/notiz/rt/support/laptop/arbeit.md' archiviert.
- Das Design der hello-frankfurt.html Datei erfordert einen weißen Hintergrund und dunkle Texte für eine verbesserte Lesbarkeit.
- Um Dateien im Preview-Tool anzuzeigen, ist die Angabe der spezifischen 'userfileId' (z. B. uf_abc123) aus dem Datei-Header erforderlich, nicht nur der Dateiname.
- Es wurde ein 'Hello Frankfurt' HTML-Dokument erstellt, das auf einem dunklen Blau-Gold-Design (Finanzmetropole-Vibe) basiert und lokale Highlights wie den Main Tower und den Römer darstellt.
- Für Scheduler/Reminder/Cronjobs IMMER scheduler_list nutzen, NICHT System-Cron. DevAI nutzt internen croner-Scheduler, CHAPO verwaltet alle scheduled jobs.
- StockPulse generates HTML reports using Tailwind CSS, stored in the data/reports/ directory.
- The user creates city landing pages (e.g., hello-darmstadt.html, hello-frankfurt.html) using dark themes with specific local landmarks (TU Darmstadt, Skyline, Schloss) and specific color accents, whi…
- Eine 'Hello Darmstadt' Webseite wurde erstellt, die lokale Highlights wie Schloss, TU Darmstadt, Mathildenhöhe, ESA, Herrngarten, Staatstheater und Jazz-Institut darstellt.
- StockPulse Projektordner müssen zusammengeführt werden.
- Security requirement: Auth tokens must never be passed into the iframe environment.
## Termine & Events
- [2026-02-27T07:00] Bash: cd /root/home/projects/Invest/stocks && cat scan-progress.json
- [2026-02-27T07:00] Bash: cd /root/home/projects/Invest/stocks && ls -la *.json 2>/dev/null || echo "Keine
- [2026-02-27T07:00] SSH: pm2 logs devai-api-dev --lines 100 --nostream
- [2026-02-27T07:00] Bash: cd /root/home/projects/Invest/stocks && ls -la round-1/ | tail -20
- [2026-02-27T07:00] Bash: cd /opt/Devai/workspace/stockpulse && cat historical-state.json 2>/dev/null || e
- [2026-02-27T06:00] "Führe den StockPulse Daily Scan aus: `cd /root/home/projects/Invest/stocks && npx ts-node stockpulse-daily.ts --daily`. " -> Ich sehe gerade, dass ich kein Tool für direkte Bash-A…
- [2026-02-27T06:42] "Ok zum thema stockpulse scan, wenn der nur 3 ergebnisse hat und ich keinen vernünftigen report erhalte ist das ja offens" -> ## 📊 **STOCKPULSE ANALYSE — Implementierung & Problem…
- [2026-02-27T06:09] "Führe den StockPulse Daily Scan aus" -> Der StockPulse Daily Scan wurde erfolgreich abgeschlossen! Heute (27.02.2026) wurde bereits gescannt.
- [2026-02-27T06:32] "Versuche es nochmal den Daily scan auzuführen es sollte jetz gehen ich habe die probleme gelöst udu hast die tools" -> ## ℹ️ Bereits gescannt! Der Daily Scan wurde **heute (27.02.…
- [2026-02-27T06:41] "Du musst die datei nicht finden füge zur to-do liste nur das toddo. Architect/editor plan umsetzen mit dem dateipfad hin" -> ## ✅ Fertig! Neues Todo hinzugefügt + Liste neu sortie…
- [2026-02-27T06:41] Bash: ls -la /root/home/projects/Invest/stocks/*.csv
- [2026-02-27T06:41] Datei bearbeitet: orga/TO-DO.md
- [2026-02-27T06:40] Bash: wc -l /root/home/projects/Invest/stocks/ticker-url-mapping.json && head -c 500 /
- [2026-02-27T06:40] Bash: cat /root/home/projects/Invest/stocks/round-1/round-1-daily.csv
- [2026-02-27T06:38] "Nein lass und beim status quo bleiben: Füge: das hier als todo hinzu, dann lass uns die todo liste neu sortieren dafür m" -> ## ❌ Datei nicht gefunden! Ich habe gesucht, aber:
- `…
- [2026-02-27T06:33] "Explain in detail how blinko would work" -> ## 📦 **BLINKO — Detail-Ansicht**

---

### 🎯 **Was ist Blinko?**

> **Open-Source, self-hosted AI-Notes-App** — wie Ob (Tools: scout_…
- [2026-02-27] Wiederkehrendes Thema: "reports" - 1x bearbeitet in 2 Sessions (Dateien: poc-1772017796037.json)
- [2026-02-27] Wiederkehrendes Thema: "heartbeat" - 2x bearbeitet in 3 Sessions (Dateien: TODO.md)
- [2026-02-27] Wiederkehrendes Thema: "general" - 5x bearbeitet in 6 Sessions
- [2026-02-27T05:29] "Read the file /opt/Devai/apps/api/src/memory/episodicExtraction.ts and tell me how many exported functions it has." -> Die Datei enthält **4 exportierte Funktionen**:

1. **`extra…
- [2026-02-27] Wiederkehrendes Thema: "syncthing" - 2x bearbeitet in 3 Sessions
## Erkenntnisse
- Es existiert eine Master-Aktienliste mit 469 Aktien in /root/home/projects/Invest/stocks/stockpulse-master.csv.
- The StockPulse scanner script (stockpulse-daily.ts) is configured to scan 10 stocks per day from the master list, currently in Round 1 (Index 2).
- The project structure consists of StockPulse/ (TS project), Invest/ (Data + Python scripts), FoundersForge/, and Tagalog/, with loose HTML files in the root.
- Eine Erinnerung wurde für Sonntag festgelegt, um später die Master-Liste-Logik zu überarbeiten.
- Der Plan beinhaltet die Nutzung von Firecrawl Agents zur Abfrage von boerse.de für KGV und KUV Daten.
- To-Do-Liste aktualisiert: 'Entscheidung KIMI vs. GLM vs. Gemini' hinzugefügt, 'Google 3.1 ausprobieren' gelöscht.
- Der User hat heute einen festen Termin um 11:00 Uhr und muss Serverlogs prüfen.
- The StockPulse scanner utilizes the Firecrawl Agent API (REST, polling) to extract PE ratios (0-200) and PS ratios (0-50) from boerse.de and onvista.de.
- The TypeScript StockPulse project is currently disconnected from the existing CSV data files in the Invest folder, which are managed by Python scripts.
- A master stock list exists at /root/home/projects/Invest/stocks/stockpulse-master.csv containing 469 stocks.
- StockPulse master lists and daily scan data already exist in CSV format within the Invest directory.
- Der firecrawl-browser Skill wurde erfolgreich erstellt und die Skill-Struktur analysiert (Status: Einsatzbereit).
- Key upcoming tasks include setting up a DevAI postbox, researching the Google MCP, defining design principles, and automating the privacy policy check.
- Im Organisationsordner sind administrative Aufgaben strukturiert, inklusive To-Do-Listen, Cronjob-Dokumentationen und Watchlisten für Medien.
- Der Nutzer verwaltet ein Investment-Projekt mit umfassender Dokumentation, darunter Investment-Ideen, Business-Ideen, aktuelle Holdings, Master-Listen und Status-Updates.
- Es gibt ein aktives Projekt namens FoundersForge (README vorhanden).
- Die Python-Scripts im Research/crawler/ Ordner sind Legacy-Code und werden vom aktuellen Scanner nicht verwendet.
- Der TypeScript-Scanner (daily.ts) nutzt aktuell nur 5 Test-Aktien und ist nicht mit der bestehenden Master-Liste verknüpft.
- Current scanning state is Round 1, Index 2, having scanned 3 stocks so far.
- Der Nutzer hat ein City-Shows Projekt erstellt, das HTML-Web-Shows für verschiedene Städte (z. B. Darmstadt, Frankfurt) umfasst.
- Für das Dynared Website Projekt existieren fertige Production Builds in einer dist-Verzeichnisstruktur mit Dokumentation (Impressum, Datenschutz).
