# StockPulse Historical Scanner

## Übersicht

StockPulse ist ein automatisierter Aktienkennzahlen-Scanner, der historische KUV- und KGV-Werte sammelt und in einer Master-CSV speichert. Das System scannt täglich bis zu 10 Aktien aus einer Liste von 469 Unternehmen und baut ein langes Datenspanne auf.

### Hauptziele

- **Automatisierung:** Tägliche Scans von Aktiendaten ohne manuelle Eingriffe
- **Historisierung:** Aufbau von monatlich/dessemterlichen Datensätzen über Jahre
- **Standardisierung:** Konsistente CSV-Struktur für alle 469 Aktien
- **Effizienz:** 10 Aktien pro Tag für skalierbare Datenhaltung

---

## Architektur

### Datenfluss

```
┌─────────────────┐
│  ticker-url-    │
│  mapping.json   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Historical State (historical-state.json)              │
│  - currentRound: Aktuelle Rundennummer                  │
│  - roundStartDate: Startdatum der aktuellen Runde       │
│  - scannedTickers: Bereits gescannte Aktien            │
│  - pendingTickers: Noch zu scannende Aktien            │
│  - completedRounds: Abgeschlossene Runden              │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  StockPulse Historical Scanner (stockpulse-historical.ts)│
│  1. Load State & Mapping                                │
│  2. Determine 10 Tickers to Scan                       │
│  3. Firecrawl Scraping                                   │
│  4. Parse KUV/KGV                                        │
│  5. Update Master CSV                                    │
│  6. Save State                                          │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Master CSV (master-historical.csv)                     │
│  - Spalte 1: Ticker                                      │
│  - Spalten N: KUV_YYYY-MM-DD, KGV_YYYY-MM-DD            │
│  - Werte werden bei neuen Durchläufen angehängt        │
└─────────────────────────────────────────────────────────┘
```

---

## Dateistruktur

```
/opt/Devai/workspace/stockpulse/
├── stockpulse-historical.ts          # Haupt-Scanner-Script
├── README.md                         # Diese Dokumentation
└── (in /root/home/projects/Invest/stocks/)
    ├── ticker-url-mapping.json       # Ticker-URL-Mapping (469 Einträge)
    ├── master-historical.csv         # Master-Datenbank (laufend wachsend)
    └── historical-state.json        # Zustandsverwaltung (Persistenz)
```

---

## Konfiguration

### Script-Parameter

```bash
npx ts-node stockpulse-historical.ts [--test] [--force-date YYYY-MM-DD]
```

#### Parameter

| Parameter | Beschreibung | Standard |
|-----------|-------------|----------|
| `--test` | Scanne nur 3 Aktien (für Tests) | Alle 10 Aktien |
| `--force-date YYYY-MM-DD` | Scanne spezifisches Datum | Heutiges Datum |

### Konstanten in Script

```typescript
const CONFIG = {
  mappingFile: '/root/home/projects/Invest/stocks/ticker-url-mapping.json',
  outputDir: '/root/home/projects/Invest/stocks',
  masterFile: '/root/home/projects/Invest/stocks/master-historical.csv',
  stateFile: '/root/home/projects/Invest/stocks/historical-state.json',
  stocksPerDay: 10,              // Aktien pro Durchlauf
  batchSize: 5,                  // (nicht aktuell verwendet)
  delayMs: 1500,                 // Wartezeit zwischen Scans
  timeoutMs: 30000,              // Timeout pro Scraping
};
```

---

## Datenstrukturen

### HistoricalState

```typescript
interface HistoricalState {
  currentRound: number;              // Aktuelle Rundennummer (1, 2, 3...)
  roundStartDate: string;            // ISO-Format: "2026-02-25"
  totalStocks: number;               // Gesamtanzahl Aktien (469)
  scannedTickers: string[];          // Bereits gescannte Ticker in Runde
  pendingTickers: string[];          // Noch zu scannende Ticker in Runde
  lastScanDate: string | null;       // Letzter erfolgreicher Scan
  completedRounds: number;           // Abgeschlossene Runden
  createdAt: string;                 // Erstellungszeitpunkt
  updatedAt: string;                 // Letzte Aktualisierung
}
```

### Master CSV Format

**Header:**
```
Ticker,KUV_2026-02-25,KGV_2026-02-25,KUV_2026-02-26,KGV_2026-02-26,...
```

**Row-Format:**
```
SAP,1.45,18.23,1.47,18.45,SIE,28.5,15.67,28.7,15.82,...
```

**Regeln:**
- Ticker alphabetisch sortiert
- Datumsspalten werden bei neuen Durchläufen angehängt
- Wenn kein Wert vorhanden: leere Zeichenfolge
- Dezimalzahlen immer 2 Stellen (`.toFixed(2)`)

---

