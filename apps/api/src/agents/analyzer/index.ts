// apps/api/src/agents/analyzer/index.ts
import { llmRouter } from '../../llm/router.js';
import { CapabilityAnalysisSchema, type CapabilityAnalysis, type AnalyzerResult } from './types.js';
import { ANALYZER_SYSTEM_PROMPT, ANALYZER_USER_TEMPLATE } from './prompt.js';

/**
 * Analyze a user request to determine required capabilities
 */
export async function analyzeRequest(
  userMessage: string,
  projectContext?: string
): Promise<AnalyzerResult> {
  const start = Date.now();

  try {
    const response = await llmRouter.generate('anthropic', {
      model: 'claude-3-5-haiku-20241022', // Fast, cheap model for classification
      messages: [
        { role: 'user', content: ANALYZER_USER_TEMPLATE(userMessage, projectContext) },
      ],
      systemPrompt: ANALYZER_SYSTEM_PROMPT,
      maxTokens: 1024,
    });

    const analysis = parseAnalysisResponse(response.content, userMessage);

    return {
      analysis,
      rawResponse: response.content,
      model: 'claude-3-5-haiku-20241022',
      durationMs: Date.now() - start,
    };
  } catch (error) {
    console.error('[analyzer] LLM call failed, using fallback', error);

    return {
      analysis: keywordFallback(userMessage),
      rawResponse: '',
      model: 'fallback',
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Parse and validate the LLM response
 */
function parseAnalysisResponse(content: string, originalMessage: string): CapabilityAnalysis {
  try {
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[analyzer] No JSON found in response, using fallback');
      return keywordFallback(originalMessage);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validated = CapabilityAnalysisSchema.parse(parsed);
    return validated;
  } catch (error) {
    console.warn('[analyzer] Failed to parse response, using fallback', error);
    return keywordFallback(originalMessage);
  }
}

/**
 * Fallback keyword-based analysis when LLM fails
 */
export function keywordFallback(message: string): CapabilityAnalysis {
  const needs = {
    web_search: /weather|news|current|latest|search|find online|documentation|tutorial|how to/i.test(message),
    code_read: /read|show|display|what is|explain|understand|analyze|review|check/i.test(message),
    code_write: /create|write|add|edit|modify|change|fix|update|implement|refactor/i.test(message),
    devops: /git|commit|push|pull|deploy|npm|install|pm2|restart|build|run/i.test(message),
    clarification: false,
  };

  // Determine primary capability for task
  let capability: 'web_search' | 'code_read' | 'code_write' | 'devops' = 'code_read';
  if (needs.web_search) capability = 'web_search';
  else if (needs.code_write) capability = 'code_write';
  else if (needs.devops) capability = 'devops';

  return {
    needs,
    tasks: [{ description: message, capability }],
    confidence: 'low',
  };
}

export * from './types.js';
