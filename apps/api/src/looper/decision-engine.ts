// ──────────────────────────────────────────────
// Looper-AI  –  Decision Engine
// Classifies incoming events and decides the
// next action: tool_call, clarify, or answer.
// ──────────────────────────────────────────────

import type { DecisionResult, LooperEvent, AgentType } from '@devai/shared';
import type { LLMProvider } from '../llm/types.js';
import { llmRouter } from '../llm/router.js';
import { ConversationManager } from './conversation-manager.js';
import { normalizeToolName } from '../tools/registry.js';

import { DECISION_SYSTEM_PROMPT } from '../prompts/decision-engine.js';

export class DecisionEngine {
  constructor(private provider: LLMProvider) {}

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
        systemPrompt: DECISION_SYSTEM_PROMPT,
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

      return {
        intent,
        agent: agent ?? undefined,
        toolName: typeof parsed.toolName === 'string' ? normalizeToolName(parsed.toolName) : undefined,
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

  private fallbackDecision(raw: string): DecisionResult {
    // If we can't parse structured output, treat the entire response as an answer.
    return {
      intent: 'answer',
      answerText: raw,
      reasoning: 'Could not parse structured decision – treating LLM output as direct answer.',
    };
  }
}
