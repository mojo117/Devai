#!/usr/bin/env npx ts-node
/**
 * StockPulse Historical Scanner - Pflege einer Master-CSV mit historischen KUV/KGV-Werten
 * 
 * Archtektur:
 * - Master-CSV: Ticker als Zeilen, datumsbasierte Spalten (KUV_YYYY-MM-DD, KGV_YYYY-MM-DD)
 * - Pro Durchlauf: 10 Aktien scannen, Werte in bestehende Zeilen einfügen
 * - Wenn alle 469 Aktien durch: Neue Datumsspalten anlegen, Runde erhöhen
 * 
 * Nutzung:
 *   npx ts-node stockpulse-historical.ts [--test] [--force-date YYYY-MM-DD]
 */

import * as fs from 'fs';
import * as path from 'path';

// Konfiguration
const CONFIG = {
  mappingFile: '/root/home/projects/Invest/stocks/ticker-url-mapping.json',
  outputDir: '/root/home/projects/Invest/stocks',
  masterFile: '/root/home/projects/Invest/stocks/master-historical.csv',
  stateFile: '/root/home/projects/Invest/stocks/historical-state.json',
  stocksPerDay: 10,
  batchSize: 5,
  delayMs: 1500,
  timeoutMs: 30000,
};

// Types
interface StockData {
  ticker: string;
  url: string;
  price: number | null;
  change: number | null;
  kuv: number | null;
  kgv: number | null;
  error?: string;
}

interface ScrapeResult {
  price: number | null;
  change: number | null;
  eps: number | null;
  sps: number | null;
  error?: string;
}

interface HistoricalState {
  currentRound: number;
  roundStartDate: string;
  totalStocks: number;
  scannedTickers: string[];      // Alle in dieser Runde gescannten Ticker
  pendingTickers: string[];      // Noch zu scannen in dieser Runde
  lastScanDate: string | null;
  completedRounds: number;
  createdAt: string;
  updatedAt: string;
}

interface MasterCSVRow {
  ticker: string;
  name?: string;
  values: Record<string, string>; // z.B. { "KUV_2026-02-25": "1.5", "KGV_2026-02-25": "12.3" }
}

