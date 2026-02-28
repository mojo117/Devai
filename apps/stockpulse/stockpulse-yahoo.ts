#!/usr/bin/env npx ts-node
/**
 * StockPulse Daily Scanner - Yahoo Finance API Version
 * Scannt 10 Aktien pro Tag via Yahoo Finance API
 */

import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getStockMetrics } = require('./src/api/yahoo-finance');

// ============================================================================
// KONFIGURATION
// ============================================================================

const BASE_DIR = process.cwd();
const CSV_PATH = path.join(BASE_DIR, 'stockpulse-master.csv');
const STATE_PATH = path.join(BASE_DIR, 'scanner-state.json');

const STOCKS_PER_DAY = 10;
const DELAY_BETWEEN_REQUESTS = 300; // ms

// ============================================================================
// TYPES
// ============================================================================

interface ScannerState {
  round: number;
  lastScannedIndex: number;
  lastScanDate: string;
  scannedToday: number;
}

interface ScanResult {
  ticker: string;
  isin: string;
  kgv: string;
  kuv: string;
  price: string;
  source: 'yahoo' | 'fallback';
  error?: string;
}

// ============================================================================
// HELPER
// ============================================================================

function extractISINFromURL(url: string): string {
  if (!url) return '';
  // URL Format: https://www.boerse.de/aktien/1-1/DE0005545503
  const match = url.match(/([A-Z]{2}[A-Z0-9]{10})/);
  return match ? match[1] : '';
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

function loadState(): ScannerState {
  if (!fs.existsSync(STATE_PATH)) {
    return {
      round: 1,
      lastScannedIndex: 0,
      lastScanDate: '',
      scannedToday: 0,
    };
  }
  
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
}

function saveState(state: ScannerState): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

// ============================================================================
// CSV OPERATIONS
// ============================================================================

function readMasterCSV(): { header: string[]; rows: string[][] } {
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');
  const rows = lines.slice(1).map((line: string) => line.split(','));
  return { header, rows };
}

function writeMasterCSV(header: string[], rows: string[][]): void {
  const content = [header.join(','), ...rows.map(row => row.join(','))].join('\n');
  fs.writeFileSync(CSV_PATH, content, 'utf-8');
}

function getCurrentRound(header: string[]): number {
  let round = 1;
  for (const col of header) {
    const match = col.match(/Datum_(\d+)/);
    if (match) {
      round = Math.max(round, parseInt(match[1]));
    }
  }
  return round;
}

function ensureRoundColumns(header: string[], round: number): string[] {
  const newHeader = [...header];
  const colName = `Datum_${round}`;
  
  if (!newHeader.includes(colName)) {
    newHeader.push(`KGV_${round}`, `KUV_${round}`, `Datum_${round}`);
  }
  
  return newHeader;
}

// ============================================================================
// MAIN SCANNER
// ============================================================================

async function scanStocks(count: number = STOCKS_PER_DAY): Promise<ScanResult[]> {
  const { header, rows } = readMasterCSV();
  const state = loadState();
  
  const today = new Date().toISOString().split('T')[0];
  
  // Check if already scanned today
  if (state.lastScanDate === today && state.scannedToday >= STOCKS_PER_DAY) {
    console.log(`✅ Bereits ${state.scannedToday} Aktien heute gescannt.`);
    return [];
  }
  
  // Determine current round
  const currentRound = getCurrentRound(header);
  const newHeader = ensureRoundColumns(header, currentRound);
  
  // Find column indices
  const kgvColIdx = newHeader.indexOf(`KGV_${currentRound}`);
  const kuvColIdx = newHeader.indexOf(`KUV_${currentRound}`);
  const datumColIdx = newHeader.indexOf(`Datum_${currentRound}`);
  
  // Ensure rows have enough columns
  rows.forEach(row => {
    while (row.length < newHeader.length) {
      row.push('');
    }
  });
  
  // Get stocks to scan
  const results: ScanResult[] = [];
  let scanned = 0;
  let idx = state.lastScannedIndex;
  
  while (scanned < count && idx < rows.length) {
    const ticker = rows[idx][0];
    const isin = rows[idx][2] || extractISINFromURL(rows[idx][3]);
    const name = rows[idx][1] || '';
    
    if (!ticker) {
      console.log(`⚠️ Ungültige Zeile ${idx} (kein Ticker)`);
      idx++;
      continue;
    }
    
    // Check if already scanned in this round
    if (rows[idx][datumColIdx] && rows[idx][datumColIdx] !== '') {
      console.log(`⏭️ ${ticker} bereits in Round ${currentRound} gescannt`);
      idx++;
      continue;
    }
    
    console.log(`📊 Scanne ${ticker} (${isin}) via Yahoo Finance...`);
    
    try {
      // Yahoo Finance API Call
      const symbol = `${ticker}.DE`;
      const metrics = await getStockMetrics(symbol);
      
      if (metrics.error) {
        console.log(`   ⚠️ Yahoo Fehler: ${metrics.error}`);
        
        // TODO: Fallback auf Firecrawl/Scraping
        
        results.push({
          ticker,
          isin,
          kgv: 'N/A',
          kuv: 'N/A',
          price: 'N/A',
          source: 'yahoo',
          error: metrics.error,
        });
        
        rows[idx][kgvColIdx] = 'N/A';
        rows[idx][kuvColIdx] = 'N/A';
        rows[idx][datumColIdx] = today;
        
      } else {
        // Success!
        const kgv = metrics.peRatio?.toFixed(2) || 'N/A';
        const kuv = metrics.psRatio?.toFixed(2) || 'N/A';
        const price = metrics.price?.toFixed(2) || 'N/A';
        
        rows[idx][kgvColIdx] = kgv;
        rows[idx][kuvColIdx] = kuv;
        rows[idx][datumColIdx] = today;
        
        results.push({
          ticker,
          isin,
          kgv,
          kuv,
          price,
          source: 'yahoo',
        });
        
        console.log(`   ✅ KGV: ${kgv}, KUV: ${kuv}, Preis: ${price} ${metrics.currency || 'EUR'}`);
      }
      
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.log(`   ❌ Fehler: ${msg}`);
      
      results.push({
        ticker,
        isin,
        kgv: 'N/A',
        kuv: 'N/A',
        price: 'N/A',
        source: 'yahoo',
        error: msg,
      });
    }
    
    scanned++;
    idx++;
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
  }
  
  // Check if round is complete
  if (idx >= rows.length) {
    console.log(`\n🎉 Round ${currentRound} abgeschlossen! Starte Round ${currentRound + 1}`);
    idx = 0;
    state.round = currentRound + 1;
    
    const nextRoundHeader = ensureRoundColumns(newHeader, currentRound + 1);
    writeMasterCSV(nextRoundHeader, rows);
  } else {
    writeMasterCSV(newHeader, rows);
  }
  
  // Update state
  state.lastScannedIndex = idx;
  state.lastScanDate = today;
  state.scannedToday = state.lastScanDate === today ? state.scannedToday + scanned : scanned;
  saveState(state);
  
  return results;
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const force = args.includes('--force');
  const count = isTest ? 3 : STOCKS_PER_DAY;
  
  // Force mode: reset daily counter
  if (force) {
    const state = loadState();
    state.scannedToday = 0;
    state.lastScanDate = '';
    saveState(state);
    console.log('⚠️ Force Mode: Täglicher Zähler zurückgesetzt');
  }
  
  console.log('🚀 StockPulse Daily Scanner (Yahoo Finance API)');
  console.log(`   Modus: ${isTest ? 'TEST (3 Aktien)' : 'DAILY (10 Aktien)'}`);
  console.log('');
  
  const results = await scanStocks(count);
  
  if (results.length > 0) {
    console.log('\n📊 ERGEBNISSE:');
    console.log('─'.repeat(60));
    console.log('Ticker | KGV     | KUV    | Preis  | Quelle');
    console.log('─'.repeat(60));
    
    for (const r of results) {
      const ticker = r.ticker.padEnd(6);
      const kgv = r.kgv.padEnd(7);
      const kuv = r.kuv.padEnd(6);
      const price = r.price.padEnd(6);
      console.log(`${ticker} | ${kgv} | ${kuv} | ${price} | ${r.source}`);
    }
    
    console.log('─'.repeat(60));
    
    const success = results.filter(r => r.kgv !== 'N/A').length;
    console.log(`✅ ${success}/${results.length} Aktien erfolgreich gescannt`);
  }
}

main().catch(console.error);
