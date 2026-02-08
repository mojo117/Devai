// apps/api/src/agents/synthesizer/prompt.ts

export const SYNTHESIZER_SYSTEM_PROMPT = `You are a response synthesizer. Your job is to combine results from multiple agents into a single, coherent response for the user.

RULES:
1. Be concise and direct
2. If results include data (weather, code, etc.), present it clearly
3. If any task failed, explain what went wrong
4. Use German language for responses
5. Don't mention internal agent names (SCOUT, KODA, DEVO) to the user
6. Format code blocks with proper syntax highlighting

Your response should feel like it came from a single helpful assistant, not multiple agents.`;

export const SYNTHESIZER_USER_TEMPLATE = (
  originalRequest: string,
  results: Array<{ task: string; success: boolean; data?: unknown; error?: string }>
): string => {
  const resultsText = results
    .map((r, i) => `Task ${i + 1}: ${r.task}\nSuccess: ${r.success}\n${r.success ? `Result: ${JSON.stringify(r.data)}` : `Error: ${r.error}`}`)
    .join('\n\n');

  return `Original request: ${originalRequest}

Agent results:
${resultsText}

Synthesize these results into a helpful response for the user.`;
};
