#!/usr/bin/env ts-node
/**
 * Yahoo Finance API Wrapper für StockPulse
 * Liefert KGV (PE-Ratio), KUV (PS-Ratio) und aktuellen Kurs
 * 
 * Version: 3.0 - Mit Retry-Logic und Error Handling
 */

// @ts-nocheck

// ============================================================================
// TYPES
// ============================================================================

export interface StockMetrics {
  ticker: string;
  yahooSymbol: string;
  peRatio: number | null;  // KGV
  psRatio: number | null;  // KUV
  price: number | null;
  marketCap: number | null;
  currency: string | null;
  error?: string;
  retries?: number;
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;    // ms
  maxDelay: number;     // ms
}

// ============================================================================
// YAHOO FINANCE INSTANCE
// ============================================================================

const { default: YahooFinance } = require('yahoo-finance2');

// Singleton Instance
let yahooFinanceInstance = null;

// Default retry config
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 5000,
};

function getYahooFinance() {
  if (!yahooFinanceInstance) {
    yahooFinanceInstance = new YahooFinance();
  }
  return yahooFinanceInstance;
}

// ============================================================================
// ISIN TO YAHOO SYMBOL
// ============================================================================

/**
 * Wandelt einen Ticker in ein Yahoo Finance Symbol um
 * DE-Aktien haben den Suffix .DE (XETRA)
 */
function tickerToYahooSymbol(ticker) {
  return `${ticker}.DE`;
}

// ============================================================================
// STOCK METRICS ABRUFEN
// ============================================================================

/**
 * Ruft KGV, KUV und Preis von Yahoo Finance ab
 * Mit automatischer Retry-Logic bei Fehlern
 */
async function getStockMetrics(symbol, retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {
  const ticker = symbol.replace('.DE', '');
  const yahoo = getYahooFinance();
  
  let lastError: string | null = null;
  
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      // Rate limiting - exponential backoff
      const delayMs = attempt === 0 ? 100 : Math.min(
        retryConfig.baseDelay * Math.pow(2, attempt - 1),
        retryConfig.maxDelay
      );
      await delay(delayMs);
      
      // Hole quoteSummary für fundamentale Daten
      const summary = await yahoo.quoteSummary(symbol, {
        modules: ['defaultKeyStatistics', 'financialData', 'price', 'summaryDetail']
      });
      
      // Extrahiere PE-Ratio (KGV) - bevorzuge forwardPE
      const peRatio = summary.defaultKeyStatistics?.forwardPE 
        || summary.defaultKeyStatistics?.trailingPE 
        || summary.summaryDetail?.forwardPE
        || summary.summaryDetail?.trailingPE
        || null;
      
      // Extrahiere PS-Ratio (KUV) - aus summaryDetail!
      const psRatio = summary.summaryDetail?.priceToSalesTrailing12Months 
        || summary.defaultKeyStatistics?.priceToSalesTrailing12Months 
        || null;
      
      // Extrahiere Preis
      const price = summary.financialData?.currentPrice 
        || summary.price?.regularMarketPrice 
        || null;
      
      // Extrahiere Market Cap
      const marketCap = summary.financialData?.marketCap 
        || null;
      
      // Extrahiere Währung
      const currency = summary.price?.currency || null;
      
      return {
        ticker,
        yahooSymbol: symbol,
        peRatio: peRatio ? roundTo(peRatio, 2) : null,
        psRatio: psRatio ? roundTo(psRatio, 2) : null,
        price: price ? roundTo(price, 2) : null,
        marketCap,
        currency,
        retries: attempt > 0 ? attempt : undefined,
      };
      
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      
      // Don't retry on 404 (symbol not found)
      if (lastError.includes('404') || lastError.includes('Not Found')) {
        break;
      }
      
      console.log(`   ⚠️ Versuch ${attempt + 1}/${retryConfig.maxRetries + 1} fehlgeschlagen: ${lastError}`);
    }
  }
  
  // All retries failed
  return {
    ticker,
    yahooSymbol: symbol,
    peRatio: null,
    psRatio: null,
    price: null,
    marketCap: null,
    currency: null,
    error: lastError || 'Unknown error',
    retries: retryConfig.maxRetries,
  };
}

// ============================================================================
// SYMBOL LOOKUP
// ============================================================================

/**
 * Sucht nach einem Yahoo-Symbol basierend auf Query
 */
async function lookupSymbol(query) {
  const yahoo = getYahooFinance();
  
  try {
    const results = await yahoo.search(query);
    
    if (results.quotes && results.quotes.length > 0) {
      // Priorisiere deutsche Symbole (.DE)
      const deQuote = results.quotes.find((q) => q.symbol?.endsWith('.DE'));
      if (deQuote && deQuote.symbol) {
        return deQuote.symbol;
      }
      
      // Fallback auf erstes Ergebnis
      const firstQuote = results.quotes[0];
      return firstQuote.symbol || null;
    }
    
    return null;
  } catch (error) {
    console.error(`Symbol lookup failed for ${query}:`, error);
    return null;
  }
}

// ============================================================================
// BATCH SCANNING
// ============================================================================

/**
 * Scannt mehrere Aktien und gibt Metriken zurück
 */
async function scanStocksBatch(stocks, onProgress) {
  const results = [];
  
  for (const stock of stocks) {
    // Konvertiere Ticker zu Yahoo Symbol
    const symbol = tickerToYahooSymbol(stock.ticker);
    
    console.log(`📊 Scanne ${stock.ticker} (${symbol})...`);
    
    const metrics = await getStockMetrics(symbol);
    
    if (onProgress) {
      onProgress(stock.ticker, metrics);
    }
    
    results.push(metrics);
    
    // Rate limiting
    await delay(200);
  }
  
  return results;
}

// ============================================================================
// HELPER
// ============================================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function roundTo(num, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  getStockMetrics,
  lookupSymbol,
  scanStocksBatch,
  tickerToYahooSymbol,
};
