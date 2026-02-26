import { compactMessages } from '../../memory/compaction.js';
import type { ConversationManager } from '../conversation-manager.js';
import type { AgentStreamEvent } from '../types.js';
import { getOtherLoopContexts } from '../stateManager.js';
import type { ParallelLoopEntry } from '../stateManager.js';

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

  /**
   * Build a system message showing what other parallel loops are doing.
   * Returns null if no other loops are active.
   */
  buildParallelContextMessage(turnId: string): string | null {
    const others = getOtherLoopContexts(this.sessionId, turnId);
    if (others.length === 0) return null;

    const loopSections = others.map((entry) => formatLoopEntry(entry));
    const activeCount = others.filter((e) => e.status === 'running').length;
    const completedCount = others.filter((e) => e.status === 'completed').length;
    const parts = [];
    if (activeCount > 0) parts.push(`${activeCount} running`);
    if (completedCount > 0) parts.push(`${completedCount} completed`);

    return [
      `[Parallel Context — ${parts.join(', ')}]`,
      '',
      ...loopSections,
      '[Hinweis: Vermeide Konflikte mit Dateien die andere Loops bearbeiten.]',
    ].join('\n');
  }

}

const MAX_ACTIONS_IN_CONTEXT = 20;

function formatLoopEntry(entry: ParallelLoopEntry): string {
  const promptPreview = entry.originalPrompt.length > 120
    ? entry.originalPrompt.slice(0, 117) + '...'
    : entry.originalPrompt;

  const lines: string[] = [
    `Loop "${entry.taskLabel}" (User: "${promptPreview}"):`,
    `  Status: ${entry.status}`,
  ];

  // Show last N actions
  const actions = entry.actions.slice(-MAX_ACTIONS_IN_CONTEXT);
  for (const action of actions) {
    lines.push(`  - ${action.tool} → ${action.summary}`);
  }

  if (entry.status === 'completed' && entry.finalAnswer) {
    const answer = entry.finalAnswer.length > 200
      ? entry.finalAnswer.slice(0, 197) + '...'
      : entry.finalAnswer;
    lines.push(`  Result: ${answer}`);
  }

  return lines.join('\n');
}