## Ablaufdiagramm (Textbasiert)

```
START
 │
 ├─► State laden (historical-state.json)
 ├─► Mapping laden (ticker-url-mapping.json)
 ├─► Prüfen: Runde abgeschlossen?
 │    ├─► Ja → currentRound++, pendingTickers neu, roundStartDate setzen
 │    └─► Nein → Weiter
 │
 ├─► Zu scannende Aktien bestimmen (max 10 aus pendingTickers)
 │
 ├─► Für jede zu scannende Aktie:
 │    │
 │    ├─► URL erstellen (URL /aktien/ → /fundamental-analyse/)
 │    ├─► Firecrawl API Scraping
 │    │    ├─► POST https://api.firecrawl.dev/v1/scrape
 │    │    ├─► format: markdown
 │    │    └─► Antwort: Markdown-Inhalt
 │    │
 │    ├─► ParseFundamentalData()
 │    │    ├─► Preis (EUR) extrahieren
 │    │    ├─► Änderung (%) extrahieren
 │    │    ├─► Gewinn je Aktie (EPS) extrahieren
 │    │    └─► Umsatz je Aktie (SPS) extrahieren
 │    │
 │    ├─► calculateRatios()
 │    │    ├─► KGV = Preis / EPS * 100
 │    │    └─► KUV = Preis / SPS * 100
 │    │
 │    └─► Ergebnis speichern (ticker, kuv, kgv)
 │
 ├─► Werte in Master CSV eintragen
 │    ├─► KUV_{scanDate} = parseFloat(kuv).toFixed(2)
 │    ├─► KGV_{scanDate} = parseFloat(kgv).toFixed(2)
 │    └─► Alphabetische Sortierung
 │
 ├─► State speichern (scannedTickers, pendingTickers)
 │
 ├─► Statistiken ausgeben
 │    ├─► Erfolgreiche Scans
 │    ├──► Fehler (falls vorhanden)
 │    └─► Top/Bottom KGV
 │
 END
```

---

## Scheduler-Einrichtung

### Aktueller Status

Der Scheduler läuft täglich um **08:00 UTC**.

### Scheduler-Konfiguration

*Hinweis: Scheduler wird über CHAPO verwaltet (nicht über System-Cron)*

```bash
# CHAPO aufrufen für Scheduler-Konfiguration
# Befehl: scheduler_list
# Task: "stockpulse-historical täglich um 08:00 Uhr UTC"
```

### Cron-Beispiel (wenn manuell)

```bash
# Hängt manuell an Crontab an
0 8 * * * cd /opt/Devai/workspace/stockpulse && npx ts-node stockpulse-historical.ts >> stockpulse-cron.log 2>&1
```

---

## Nutzung

### Erstmaliger Start

1. **Prüfen, ob Environment-Variable gesetzt ist:**
   ```bash
   echo $FIRECRAWL_API_KEY
   ```

2. **Erster Testlauf (nur 3 Aktien):**
   ```bash
   cd /opt/Devai/workspace/stockpulse
   npx ts-node stockpulse-historical.ts --test
   ```

3. **Regulärer Lauf (10 Aktien):**
   ```bash
   npx ts-node stockpulse-historical.ts
   ```

### Manuelle Datums-Scans

Für Backfills oder manuelle Scans:
```bash
npx ts-node stockpulse-historical.ts --force-date 2026-01-15
```

### Status prüfen

1. **State-File anzeigen:**
   ```bash
   cat /root/home/projects/Invest/stocks/historical-state.json
   ```

2. **Master CSV prüfen:**
   ```bash
   head -5 /root/home/projects/Invest/stocks/master-historical.csv
   ```

---

## Firecrawl API Integration

### Aktuell (Staging)

- API-Integration ist in Arbeit
- Vorerst wird Scraping direkt im Script implementiert

### Zukünftig

Integration als Skill:
- Firecrawl API-Client über ctx.apis.firecrawl
- Agent-basierte Integration für dynamische Scraping
- Erweiterte Fehlerbehandlung und Retry-Logik

### API-Key-Management

Key ist bereits auf dem Server hinterlegt:
```bash
echo $FIRECRAWL_API_KEY
```

---

## Parser-Logik

### Fundamentaldaten Extraktion

Das Script extrahiert folgende Werte aus dem Markdown:

1. **Preis (EUR):**
   - Regex: `(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s*\n\s*EUR`
   - Formatierung: Punkt für Tausender, Komma für Dezimalstellen

2. **Veränderung (%):**
   - Regex: `(-?\d{1,3}(?:[.,]\d{2}))\s*\n\s*%`
   - Formatierung: Punkt für Tausender, Komma für Dezimalstellen

3. **Gewinn je Aktie (EPS):**
   - Regex: `\|\s*Gewinn je Aktie \(unverw[aä]ssert\)\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*(-?[\d.,]+)\s*\|`
   - Formatierung: Punkt für Tausender, Komma für Dezimalstellen

