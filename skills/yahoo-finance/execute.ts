export async function execute(args: { ticker: string; metrics?: string[] }, ctx: any) {
  const { ticker, metrics } = args;
  
  try {
    // Direct Yahoo Finance API call via fetch
    const modules = 'price,summaryDetail,defaultKeyStatistics,financialData';
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DevAI/1.0)',
      }
    });
    
    if (!response.ok) {
      return { 
        success: false, 
        error: `Yahoo Finance API error: ${response.status}`,
        ticker 
      };
    }
    
    const data = await response.json();
    
    if (!data.quoteSummary?.result?.[0]) {
      return { 
        success: false, 
        error: 'No data returned from Yahoo Finance',
        ticker 
      };
    }
    
    const quoteSummary = data.quoteSummary.result[0];
    const price = quoteSummary.price || {};
    const summary = quoteSummary.summaryDetail || {};
    const keyStats = quoteSummary.defaultKeyStatistics || {};
    const financials = quoteSummary.financialData || {};
    
    // Helper to extract numeric value from Yahoo's {raw, fmt} format
    const getValue = (field: any): number | null => {
      if (field === null || field === undefined) return null;
      if (typeof field === 'number') return field;
      if (typeof field === 'object' && 'raw' in field) return field.raw;
      return null;
    };
    
    const result: Record<string, any> = {
      ticker: ticker,
      name: price.shortName || price.longName || 'N/A',
      exchange: price.exchange || 'N/A',
      currency: price.currency || 'USD',
      price: getValue(price.regularMarketPrice),
      priceChange: getValue(price.regularMarketChange),
      priceChangePercent: getValue(price.regularMarketChangePercent),
      peRatio: getValue(keyStats.trailingPE) || getValue(summary.trailingPE),
      forwardPE: getValue(keyStats.forwardPE),
      psRatio: getValue(keyStats.priceToSalesTrailing12Months) || getValue(keyStats.priceToSales),
      pbRatio: getValue(keyStats.priceToBook),
      marketCap: getValue(price.marketCap) || getValue(summary.marketCap),
      dividendYield: getValue(summary.dividendYield),
      eps: getValue(keyStats.trailingEps),
      revenue: getValue(financials.totalRevenue),
      profitMargin: getValue(financials.profitMargins),
      fiftyTwoWeekLow: getValue(summary.fiftyTwoWeekLow),
      fiftyTwoWeekHigh: getValue(summary.fiftyTwoWeekHigh),
      volume: getValue(price.regularMarketVolume) || getValue(summary.volume),
      avgVolume: getValue(summary.averageVolume),
    };
    
    // Filter to requested metrics if specified
    if (metrics && metrics.length > 0) {
      const filtered: Record<string, any> = { ticker, name: result.name };
      for (const m of metrics) {
        if (result[m] !== undefined) {
          filtered[m] = result[m];
        }
      }
      return { success: true, data: filtered };
    }
    
    return { success: true, data: result };
    
  } catch (error: any) {
    return { 
      success: false, 
      error: error?.message || 'Failed to fetch stock data',
      ticker 
    };
  }
}
