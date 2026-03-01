/**
 * StockPulse Historical Data Tracker
 * Speichert KGV/KUV-Verlauf für Trend-Analyse
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from './logger';

const HISTORICAL_DIR = path.join(__dirname, '../../data/historical');
const HISTORICAL_FILE = path.join(HISTORICAL_DIR, 'history.json');

// Ensure directory exists
if (!fs.existsSync(HISTORICAL_DIR)) {
  fs.mkdirSync(HISTORICAL_DIR, { recursive: true });
}

export interface HistoricalEntry {
  date: string;
  kgv: number | null;
  kuv: number | null;
  price: number | null;
  source: string;
}

export interface StockHistory {
  ticker: string;
  isin: string;
  name: string;
  entries: HistoricalEntry[];
}

export interface HistoricalDatabase {
  lastUpdated: string;
  stocks: Record<string, StockHistory>;
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

function loadDatabase(): HistoricalDatabase {
  if (!fs.existsSync(HISTORICAL_FILE)) {
    return { lastUpdated: '', stocks: {} };
  }
  
  try {
    return JSON.parse(fs.readFileSync(HISTORICAL_FILE, 'utf-8'));
  } catch {
    logger.warn('HISTORY', 'Corrupted history file, starting fresh');
    return { lastUpdated: '', stocks: {} };
  }
}

function saveDatabase(db: HistoricalDatabase): void {
  db.lastUpdated = new Date().toISOString();
  fs.writeFileSync(HISTORICAL_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Fügt einen Scan-Eintrag zur Historie hinzu
 */
export function addHistoricalEntry(
  ticker: string,
  isin: string,
  name: string,
  kgv: number | null,
  kuv: number | null,
  price: number | null,
  source: string = 'yahoo'
): void {
  const db = loadDatabase();
  const date = new Date().toISOString().split('T')[0];
  
  if (!db.stocks[ticker]) {
    db.stocks[ticker] = { ticker, isin, name, entries: [] };
  }
  
  // Check if entry for today already exists
  const todayEntry = db.stocks[ticker].entries.find(e => e.date === date);
  if (todayEntry) {
    // Update existing entry
    todayEntry.kgv = kgv;
    todayEntry.kuv = kuv;
    todayEntry.price = price;
    todayEntry.source = source;
  } else {
    // Add new entry
    db.stocks[ticker].entries.push({
      date,
      kgv,
      kuv,
      price,
      source,
    });
  }
  
  // Sort entries by date (newest first)
  db.stocks[ticker].entries.sort((a, b) => b.date.localeCompare(a.date));
  
  saveDatabase(db);
  logger.debug('HISTORY', `Added entry for ${ticker}`, { date, kgv, kuv });
}

/**
 * Holt die Historie für eine Aktie
 */
export function getStockHistory(ticker: string): StockHistory | null {
  const db = loadDatabase();
  return db.stocks[ticker] || null;
}

/**
 * Analysiert den KGV-Trend (letzte N Einträge)
 * Returns: 'improving' (wird günstiger), 'worsening' (wird teurer), 'stable'
 */
export function analyzeKGVTrend(ticker: string, lookback: number = 5): 'improving' | 'worsening' | 'stable' | 'unknown' {
  const history = getStockHistory(ticker);
  if (!history || history.entries.length < 2) return 'unknown';
  
  const recent = history.entries
    .filter(e => e.kgv !== null && e.kgv > 0)
    .slice(0, lookback);
  
  if (recent.length < 2) return 'unknown';
  
  const oldest = recent[recent.length - 1].kgv!;
  const newest = recent[0].kgv!;
  const change = (newest - oldest) / oldest;
  
  if (change < -0.1) return 'improving';  // KGV um >10% gesunken = günstiger
  if (change > 0.1) return 'worsening';   // KGV um >10% gestiegen = teurer
  return 'stable';
}

/**
 * Analysiert den KUV-Trend
 */
export function analyzeKUVTrend(ticker: string, lookback: number = 5): 'improving' | 'worsening' | 'stable' | 'unknown' {
  const history = getStockHistory(ticker);
  if (!history || history.entries.length < 2) return 'unknown';
  
  const recent = history.entries
    .filter(e => e.kuv !== null && e.kuv > 0)
    .slice(0, lookback);
  
  if (recent.length < 2) return 'unknown';
  
  const oldest = recent[recent.length - 1].kuv!;
  const newest = recent[0].kuv!;
  const change = (newest - oldest) / oldest;
  
  if (change < -0.1) return 'improving';
  if (change > 0.1) return 'worsening';
  return 'stable';
}

/**
 * Gibt alle Aktien mit verbesserndem KGV-Trend zurück
 */
export function getImprovingStocks(): StockHistory[] {
  const db = loadDatabase();
  const improving: StockHistory[] = [];
  
  for (const stock of Object.values(db.stocks)) {
    if (analyzeKGVTrend(stock.ticker) === 'improving') {
      improving.push(stock);
    }
  }
  
  return improving;
}

/**
 * Exportiert Historie als CSV
 */
export function exportHistoryCSV(ticker: string): string | null {
  const history = getStockHistory(ticker);
  if (!history) return null;
  
  const lines = ['Date,KGV,KUV,Price,Source'];
  for (const entry of history.entries) {
    lines.push(`${entry.date},${entry.kgv || 'N/A'},${entry.kuv || 'N/A'},${entry.price || 'N/A'},${entry.source}`);
  }
  
  return lines.join('\n');
}

export default {
  addHistoricalEntry,
  getStockHistory,
  analyzeKGVTrend,
  analyzeKUVTrend,
  getImprovingStocks,
  exportHistoryCSV,
};
