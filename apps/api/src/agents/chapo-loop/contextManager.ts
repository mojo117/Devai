import { compactMessages } from '../../memory/compaction.js';
import type { ConversationManager } from '../conversation-manager.js';
import type { AgentStreamEvent } from '../types.js';

const COMPACTION_THRESHOLD = 160_000;

export class ChapoLoopContextManager {
  private originalUserMessage = '';

  constructor(
    private sessionId: string,
    private sendEvent: (event: AgentStreamEvent) => void,
    private conversation: ConversationManager,
  ) {}

  dispose(): void {
    // no-op — inbox lifecycle removed (simple queue model)
  }

  setPinnedRequest(userMessage: string): void {
    this.originalUserMessage = userMessage;
  }

  async checkAndCompact(): Promise<void> {
    const usage = this.conversation.getTokenUsage();

    if (usage < COMPACTION_THRESHOLD) return;

    const messages = this.conversation.getMessages();
    // Compact the oldest ~60% of messages
    const compactCount = Math.floor(messages.length * 0.6);
    if (compactCount < 2) return;

    const toCompact = messages.slice(0, compactCount);
    const toKeep = messages.slice(compactCount);

    const result = await compactMessages(toCompact, this.sessionId);

    // If compaction LLM call failed, keep original context to avoid drift
    if (result.failed) {
      this.sendEvent({
        type: 'agent_thinking',
        agent: 'chapo',
        status: 'Compaction failed — keeping original context',
      });
      return;
    }

    // Replace conversation: summary + kept messages
    this.conversation.clear();
    this.conversation.addMessage({
      role: 'system',
      content: `[Context compacted — ${result.droppedTokens} tokens summarized]\n\n${result.summary}`,
    });

    // Pin original user request so CHAPO never loses the goal (Ralph spec pinning)
    if (this.originalUserMessage) {
      this.conversation.addMessage({
        role: 'system',
        content: `[ORIGINAL REQUEST — pinned]\n${this.originalUserMessage}`,
      });
    }

    for (const msg of toKeep) {
      this.conversation.addMessage(msg);
    }

    this.sendEvent({
      type: 'agent_thinking',
      agent: 'chapo',
      status: `Context kompaktiert: ${result.droppedTokens} → ${result.summaryTokens} Tokens`,
    });
  }

}
