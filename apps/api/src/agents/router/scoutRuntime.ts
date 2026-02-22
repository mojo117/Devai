import { llmRouter } from '../../llm/router.js';
import type { LLMMessage } from '../../llm/types.js';
import { executeToolWithApprovalBridge } from '../../actions/approvalBridge.js';
import { getCombinedSystemContextBlock } from '../systemContext.js';
import { getToolsForLLM } from '../../tools/registry.js';
import type { ScoutResult, ScoutScope } from '../types.js';
import { getAgent, getToolsForAgent } from './agentAccess.js';
import { buildToolResultContent } from './requestUtils.js';
import type { SendEventFn } from './shared.js';

/**
 * Spawn SCOUT agent for exploration or web search
 */
export async function spawnScout(
  sessionId: string,
  query: string,
  options: {
    scope?: ScoutScope;
    context?: string;
    sendEvent?: SendEventFn;
  } = {},
): Promise<ScoutResult> {
  const { scope = 'both', context, sendEvent } = options;

  console.info('[agents] Spawning SCOUT', { sessionId, query, scope });

  sendEvent?.({ type: 'scout_start', query, scope });

  const scout = getAgent('scout');
  const systemContextBlock = getCombinedSystemContextBlock(sessionId);
  const scoutToolNames = getToolsForAgent('scout');
  const tools = getToolsForLLM().filter((t) => scoutToolNames.includes(t.name));

  // Build focused prompt based on scope
  let prompt = `EXPLORE: ${query}`;

  if (scope === 'codebase') {
    prompt += '\n\nFOKUS: Nur Codebase-Exploration. Nutze KEINE Web-Tools (web_search, web_fetch, scout_search_fast, scout_search_deep, scout_site_map, scout_crawl_focused, scout_extract_schema).';
  } else if (scope === 'web') {
    prompt += '\n\nFOKUS: Nur Web-Recherche. Nutze KEINE Dateisystem-Tools.';
  } else {
    prompt += '\n\nFOKUS: Kombiniere Codebase-Exploration und Web-Recherche für beste Ergebnisse.';
  }

  if (context) {
    prompt += `\n\nZUSÄTZLICHER KONTEXT: ${context}`;
  }

  const messages: LLMMessage[] = [{ role: 'user', content: prompt }];

  // Run SCOUT with limited turns
  let turn = 0;
  const MAX_TURNS = 5;
  let finalContent = '';

  while (turn < MAX_TURNS) {
    turn++;

    const response = await llmRouter.generateWithFallback('zai', {
      model: scout.model,
      messages,
      systemPrompt: `${scout.systemPrompt}\n${systemContextBlock}`,
      tools,
      toolsEnabled: true,
    });

    if (response.content) {
      finalContent = response.content;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

    for (const toolCall of response.toolCalls) {
      // Emit scout_tool event
      sendEvent?.({ type: 'scout_tool', tool: toolCall.name });

      // Check for escalation
      if (toolCall.name === 'escalateToChapo') {
        // SCOUT is escalating - return partial results
        const result = parseScoutResult(finalContent);
        result.recommendations.push('SCOUT eskalierte zu CHAPO - weitere Analyse erforderlich');
        sendEvent?.({ type: 'scout_complete', summary: result });
        return result;
      }

      const result = await executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
        agentName: 'scout',
        onActionPending: (action) => {
          sendEvent?.({
            type: 'action_pending',
            actionId: action.id,
            toolName: action.toolName,
            toolArgs: action.toolArgs,
            description: action.description,
            preview: action.preview,
          });
        },
      });

      const toolResult = buildToolResultContent(result);
      toolResults.push({
        toolUseId: toolCall.id,
        result: toolResult.content,
        isError: toolResult.isError,
      });
    }

    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
  }

  // Parse SCOUT's JSON response
  const result = parseScoutResult(finalContent);

  sendEvent?.({ type: 'scout_complete', summary: result });

  console.info('[agents] SCOUT complete', {
    sessionId,
    filesFound: result.relevantFiles.length,
    confidence: result.confidence,
  });

  return result;
}

/**
 * Parse SCOUT's response into a ScoutResult
 */
function parseScoutResult(response: string): ScoutResult {
  // Try to extract JSON from response
  const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) ||
                    response.match(/\{[\s\S]*"summary"[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr) as {
        summary?: string;
        relevantFiles?: string[];
        codePatterns?: Record<string, string>;
        webFindings?: Array<{
          title?: string;
          url?: string;
          relevance?: string;
          claim?: string;
          evidence?: Array<{ url?: string; snippet?: string; publishedAt?: string }>;
          freshness?: string;
          confidence?: 'high' | 'medium' | 'low';
          gaps?: string[];
        }>;
        recommendations?: string[];
        confidence?: 'high' | 'medium' | 'low';
      };

      return {
        summary: parsed.summary || 'Keine Zusammenfassung verfügbar',
        relevantFiles: parsed.relevantFiles || [],
        codePatterns: parsed.codePatterns || {},
        webFindings: (parsed.webFindings || []).map((f) => ({
          title: f.title || 'Unbekannt',
          url: f.url || '',
          relevance: f.relevance || f.claim || '',
          claim: f.claim,
          evidence: Array.isArray(f.evidence)
            ? f.evidence
              .filter((item) => item && typeof item.url === 'string' && item.url.trim().length > 0)
              .map((item) => ({
                url: item.url as string,
                snippet: typeof item.snippet === 'string' ? item.snippet : undefined,
                publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : undefined,
              }))
            : undefined,
          freshness: f.freshness,
          confidence: f.confidence,
          gaps: Array.isArray(f.gaps) ? f.gaps.filter((item) => typeof item === 'string') as string[] : undefined,
        })),
        recommendations: parsed.recommendations || [],
        confidence: parsed.confidence || 'medium',
      };
    } catch (e) {
      console.warn('[agents] Failed to parse SCOUT JSON response:', e);
    }
  }

  // Fallback: return raw response as summary
  return {
    summary: response,
    relevantFiles: [],
    codePatterns: {},
    webFindings: [],
    recommendations: [],
    confidence: 'low',
  };
}