4. **Umsatz je Aktie (SPS):**
   - Regex: `\|\s*Umsatz je Aktie\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*([\d.,]+)\s*\|`
   - Formatierung: Punkt für Tausender, Komma für Dezimalstellen

### Kennzahlen Berechnung

```typescript
KGV = (Preis / EPS) * 100
KUV = (Preis / SPS) * 100

// Rückgabe: gerundet auf 2 Stellen
Math.round((price / eps) * 100) / 100
```

---

## Fehlerbehandlung

### Erfolgsquote

- Ziel: >90% erfolgreiche Scans
- Fehler werden protokolliert, Prozess läuft weiter

### Error-Handhabung

```typescript
try {
  // Scraping und Parsing
} catch (error) {
  return { ticker, url, price: null, change: null, kuv: null, kgv: null, error: `${error}` };
}
```

### Fehler-Typen

1. **API-Fehler:**
   - Firecrawl API Fehler
   - Timeout (30s)

2. **Parse-Fehler:**
   - Regex-Match fehlschlägt
   - Wert nicht gefunden

3. **Mapping-Fehler:**
   - Ticker nicht im Mapping
   - URL nicht gefunden

---

## Monitoring & Logs

### Konsolenausgabe

Jeder Lauf zeigt:
```
╔══════════════════════════════════════════════════════════╗
║     StockPulse Historical Scanner - Master CSV Builder   ║
╚══════════════════════════════════════════════════════════╝

📅 Scan-Datum: 2026-02-25
📊 469 Aktien im Mapping
🆕 Neue Runde 1 gestartet
🔍 Scanne 10 Aktien (Runde 1)
   Fortschritt: 0/469

  Scraping AAPL...
  Scraping MSFT...
  Scraping GOOGL...
  ...

═══════════════════════════════════════════════════════════
✅ Erfolgreich: 8/10
❌ Fehler: 2
   - YNDX: Timeout

📊 Runde 1 Fortschritt: 8/469
📄 Master CSV: /root/home/projects/Invest/stocks/master-historical.csv
📄 State: /root/home/projects/Invest/stocks/historical-state.json

📈 Gescannte Aktien (sortiert nach KGV):
   1. NOK: KGV 14.23, KUV 2.45, Preis 5.67€
   2. SAP: KGV 18.23, KUV 1.45, Preis 28.50€
   ...

✨ Fertig!
```

### Log-Files

Für manuelle Cron-Läufe:
```bash
tail -f stockpulse-cron.log
```

---

## Wartung

### State-Reset (falls nötig)

```bash
# Vollständiger Reset
rm /root/home/projects/Invest/stocks/historical-state.json
# Script wird bei nächstem Lauf automatisch mit Default-State starten
```

### Backups

Empfohlen: Master CSV und State-File regelmäßig backuppen:
```bash
cp /root/home/projects/Invest/stocks/master-historical.csv \
   /root/home/projects/Invest/stocks/backup/master-historical-backup-$(date +%Y%m%d).csv
```

---

## Performance

### Durchlauf-Zeit

- 10 Aktien: ~15-20 Sekunden
- Firecrawl-Requests: 1 pro Aktie
- Delay: 500ms zwischen Requests

### Kapazität

- 10 Aktien pro Tag
- 365 Tage × 10 = 3650 Scans pro Jahr
- Für 469 Aktien: ~50 Tage pro Runde

### Skalierung

Für erhöhte Geschwindigkeit:
- Mehr Aktien pro Tag (angepasst an API-Rate-Limits)
- Asynchrones Scraping (ohne Delays)
- Parallel Requests (über multiple Workers)

---

## Zukunftsschritte

### Kurzfristig

- [x] Core-Scanner implementiert
- [x] State-Management integriert
- [ ] Firecrawl API-Integration als Skill
- [ ] Monitoring & Logging verbessern
- [ ] Fehlerbehandlung erweitern

### Mittelfristig

- [ ] Grafische Übersicht (Dashboard)
- [ ] Trend-Analysen
- [ ] Alert-System (KGV/Bewertung)
- [ ] Export-Funktionen (PDF/Excel)

### Langfristig

- [ ] Real-time-Updates
- [ ] Multi-Asset-Klassifizierung
- [ ] Integration mit weiteren Datenquellen
- [ ] Mobile App / Web-Interface

---

## Support

### Documentation

- Diese README.md
- Script-Header-Kommentare

### Contact

- **Team:** CHAPO
- **Channel:** Telegram (Jörn)

---

## Version

- **Status:** Beta / In Development
- **Letzte Aktualisierung:** 2026-02-26
- **Version:** 1.0.0

---

## Lizenz

Internal Development - DevAI Workspace
