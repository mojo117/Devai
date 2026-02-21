// ──────────────────────────────────────────────
// Agent Conversation Manager
// Keeps a sliding window of messages within a
// configurable token budget.
// ──────────────────────────────────────────────

import type { LLMMessage } from '../llm/types.js';
import { getTextContent } from '../llm/types.js';

/**
 * Very rough token estimation: ~4 characters per token.
 * This avoids pulling in a full tokenizer dependency while still
 * giving a useful budget guard.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ConversationManager {
  private messages: LLMMessage[] = [];
  private systemPrompt = '';
  private maxTokens: number;

  constructor(maxTokens: number = 120_000) {
    this.maxTokens = maxTokens;
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  addMessage(msg: LLMMessage): void {
    this.messages.push(msg);
    this.trimToTokenBudget();
  }

  /**
   * Replace the most recent assistant message (used when self-validation
   * refines an answer).
   */
  replaceLastAssistant(content: string): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        this.messages[i] = { role: 'assistant', content };
        return;
      }
    }
    // No assistant message found – just append.
    this.addMessage({ role: 'assistant', content });
  }

  getMessages(): LLMMessage[] {
    return [...this.messages];
  }

  /**
   * Returns the current estimated token usage.
   */
  getTokenUsage(): number {
    let total = estimateTokens(this.systemPrompt);
    for (const msg of this.messages) {
      total += estimateTokens(getTextContent(msg.content));
    }
    return total;
  }

  getRemainingTokens(): number {
    return Math.max(0, this.maxTokens - this.getTokenUsage());
  }

  /**
   * Build the full context array the LLM expects:
   * [system-prompt is separate, but we return the conversation messages].
   */
  buildLLMMessages(): LLMMessage[] {
    return this.getMessages();
  }

  /**
   * Create a summary of the conversation for debugging.
   */
  getSummary(): { messageCount: number; estimatedTokens: number; remaining: number } {
    return {
      messageCount: this.messages.length,
      estimatedTokens: this.getTokenUsage(),
      remaining: this.getRemainingTokens(),
    };
  }

  /**
   * Inject a "thinking" trace into the conversation as a system message
   * so the LLM can see its own reasoning on the next turn.
   */
  addThinking(thought: string): void {
    this.addMessage({
      role: 'system',
      content: `[Internal reasoning] ${thought}`,
    });
  }

  clear(): void {
    this.messages = [];
  }

  // ── private ──────────────────────────────

  /**
   * Slide the window: remove the oldest non-system messages (keeping
   * the very first user message for context) until we're within budget.
   * Always keeps at least the last 4 messages so the LLM has enough
   * conversational context.
   */
  private trimToTokenBudget(): void {
    const MIN_KEPT = 4;

    while (this.getTokenUsage() > this.maxTokens && this.messages.length > MIN_KEPT) {
      // Find the oldest message that isn't the very first user message
      const idxToRemove = this.messages.length > MIN_KEPT ? 1 : 0;
      // Summarise what we're about to drop so the LLM doesn't lose all context
      const dropped = this.messages[idxToRemove];
      this.messages.splice(idxToRemove, 1);

      // If we dropped a lot of content, insert a one-liner summary
      if (estimateTokens(getTextContent(dropped.content)) > 500) {
        const summary: LLMMessage = {
          role: 'system',
          content: `[Earlier ${dropped.role} message was trimmed to stay within token budget]`,
        };
        this.messages.splice(idxToRemove, 0, summary);
      }
    }
  }
}
