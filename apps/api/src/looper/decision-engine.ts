// ──────────────────────────────────────────────
// Looper-AI  –  Decision Engine
// Classifies incoming events and decides the
// next action: tool_call, clarify, or answer.
// ──────────────────────────────────────────────

import type { DecisionResult, LooperEvent, AgentType } from '@devai/shared';
import type { LLMProvider } from '../llm/types.js';
import { llmRouter } from '../llm/router.js';
import { ConversationManager } from './conversation-manager.js';
import { normalizeToolName, isToolWhitelisted } from '../tools/registry.js';
import { mcpManager } from '../mcp/index.js';

import { DECISION_SYSTEM_PROMPT } from '../prompts/decision-engine.js';

export class DecisionEngine {
  constructor(private provider: LLMProvider) {}

  /**
   * Build the full system prompt including dynamically registered MCP tools.
   */
  private buildSystemPrompt(): string {
    const mcpToolDefs = mcpManager.getToolDefinitions();
    if (mcpToolDefs.length === 0) return DECISION_SYSTEM_PROMPT;

    // Group MCP tools by server (extract from description prefix "[servername]")
    const mcpSection = mcpToolDefs
      .map(t => `  ${t.name} – ${t.description}`)
      .join('\n');

    return DECISION_SYSTEM_PROMPT + `\n\nZusätzlich verfügbare MCP-Tools (auch als toolName verwendbar):\n${mcpSection}\n\nBei MCP-Tools verwende den EXAKTEN Namen mit "mcp_" Präfix wie oben gelistet (z.B. "mcp_serena_find_symbol").`;
  }

  /**
   * Given the full conversation context and the latest event, classify
   * what the loop should do next.
   */
  async decide(
    conversation: ConversationManager,
    latestEvent: LooperEvent
  ): Promise<DecisionResult> {
    const eventDescription = this.describeEvent(latestEvent);

    const prompt = [
      '## Latest Event',
      eventDescription,
      '',
      '## Conversation Token Budget',
      `Used: ~${conversation.getTokenUsage()} tokens, Remaining: ~${conversation.getRemainingTokens()} tokens`,
      '',
      'Decide the next action. Respond with JSON only.',
    ].join('\n');

    // Add the decision prompt as a user message but don't persist it
    const messages = [
      ...conversation.buildLLMMessages(),
      { role: 'user' as const, content: prompt },
    ];

    try {
      const response = await llmRouter.generate(this.provider, {
        messages,
        systemPrompt: this.buildSystemPrompt(),
        maxTokens: 1000,
      });

      return this.parseDecision(response.content);
    } catch (err) {
      // If the LLM call fails, default to asking for clarification
      return {
        intent: 'answer',
        answerText: `I encountered an issue while processing: ${err instanceof Error ? err.message : String(err)}. Let me try a different approach.`,
        reasoning: 'LLM decision call failed – returning error context as answer.',
      };
    }
  }

  private describeEvent(event: LooperEvent): string {
    switch (event.type) {
      case 'user_message':
        return `User said: "${String(event.payload)}"`;
      case 'tool_result':
        return `Tool result received:\n${JSON.stringify(event.payload, null, 2).slice(0, 2000)}`;
      case 'agent_result':
        return `Agent "${event.sourceAgent}" returned:\n${JSON.stringify(event.payload, null, 2).slice(0, 2000)}`;
      case 'error':
        return `Error occurred: ${JSON.stringify(event.payload)}`;
      case 'clarification_response':
        return `User clarification: "${String(event.payload)}"`;
      case 'self_validation':
        return `Self-validation result: ${JSON.stringify(event.payload)}`;
      case 'system':
        return `System event: ${String(event.payload)}`;
      default:
        return `Unknown event type: ${event.type}`;
    }
  }

  private parseDecision(raw: string): DecisionResult {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.fallbackDecision(raw);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const intent = this.validIntent(parsed.intent);
      const agent = this.validAgent(parsed.agent);

      const toolName = typeof parsed.toolName === 'string'
        ? this.sanitizeToolName(normalizeToolName(parsed.toolName))
        : undefined;

      return {
        intent,
        agent: agent ?? undefined,
        toolName,
        toolArgs: parsed.toolArgs ?? undefined,
        clarificationQuestion: parsed.clarificationQuestion ?? undefined,
        answerText: parsed.answerText ?? undefined,
        reasoning: parsed.reasoning ?? undefined,
      };
    } catch {
      return this.fallbackDecision(raw);
    }
  }

  private validIntent(value: unknown): DecisionResult['intent'] {
    const allowed = ['tool_call', 'clarify', 'answer', 'self_validate', 'continue'];
    if (typeof value === 'string' && allowed.includes(value)) {
      return value as DecisionResult['intent'];
    }
    return 'answer';
  }

  private validAgent(value: unknown): AgentType | null {
    const allowed = ['developer', 'searcher', 'document_manager', 'commander'];
    if (typeof value === 'string' && allowed.includes(value)) {
      return value as AgentType;
    }
    return null;
  }

  /**
   * Fix hallucinated tool names.
   * LLMs sometimes invent MCP-style names like "mcp_web_mcp_search" instead of "web_search".
   * This method tries to recover the correct tool name.
   */
  private sanitizeToolName(name: string): string {
    // Already valid – return as-is
    if (isToolWhitelisted(name)) return name;

    // Known hallucination patterns → correct tool name
    const TOOL_CORRECTIONS: Record<string, string> = {
      'mcp_web_mcp_search': 'web_search',
      'mcp_web_search': 'web_search',
      'mcp_web_mcp_fetch': 'web_fetch',
      'mcp_web_fetch': 'web_fetch',
      'mcp_fs_mcp_readFile': 'fs_readFile',
      'mcp_fs_mcp_writeFile': 'fs_writeFile',
      'mcp_fs_mcp_listFiles': 'fs_listFiles',
      'mcp_git_mcp_status': 'git_status',
      'mcp_git_mcp_diff': 'git_diff',
      'mcp_memory_mcp_remember': 'memory_remember',
      'mcp_memory_mcp_search': 'memory_search',
    };

    if (TOOL_CORRECTIONS[name]) {
      console.warn(`[decision-engine] Corrected hallucinated tool name: "${name}" → "${TOOL_CORRECTIONS[name]}"`);
      return TOOL_CORRECTIONS[name];
    }

    // Generic fix: strip "mcp_" prefix and "_mcp" infix, then check
    if (name.startsWith('mcp_')) {
      const stripped = name
        .replace(/^mcp_/, '')     // Remove leading mcp_
        .replace(/_mcp_/g, '_')   // Remove _mcp_ infix
        .replace(/_mcp$/g, '');   // Remove trailing _mcp
      if (isToolWhitelisted(stripped)) {
        console.warn(`[decision-engine] Corrected hallucinated tool name: "${name}" → "${stripped}"`);
        return stripped;
      }
    }

    // Return as-is – executor will handle the "not whitelisted" error
    console.warn(`[decision-engine] Unknown tool name: "${name}" – could not auto-correct`);
    return name;
  }

  private fallbackDecision(raw: string): DecisionResult {
    // If we can't parse structured output, treat the entire response as an answer.
    return {
      intent: 'answer',
      answerText: raw,
      reasoning: 'Could not parse structured decision – treating LLM output as direct answer.',
    };
  }
}
