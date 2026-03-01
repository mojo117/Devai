/**
 * StockPulse Alert System
 * Automatische Benachrichtigung bei günstigen Bewertungen
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from './logger';
import { analyzeKGVTrend, analyzeKUVTrend } from './historical-tracker';

const ALERTS_DIR = path.join(__dirname, '../../data/alerts');
const ALERTS_FILE = path.join(ALERTS_DIR, 'alerts.json');
const ALERT_HISTORY_FILE = path.join(ALERTS_DIR, 'alert-history.json');

// Ensure directory exists
if (!fs.existsSync(ALERTS_DIR)) {
  fs.mkdirSync(ALERTS_DIR, { recursive: true });
}

// ============================================================================
// TYPES
// ============================================================================

export type AlertType = 'KGV_LOW' | 'KUV_LOW' | 'TREND_IMPROVING' | 'PRICE_DROP';

export interface AlertConfig {
  kgvThreshold: number;        // Alert wenn KGV < threshold
  kuvThreshold: number;        // Alert wenn KUV < threshold
  priceDropPercent: number;    // Alert wenn Preis um X% gefallen
  enableTrendAlerts: boolean;  // Alert bei verbesserndem Trend
}

export interface Alert {
  ticker: string;
  isin: string;
  name: string;
  type: AlertType;
  message: string;
  kgv: number | null;
  kuv: number | null;
  price: number | null;
  timestamp: string;
  notified: boolean;
}

export interface AlertHistory {
  sent: Alert[];
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: AlertConfig = {
  kgvThreshold: 10,      // KGV < 10 = günstig
  kuvThreshold: 0.5,     // KUV < 0.5 = günstig
  priceDropPercent: 10,  // 10% Preisfall
  enableTrendAlerts: true,
};

// ============================================================================
// ALERT MANAGEMENT
// ============================================================================

function loadAlertHistory(): AlertHistory {
  if (!fs.existsSync(ALERT_HISTORY_FILE)) {
    return { sent: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(ALERT_HISTORY_FILE, 'utf-8'));
  } catch {
    return { sent: [] };
  }
}

function saveAlertHistory(history: AlertHistory): void {
  fs.writeFileSync(ALERT_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

function wasRecentlyAlerted(ticker: string, type: AlertType, days: number = 7): boolean {
  const history = loadAlertHistory();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();
  
  return history.sent.some(a => 
    a.ticker === ticker && 
    a.type === type && 
    a.timestamp >= cutoffStr
  );
}

function markAlertSent(alert: Alert): void {
  const history = loadAlertHistory();
  alert.notified = true;
  alert.timestamp = new Date().toISOString();
  history.sent.push(alert);
  
  // Keep only last 1000 alerts
  if (history.sent.length > 1000) {
    history.sent = history.sent.slice(-1000);
  }
  
  saveAlertHistory(history);
}

// ============================================================================
// ALERT DETECTION
// ============================================================================

export function checkAlerts(
  ticker: string,
  isin: string,
  name: string,
  kgv: number | null,
  kuv: number | null,
  price: number | null,
  config: AlertConfig = DEFAULT_CONFIG
): Alert[] {
  const alerts: Alert[] = [];
  const timestamp = new Date().toISOString();
  
  // KGV Low Alert
  if (kgv !== null && kgv > 0 && kgv < config.kgvThreshold) {
    if (!wasRecentlyAlerted(ticker, 'KGV_LOW')) {
      alerts.push({
        ticker,
        isin,
        name,
        type: 'KGV_LOW',
        message: `🎯 ${ticker} hat ein KGV von ${kgv.toFixed(2)} (Threshold: ${config.kgvThreshold})`,
        kgv,
        kuv,
        price,
        timestamp,
        notified: false,
      });
    }
  }
  
  // KUV Low Alert
  if (kuv !== null && kuv > 0 && kuv < config.kuvThreshold) {
    if (!wasRecentlyAlerted(ticker, 'KUV_LOW')) {
      alerts.push({
        ticker,
        isin,
        name,
        type: 'KUV_LOW',
        message: `💰 ${ticker} hat ein KUV von ${kuv.toFixed(2)} (Threshold: ${config.kuvThreshold})`,
        kgv,
        kuv,
        price,
        timestamp,
        notified: false,
      });
    }
  }
  
  // Trend Improving Alert
  if (config.enableTrendAlerts) {
    const kgvTrend = analyzeKGVTrend(ticker);
    const kuvTrend = analyzeKUVTrend(ticker);
    
    if (kgvTrend === 'improving' || kuvTrend === 'improving') {
      if (!wasRecentlyAlerted(ticker, 'TREND_IMPROVING', 14)) {
        alerts.push({
          ticker,
          isin,
          name,
          type: 'TREND_IMPROVING',
          message: `📈 ${ticker} zeigt einen verbesserten Bewertungstrend`,
          kgv,
          kuv,
          price,
          timestamp,
          notified: false,
        });
      }
    }
  }
  
  return alerts;
}

// ============================================================================
// NOTIFICATION
// ============================================================================

export async function sendAlerts(alerts: Alert[], notifyFn?: (message: string) => Promise<void>): Promise<void> {
  if (alerts.length === 0) return;
  
  for (const alert of alerts) {
    logger.info('ALERT', alert.message, { ticker: alert.ticker, type: alert.type });
    
    // Send notification if function provided
    if (notifyFn) {
      try {
        await notifyFn(alert.message);
        markAlertSent(alert);
      } catch (err) {
        logger.error('ALERT', 'Failed to send notification', { ticker: alert.ticker, error: String(err) });
      }
    } else {
      markAlertSent(alert);
    }
  }
}

/**
 * Formatiert Alerts für Telegram
 */
export function formatAlertsForTelegram(alerts: Alert[]): string {
  if (alerts.length === 0) return '';
  
  const lines = ['🚨 **StockPulse Alerts**', ''];
  
  for (const alert of alerts) {
    const icon = alert.type === 'KGV_LOW' ? '🎯' : alert.type === 'KUV_LOW' ? '💰' : '📈';
    lines.push(`${icon} **${alert.ticker}** - ${alert.name}`);
    lines.push(`   ${alert.message}`);
    if (alert.price) lines.push(`   Preis: ${alert.price.toFixed(2)} EUR`);
    lines.push('');
  }
  
  lines.push(`_${alerts.length} Alert(s) generiert_`);
  
  return lines.join('\n');
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  checkAlerts,
  sendAlerts,
  formatAlertsForTelegram,
  DEFAULT_CONFIG,
};