// State Management
function loadState(): HistoricalState {
  if (fs.existsSync(CONFIG.stateFile)) {
    return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf-8'));
  }
  
  // Default State
  return {
    currentRound: 1,
    roundStartDate: new Date().toISOString().split('T')[0],
    totalStocks: 0,
    scannedTickers: [],
    pendingTickers: [],
    lastScanDate: null,
    completedRounds: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function saveState(state: HistoricalState): void {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

// Master CSV Management
function loadMasterCSV(): Map<string, MasterCSVRow> {
  const rows = new Map<string, MasterCSVRow>();
  
  if (!fs.existsSync(CONFIG.masterFile)) {
    return rows;
  }
  
  const content = fs.readFileSync(CONFIG.masterFile, 'utf-8');
  const lines = content.trim().split('\n');
  
  if (lines.length === 0) return rows;
  
  const headers = lines[0].split(',');
  const tickerIdx = headers.indexOf('Ticker');
  
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 1) continue;
    
    const ticker = cols[tickerIdx];
    const row: MasterCSVRow = { ticker, values: {} };
    
    for (let j = 0; j < headers.length; j++) {
      if (j !== tickerIdx && cols[j]) {
        row.values[headers[j]] = cols[j];
      }
    }
    
    rows.set(ticker, row);
  }
  
  return rows;
}

function saveMasterCSV(rows: Map<string, MasterCSVRow>, dateColumn: string): void {
  // Alle existierenden Spalten sammeln + neue Datumsspalten
  const allColumns = new Set<string>();
  rows.forEach(row => {
    Object.keys(row.values).forEach(col => allColumns.add(col));
  });
  
  // Neue Datumsspalten sicherstellen
  allColumns.add(`KUV_${dateColumn}`);
  allColumns.add(`KGV_${dateColumn}`);
  
  // Sortierung: Ticker, dann alphabetisch
  const sortedColumns = ['Ticker', ...Array.from(allColumns).sort()];
  
  // Header
  const lines = [sortedColumns.join(',')];
  
  // Rows (alphabetisch nach Ticker)
  const sortedTickers = Array.from(rows.keys()).sort();
  for (const ticker of sortedTickers) {
    const row = rows.get(ticker)!;
    const cols = sortedColumns.map(col => {
      if (col === 'Ticker') return ticker;
      return row.values[col] || '';
    });
    lines.push(cols.join(','));
  }
  
  fs.writeFileSync(CONFIG.masterFile, lines.join('\n'));
}

// Firecrawl API
async function scrapeWithFirecrawl(url: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('FIRECRAWL_API_KEY nicht gesetzt');
  }

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['markdown'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl API Error: ${response.status}`);
  }

  const data = await response.json() as { data?: { markdown?: string } };
  return data.data?.markdown || null;
}

// Parsing
function parseFundamentalData(markdown: string): ScrapeResult {
  const result: ScrapeResult = {
    price: null,
    change: null,
    eps: null,
    sps: null,
  };

  try {
    // Preis
    const priceMatch = markdown.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s*\n\s*EUR/);
    if (priceMatch) {
      result.price = parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.'));
    }

    // Veränderung
    const changeMatch = markdown.match(/(-?\d{1,3}(?:[.,]\d{2}))\s*\n\s*%/);
    if (changeMatch) {
      result.change = parseFloat(changeMatch[1].replace(',', '.'));
    }

    // Gewinn je Aktie
    const epsMatch = markdown.match(/\|\s*Gewinn je Aktie \(unverw[aä]ssert\)\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*(-?[\d.,]+)\s*\|/);
    if (epsMatch) {
      result.eps = parseFloat(epsMatch[1].replace(',', '.'));
    }

    // Umsatz je Aktie
    const spsMatch = markdown.match(/\|\s*Umsatz je Aktie\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*([\d.,]+)\s*\|/);
    if (spsMatch) {
      result.sps = parseFloat(spsMatch[1].replace(',', '.'));
    }
  } catch (error) {
    result.error = `Parse Error: ${error}`;
  }

  return result;
}

function calculateRatios(price: number | null, eps: number | null, sps: number | null): { kgv: number | null; kuv: number | null } {
  const kgv = (price && eps && eps > 0) ? Math.round((price / eps) * 100) / 100 : null;
  const kuv = (price && sps && sps > 0) ? Math.round((price / sps) * 100) / 100 : null;
  return { kgv, kuv };
}

// Single Stock Scrape
async function scrapeStock(ticker: string, url: string): Promise<StockData> {
  const fundamentalUrl = url.replace('/aktien/', '/fundamental-analyse/');
  
  try {
    console.log(`  Scraping ${ticker}...`);
    const markdown = await scrapeWithFirecrawl(fundamentalUrl);
    
    if (!markdown) {
      return { ticker, url, price: null, change: null, kuv: null, kgv: null, error: 'No data returned' };
    }

    const parsed = parseFundamentalData(markdown);
    const { kgv, kuv } = calculateRatios(parsed.price, parsed.eps, parsed.sps);

    return {
      ticker,
      url,
      price: parsed.price,
      change: parsed.change,
      kuv,
      kgv,
      error: parsed.error,
    };
  } catch (error) {
    return { ticker, url, price: null, change: null, kuv: null, kgv: null, error: `${error}` };
  }
}

// Batch Scrape
async function scrapeBatch(stocks: [string, string][]): Promise<StockData[]> {
  const results: StockData[] = [];

  for (const [ticker, url] of stocks) {
    const result = await scrapeStock(ticker, url);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const forceDateIdx = args.indexOf('--force-date');
  const forceDate = forceDateIdx >= 0 ? args[forceDateIdx + 1] : null;
  const scanDate = forceDate || new Date().toISOString().split('T')[0];
  
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     StockPulse Historical Scanner - Master CSV Builder   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`📅 Scan-Datum: ${scanDate}`);
  console.log();

  // Mapping laden
  if (!fs.existsSync(CONFIG.mappingFile)) {
    console.error(`❌ Mapping-Datei nicht gefunden: ${CONFIG.mappingFile}`);
    process.exit(1);
  }

  const mapping: Record<string, string> = JSON.parse(fs.readFileSync(CONFIG.mappingFile, 'utf-8'));
  const allTickers = Object.keys(mapping).sort();
  
  console.log(`📊 ${allTickers.length} Aktien im Mapping`);
  
  // State laden
  let state = loadState();
  state.totalStocks = allTickers.length;
  
  // Erster Lauf? Pending-Ticker initialisieren
  if (state.pendingTickers.length === 0 && state.scannedTickers.length === 0) {
    state.pendingTickers = [...allTickers];
    state.roundStartDate = scanDate;
    console.log(`🆕 Neue Runde ${state.currentRound} gestartet`);
  }
  
  // Master CSV laden
  const masterRows = loadMasterCSV();
  
  // Sicherstellen, dass alle Ticker Rows haben
  for (const ticker of allTickers) {
    if (!masterRows.has(ticker)) {
      masterRows.set(ticker, { ticker, values: {} });
    }
  }
  
  // Check: Alle durch? Neue Runde starten
  if (state.pendingTickers.length === 0 && state.scannedTickers.length >= state.totalStocks) {
    state.completedRounds++;
    state.currentRound++;
    state.scannedTickers = [];
    state.pendingTickers = [...allTickers];
    state.roundStartDate = scanDate;
    console.log(`🔄 Runde abgeschlossen! Starte Runde ${state.currentRound}`);
  }
  
  // Zu scannende Aktien bestimmen
  const toScanCount = isTest ? 3 : CONFIG.stocksPerDay;
  const tickersToScan = state.pendingTickers.slice(0, toScanCount);
  
  if (tickersToScan.length === 0) {
    console.log('✅ Keine Aktien mehr zu scannen für heute');
    console.log(`   Bereits gescannt: ${state.scannedTickers.length}/${state.totalStocks}`);
    return;
  }
  
  console.log(`🔍 Scanne ${tickersToScan.length} Aktien (Runde ${state.currentRound})`);
  console.log(`   Fortschritt: ${state.scannedTickers.length}/${state.totalStocks}`);
  console.log();
  
  // Scannen
  const stocksToScan: [string, string][] = tickersToScan.map(t => [t, mapping[t]]);
  const results = await scrapeBatch(stocksToScan);
  
  // Ergebnisse in Master CSV eintragen
  for ( const result of results) {
    const row = masterRows.get(result.ticker);
    if (row) {
      const kuvCol = `KUV_${scanDate}`;
      const kgvCol = `KGV_${scanDate}`;
      
      if (result.kuv !== null) row.values[kuvCol] = result.kuv.toFixed(2);
      if (result.kgv !== null) row.values[kgvCol] = result.kgv.toFixed(2);
    }
    
    // Aus Pending zu Scanned verschieben
    const idx = state.pendingTickers.indexOf(result.ticker);
    if (idx >= 0) {
      state.pendingTickers.splice(idx, 1);
    }
    if (!state.scannedTickers.includes(result.ticker)) {
      state.scannedTickers.push(result.ticker);
    }
  }
  
  // Speichern
  saveMasterCSV(masterRows, scanDate);
  state.lastScanDate = scanDate;
  saveState(state);
  
  // Statistiken
  const successCount = results.filter(r => r.kgv !== null || r.kuv !== null).length;
  const errorCount = results.filter(r => r.error).length;
  
  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`✅ Erfolgreich: ${successCount}/${results.length}`);
  if (errorCount > 0) {
    console.log(`❌ Fehler: ${errorCount}`);
    results.filter(r => r.error).forEach(r => {
      console.log(`   - ${r.ticker}: ${r.error}`);
    });
  }
  
  console.log();
  console.log(`📊 Runde ${state.currentRound} Fortschritt: ${state.scannedTickers.length}/${state.totalStocks}`);
  console.log(`📄 Master CSV: ${CONFIG.masterFile}`);
  console.log(`📄 State: ${CONFIG.stateFile}`);
  
  // Top/Bottom anzeigen
  const validResults = results.filter(r => r.kgv !== null);
  if (validResults.length > 0) {
    console.log();
    console.log('📈 Gescannte Aktien (sortiert nach KGV):');
    validResults
      .sort((a, b) => (a.kgv || 0) - (b.kgv || 0))
      .forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.ticker}: KGV ${s.kgv?.toFixed(2)}, KUV ${s.kuv?.toFixed(2)}, Preis ${s.price?.toFixed(2)}€`);
      });
  }
  
  console.log();
  console.log('✨ Fertig!');
}

main().catch(console.error);
