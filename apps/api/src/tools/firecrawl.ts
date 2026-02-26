import { z } from 'zod';
import { StockSchema, StockData, VALIDATION } from '../types/stock.js';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2';

export interface FirecrawlAgentResult {
  success: boolean;
  data?: StockData;
  error?: string;
  responseTimeMs: number;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchStockData(
  stockName: string,
  isin: string,
  wkn: string
): Promise<FirecrawlAgentResult> {
  const startTime = Date.now();

  if (!FIRECRAWL_API_KEY) {
    return { success: false, error: 'FIRECRAWL_API_KEY not set', responseTimeMs: 0 };
  }

  // Step 1: Start agent
  const prompt = `Get stock data for ${stockName} (ISIN: ${isin}) from boerse.de or onvista.de.
Return: symbol, name, peRatio (KGV), psRatio (KUV), dividendYield (percent), price (EUR). Use null if not available.`;

  const schema = {
    type: 'object',
    properties: {
      stocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            name: { type: 'string' },
            peRatio: { type: ['number', 'null'] },
            psRatio: { type: ['number', 'null'] },
            dividendYield: { type: ['number', 'null'] },
            price: { type: 'number' }
          },
          required: ['symbol', 'name', 'price']
        }
      }
    },
    required: ['stocks']
  };

  try {
    console.log(`🔍 Starting agent for ${stockName}...`);
    
    const startRes = await fetch(`${FIRECRAWL_BASE_URL}/agent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt, schema })
    });

    if (!startRes.ok) {
      const text = await startRes.text();
      return { success: false, error: `Start failed: ${startRes.status} ${text}`, responseTimeMs: Date.now() - startTime };
    }

    const { id } = await startRes.json() as { id: string };
    console.log(`   Agent started: ${id}`);

    // Step 2: Poll for result
    while (Date.now() - startTime < 60000) {
      await sleep(2000);
      
      const statusRes = await fetch(`${FIRECRAWL_BASE_URL}/agent/${id}`, {
        headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` }
      });

      if (!statusRes.ok) continue;

      const statusData = await statusRes.json() as {
        status: string;
        data?: { stocks?: Array<{symbol: string; name: string; peRatio?: number | null; psRatio?: number | null; dividendYield?: number | null; price: number}> };
        error?: string;
        creditsUsed?: number;
      };

      if (statusData.status === 'completed' && statusData.data?.stocks?.[0]) {
        const raw = statusData.data.stocks[0];
        const responseTimeMs = Date.now() - startTime;
        
        const stockData: StockData = {
          symbol: raw.symbol,
          name: raw.name,
          isin,
          peRatio: raw.peRatio ?? null,
          psRatio: raw.psRatio ?? null,
          dividendYield: raw.dividendYield ?? null,
          price: raw.price,
          currency: 'EUR',
          source: 'firecrawl-agent',
          timestamp: new Date().toISOString()
        };

        console.log(`✅ ${stockName}: €${stockData.price}, KGV=${stockData.peRatio ?? 'N/A'} (${responseTimeMs}ms, ${statusData.creditsUsed} credits)`);
        
        return { success: true, data: stockData, responseTimeMs };
      }

      if (statusData.status === 'failed') {
        return { success: false, error: statusData.error || 'Agent failed', responseTimeMs: Date.now() - startTime };
      }
    }

    return { success: false, error: 'Timeout after 60s', responseTimeMs: 60000 };

  } catch (error) {
    return { success: false, error: String(error), responseTimeMs: Date.now() - startTime };
  }
}

export async function fetchMultipleStocks(
  stocks: Array<{ name: string; isin: string; wkn: string }>
): Promise<Array<FirecrawlAgentResult & { stock: typeof stocks[0] }>> {
  const results = [];
  for (const stock of stocks) {
    const result = await fetchStockData(stock.name, stock.isin, stock.wkn);
    results.push({ ...result, stock });
    await sleep(1000);
  }
  return results;
}
