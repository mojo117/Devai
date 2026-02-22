import { compactMessages } from '../../memory/compaction.js';
import { drainInbox, offInboxMessage, onInboxMessage } from '../inbox.js';
import type { ConversationManager } from '../conversation-manager.js';
import type { AgentStreamEvent, InboxMessage } from '../types.js';

const COMPACTION_THRESHOLD = 160_000;

export class ChapoLoopContextManager {
  private hasInboxMessages = false;
  private inboxHandler: ((msg: InboxMessage) => void) | null = null;
  private originalUserMessage = '';

  constructor(
    private sessionId: string,
    private sendEvent: (event: AgentStreamEvent) => void,
    private conversation: ConversationManager,
  ) {
    // Subscribe to inbox events for reactive awareness
    this.inboxHandler = (msg: InboxMessage) => {
      this.hasInboxMessages = true;
      this.sendEvent({
        type: 'message_queued',
        messageId: msg.id,
        preview: 'Got it — I\'ll handle that too',
      });
    };
    onInboxMessage(this.sessionId, this.inboxHandler);
  }

  dispose(): void {
    if (this.inboxHandler) {
      offInboxMessage(this.sessionId, this.inboxHandler);
      this.inboxHandler = null;
    }
  }

  setPinnedRequest(userMessage: string): void {
    this.originalUserMessage = userMessage;
  }

  checkInbox(): boolean {
    // Always check the actual inbox — the reactive hasInboxMessages flag
    // can miss messages queued before the handler was registered.
    const messages = drainInbox(this.sessionId);
    this.hasInboxMessages = false;

    if (messages.length === 0) return false;

    for (const msg of messages) {
      this.conversation.addMessage({
        role: 'user',
        content: msg.content,
      });
    }

    this.sendEvent({ type: 'inbox_processing', count: messages.length });
    return true;
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

  drainRemainingMessages(): InboxMessage[] {
    return drainInbox(this.sessionId);
  }
}
