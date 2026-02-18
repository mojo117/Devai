// ──────────────────────────────────────────────
// Looper-AI  –  Commander Agent
// Handles shell command execution, git, GitHub.
// ──────────────────────────────────────────────

import type { LooperAgent, AgentContext, AgentResult } from './base-agent.js';
import { executeToolWithApprovalBridge } from '../../actions/approvalBridge.js';
import type { ToolExecutionResult } from '../../tools/executor.js';
import type { LLMProvider } from '../../llm/types.js';
import { llmRouter } from '../../llm/router.js';

import { CMD_SYSTEM_PROMPT } from '../../prompts/agent-commander.js';

export class CommanderAgent implements LooperAgent {
  readonly type = 'commander' as const;
  readonly description = 'Execute commands, git operations, GitHub workflows';

  constructor(private provider: LLMProvider) {}

  async execute(ctx: AgentContext): Promise<AgentResult> {
    if (ctx.toolName) {
      return this.executeTool(ctx);
    }
    return this.plan(ctx);
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
        output: `[Commander] ${ctx.toolName} output:\n${output}`,
        toolResults,
      };
    }

    return {
      success: false,
      output: `[Commander] ${ctx.toolName} failed: ${result.error}`,
      toolResults,
      needsFollowUp: true,
      followUpHint: `Command ${ctx.toolName} failed: ${result.error}. Suggest alternative.`,
    };
  }

  private async plan(ctx: AgentContext): Promise<AgentResult> {
    const messages = [
      { role: 'user' as const, content: this.buildPrompt(ctx) },
    ];

    try {
      const response = await llmRouter.generate(this.provider, {
        messages,
        systemPrompt: CMD_SYSTEM_PROMPT,
        maxTokens: 2000,
      });

      return {
        success: true,
        output: response.content,
        needsFollowUp: response.finishReason === 'tool_use',
      };
    } catch (err) {
      return {
        success: false,
        output: `[Commander] Planning failed: ${err instanceof Error ? err.message : String(err)}`,
        needsFollowUp: true,
        followUpHint: 'Commander LLM call failed.',
      };
    }
  }

  private buildPrompt(ctx: AgentContext): string {
    const parts = [`Command task: ${ctx.userMessage}`];
    if (ctx.previousResults && ctx.previousResults.length > 0) {
      parts.push(`\nPrevious results:\n${ctx.previousResults.join('\n---\n')}`);
    }
    return parts.join('\n');
  }
}
