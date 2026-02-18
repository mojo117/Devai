// ──────────────────────────────────────────────
// Looper-AI  –  Searcher Agent
// Handles research, web lookups, documentation.
// ──────────────────────────────────────────────

import type { LooperAgent, AgentContext, AgentResult } from './base-agent.js';
import { executeToolWithApprovalBridge } from '../../actions/approvalBridge.js';
import type { ToolExecutionResult } from '../../tools/executor.js';
import type { LLMProvider } from '../../llm/types.js';
import { llmRouter } from '../../llm/router.js';

export const SEARCH_SYSTEM_PROMPT = `You are Chapo's research agent.
You help gather information, summarise findings, and present them clearly.
When you need to read files for research, use the available file tools.
Always cite your sources when referencing specific files or data.
Organise your findings in a structured way.`;

export class SearcherAgent implements LooperAgent {
  readonly type = 'searcher' as const;
  readonly description = 'Research, search, and information gathering';

  constructor(private provider: LLMProvider) {}

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (ctx.toolName) {
      return this.executeTool(ctx);
    }
    return this.research(ctx);
  }

  private async executeTool(ctx: AgentContext): Promise<AgentResult> {
    const toolResults: ToolExecutionResult[] = [];
    const result = await executeToolWithApprovalBridge(ctx.toolName!, ctx.toolArgs || {}, {
      onActionPending: ctx.onActionPending,
    });
    toolResults.push(result);

    if (result.success) {
      const output = typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result, null, 2);
      return {
        success: true,
        output: `[Searcher] ${ctx.toolName} result:\n${output}`,
        toolResults,
      };
    }

    return {
      success: false,
      output: `[Searcher] ${ctx.toolName} failed: ${result.error}`,
      toolResults,
      needsFollowUp: true,
      followUpHint: `Search tool ${ctx.toolName} failed. Consider alternative lookup.`,
    };
  }

  private async research(ctx: AgentContext): Promise<AgentResult> {
    const messages = [
      { role: 'user' as const, content: this.buildPrompt(ctx) },
    ];

    try {
      const response = await llmRouter.generate(this.provider, {
        messages,
        systemPrompt: SEARCH_SYSTEM_PROMPT,
        maxTokens: 4000,
      });

      return {
        success: true,
        output: response.content,
        needsFollowUp: response.finishReason === 'tool_use',
      };
    } catch (err) {
      return {
        success: false,
        output: `[Searcher] Research failed: ${err instanceof Error ? err.message : String(err)}`,
        needsFollowUp: true,
        followUpHint: 'Research LLM call failed. Retry or try reading files directly.',
      };
    }
  }

  private buildPrompt(ctx: AgentContext): string {
    const parts = [`Research task: ${ctx.userMessage}`];
    if (ctx.previousResults && ctx.previousResults.length > 0) {
      parts.push(`\nGathered so far:\n${ctx.previousResults.join('\n---\n')}`);
    }
    return parts.join('\n');
  }
}
