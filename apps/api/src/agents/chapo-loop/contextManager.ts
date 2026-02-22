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

  checkInbox(): void {
    if (!this.hasInboxMessages) return;
    this.hasInboxMessages = false;

    const messages = drainInbox(this.sessionId);
    if (messages.length === 0) return;

    const inboxBlock = messages
      .map(
        (m, i) => `[New message #${i + 1} from user while you were working]: "${m.content}"`,
      )
      .join('\n');

    this.conversation.addMessage({
      role: 'system',
      content:
        `${inboxBlock}\n\n` +
        `Classify each new message:\n` +
        `- PARALLEL: Independent task -> use delegateParallel or handle after current task\n` +
        `- AMENDMENT: Replaces/changes current task -> decide: abort (if early) or finish-then-pivot\n` +
        `- EXPANSION: Adds to current task scope -> integrate into current plan\n` +
        `Acknowledge each message to the user in your response.`,
    });

    this.sendEvent({ type: 'inbox_processing', count: messages.length });
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
