import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

interface UsageEntry {
  ts: string;
  provider: string;
  model: string;
  agent?: string;
  session?: string;
  input: number;
  output: number;
  costUsd: number;
}

// Prices per million tokens [input, output]
const PRICES: Record<string, [number, number]> = {
  // ZAI
  'glm-5':          [1.00, 3.20],
  'glm-4.7':        [0.60, 2.20],
  'glm-4.7-flash':  [0, 0],
  'glm-4.7-flashx': [0.07, 0.40],
  'glm-4.5-flash':  [0, 0],
  // Anthropic
  'claude-opus-4-5-20251101':  [15, 75],
  'claude-opus-4-20250514':    [15, 75],
  'claude-sonnet-4-20250514':  [3, 15],
  'claude-3-5-haiku-20241022': [0.80, 4],
  // OpenAI
  'gpt-4o':      [2.50, 10],
  'gpt-4o-mini': [0.15, 0.60],
  // Gemini
  'gemini-2.0-flash': [0.10, 0.40],
  'gemini-1.5-pro':   [1.25, 5],
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const prices = PRICES[model];
  if (!prices) return 0;
  return (inputTokens / 1_000_000) * prices[0] + (outputTokens / 1_000_000) * prices[1];
}

const LOG_DIR = '/opt/Devai/var/logs/usage';

function getLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return resolve(LOG_DIR, `${date}.jsonl`);
}

export function logUsage(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  agent?: string,
  session?: string
): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    const entry: UsageEntry = {
      ts: new Date().toISOString(),
      provider,
      model,
      agent,
      session,
      input: inputTokens,
      output: outputTokens,
      costUsd: estimateCost(model, inputTokens, outputTokens),
    };

    appendFileSync(getLogPath(), JSON.stringify(entry) + '\n');
  } catch {
    // Logging must never break the main flow
  }
}
