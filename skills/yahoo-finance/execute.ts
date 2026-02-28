import yahooFinance from 'yahoo-finance2';

export async function execute(args: { ticker: string; metrics?: string[] }, ctx: any) {
  const { ticker, metrics } = args;
  
  try {
    // Get quote summary with financial data
    const quoteSummary = await yahooFinance.quoteSummary(ticker, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData']
    });
    
    const price = quoteSummary.price;
    const summary = quoteSummary.summaryDetail;
    const keyStats = quoteSummary.defaultKeyStatistics;
    const financials = quoteSummary.financialData;
    
    const result: Record<string, any> = {
      ticker: ticker,
      name: price?.shortName || price?.longName || 'N/A',
      exchange: price?.exchange || 'N/A',
      currency: price?.currency || 'USD',
      price: price?.regularMarketPrice || null,
      priceChange: price?.regularMarketChange || null,
      priceChangePercent: price?.regularMarketChangePercent || null,
      peRatio: keyStats?.trailingPE || summary?.trailingPE || null,
      forwardPE: keyStats?.forwardPE || null,
      psRatio: keyStats?.priceToSalesTrailing12Months || keyStats?.priceToSales || null,
      pbRatio: keyStats?.priceToBook || null,
      marketCap: price?.marketCap || summary?.marketCap || null,
      dividendYield: summary?.dividendYield || null,
      eps: keyStats?.trailingEps || financials?.netIncomeToCommon || null,
      revenue: financials?.totalRevenue || null,
      profitMargin: financials?.profitMargins || null,
      fiftyTwoWeekLow: summary?.fiftyTwoWeekLow || null,
      fiftyTwoWeekHigh: summary?.fiftyTwoWeekHigh || null,
      volume: price?.regularMarketVolume || summary?.volume || null,
      avgVolume: summary?.averageVolume || null,
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