# StockPulse Scanner

Automatisierter Scanner für KUV (Kurs-Umsatz-Verhältnis) und KGV (Kurs-Gewinn-Verhältnis) von deutschen Aktien.

## Übersicht

- **469 Aktien** aus dem DAX, MDAX, SDAX und TecDAX
- **Datenquelle:** Börse.de (via Firecrawl API)
- **Täglich:** 10 Aktien rotierend durch alle 469
- **Pro Runde:** Neue CSV-Datei mit datumierten Spalten

## Dateien

| Datei | Beschreibung |
|-------|-------------|
| `stockpulse-master.csv` | **Master-Aktienliste** mit 469 Aktien (Ticker, Name, ISIN, URL, KGV/KUV Historie) |
| `stockpulse-scanner.ts` | Original-Scanner (alle Aktien auf einmal) |
| `stockpulse-daily.ts` | Erweiterter Scanner mit Rotationslogik |
| `scanner-state.json` | State-Tracking (letzter Index, Runde, Historie) |
| `ticker-url-mapping.json` | 469 Ticker → Börse.de URLs |
| `round-N/` | CSV-Dateien pro Runde |

## Aktueller Status

- **Runde:** 1
- **Letzter Index:** 2 (3 Aktien gescannt)
- **Startdatum:** 2026-02-25
- **Nächste 10:** Index 3-12 beim nächsten `--daily` Lauf

## Nutzung

### Täglicher Modus (10 Aktien pro Tag)

```bash
npx ts-node stockpulse-daily.ts --daily
```

### Test-Modus (3 Aktien)

```bash
npx ts-node stockpulse-daily.ts --test
```

### Komplette Runde scannen

```bash
npx ts-node stockpulse-daily.ts --scan-all
```

### Neue Runde starten

```bash
npx ts-node stockpulse-daily.ts --new-round
```

## CSV-Format

### Spalten

| Spalte | Beschreibung |
|--------|-------------|
| `Ticker` | Aktienticker (z.B. SAP, BMW) |
| `URL` | Börse.de URL |
| `Preis` | Aktueller Aktienkurs in EUR |
| `Veraenderung%` | Tägliche Veränderung in % |
| `KUV_YYYY-MM-DD` | KUV am Scan-Datum |
| `KGV_YYYY-MM-DD` | KGV am Scan-Datum |
| `ScanDate` | Datum des Scans |

### Beispiel

```csv
Ticker,URL,Preis,Veraenderung%,KUV_2026-02-25,KGV_2026-02-25,ScanDate
SAP,https://...,180.50,1.23,5.2,28.4,2026-02-25
BMW,https://...,95.20,-0.45,0.3,6.1,2026-02-25
```

## Rotationslogik

1. **State-Tracking:** `scanner-state.json` speichert den letzten gescannten Index
2. **Täglich:** 10 Aktien werden gescannt, Index wird um 10 erhöht
3. **Runden-Ende:** Wenn alle 469 durch, startet neue Runde mit `--new-round`
4. **Neue Runde:** Neues Verzeichnis `round-N/` mit neuer CSV

### State-Datei

```json
{
  "lastScannedIndex": 47,
  "currentRound": 1,
  "roundStartDate": "2026-02-25",
  "totalStocks": 469,
  "stocksPerDay": 10,
  "lastScanDate": "2026-02-25",
  "scanHistory": [
    {
      "date": "2026-02-25",
      "tickers": ["1U1", "TGT", "UUU", ...]
    }
  ]
}
```

## Voraussetzungen

- Node.js + TypeScript
- Firecrawl API Key (Environment Variable: `FIRECRAWL_API_KEY`)

```bash
export FIRECRAWL_API_KEY="your-api-key"
```

## Scheduler-Einrichtung

Für automatisches tägliches Scannen kann CAIO einen Scheduler einrichten:

```
Täglich um 06:00 Uhr: npx ts-node stockpulse-daily.ts --daily
```

---

## Offene TODOs

- [ ] **Scheduler-Einrichtung:** CAIO muss den täglichen Cron-Job einrichten
- [ ] **Fehlerbehandlung:** Retry-Logik bei API-Fehlern verbessern
- [ ] **Performance:** Parallelisierung der Firecrawl-Requests
- [ ] **Datenbank:** Optional: Migration zu SQLite statt CSV
- [ ] **Dashboard:** Web-UI für Scan-Ergebnisse
- [ ] **Alerts:** Benachrichtigung bei extrem niedrigen KUV/KGV-Werten
- [ ] **Historie:** Langzeit-Trends visualisieren
- [ ] **Export:** Excel/JSON Export-Optionen

---

## Changelog

### 2026-02-25
- Erweiterter Scanner mit Rotationslogik (`stockpulse-daily.ts`)
- State-Tracking (`scanner-state.json`)
- Pro Runde neue CSV mit datumierten Spalten
- README.md Dokumentation erstellt

### 2026-02-24
- Initialer Scanner (`stockpulse-scanner.ts`)
- Ticker-URL-Mapping (469 Aktien)
- Erste Test-Scans
