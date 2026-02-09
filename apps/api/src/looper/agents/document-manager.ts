// ──────────────────────────────────────────────
// Looper-AI  –  Document Manager Agent
// Handles reading, writing, moving, deleting docs.
// ──────────────────────────────────────────────

import type { LooperAgent, AgentContext, AgentResult } from './base-agent.js';
import { executeTool, type ToolExecutionResult } from '../../tools/executor.js';
import type { LLMProvider } from '../../llm/types.js';
import { llmRouter } from '../../llm/router.js';

const DOC_SYSTEM_PROMPT = `You are Chapo's document manager agent.
You handle all file and document operations: reading, writing, listing, organising.
When writing files, always preview the content to the user first.
Be careful with destructive operations – always confirm before overwriting.`;

export class DocumentManagerAgent implements LooperAgent {
  readonly type = 'document_manager' as const;
  readonly description = 'Read, write, move, delete, and organise files/documents';

  constructor(private provider: LLMProvider) {}

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (ctx.toolName) {
      return this.executeTool(ctx);
    }
    return this.plan(ctx);
  }

  private async executeTool(ctx: AgentContext): Promise<AgentResult> {
    const toolResults: ToolExecutionResult[] = [];
    const result = await executeTool(ctx.toolName!, ctx.toolArgs || {});
    toolResults.push(result);

    if (result.success) {
      const output = typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result, null, 2);
      return {
        success: true,
        output: `[DocumentManager] ${ctx.toolName} completed:\n${output}`,
        toolResults,
      };
    }

    return {
      success: false,
      output: `[DocumentManager] ${ctx.toolName} failed: ${result.error}`,
      toolResults,
      needsFollowUp: true,
      followUpHint: `File operation ${ctx.toolName} failed. Check path and permissions.`,
    };
  }

  private async plan(ctx: AgentContext): Promise<AgentResult> {
    const messages = [
      { role: 'user' as const, content: this.buildPrompt(ctx) },
    ];

    try {
      const response = await llmRouter.generate(this.provider, {
        messages,
        systemPrompt: DOC_SYSTEM_PROMPT,
        maxTokens: 3000,
      });

      return {
        success: true,
        output: response.content,
        needsFollowUp: response.finishReason === 'tool_use',
      };
    } catch (err) {
      return {
        success: false,
        output: `[DocumentManager] Planning failed: ${err instanceof Error ? err.message : String(err)}`,
        needsFollowUp: true,
        followUpHint: 'Document manager LLM call failed.',
      };
    }
  }

  private buildPrompt(ctx: AgentContext): string {
    const parts = [`Document task: ${ctx.userMessage}`];
    if (ctx.previousResults && ctx.previousResults.length > 0) {
      parts.push(`\nPrevious results:\n${ctx.previousResults.join('\n---\n')}`);
    }
    return parts.join('\n');
  }
}
