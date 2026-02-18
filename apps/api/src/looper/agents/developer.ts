// ──────────────────────────────────────────────
// Looper-AI  –  Developer Agent
// Handles code generation, editing, building.
// ──────────────────────────────────────────────

import type { LooperAgent, AgentContext, AgentResult } from './base-agent.js';
import { executeToolWithApprovalBridge } from '../../actions/approvalBridge.js';
import type { ToolExecutionResult } from '../../tools/executor.js';
import type { LLMProvider } from '../../llm/types.js';
import { llmRouter } from '../../llm/router.js';

import { DEV_SYSTEM_PROMPT } from '../../prompts/agent-developer.js';

export class DeveloperAgent implements LooperAgent {
  readonly type = 'developer' as const;
  readonly description = 'Code generation, editing, building, and testing';

  constructor(private provider: LLMProvider) {}

  async execute(ctx: AgentContext): Promise<AgentResult> {
    // If a specific tool was requested, execute it directly
    if (ctx.toolName) {
      return this.executeTool(ctx);
    }

    // Otherwise, ask the LLM to reason about the development task
    return this.reason(ctx);
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
        output: `[Developer] Tool ${ctx.toolName} executed successfully:\n${output}`,
        toolResults,
      };
    }

    return {
      success: false,
      output: `[Developer] Tool ${ctx.toolName} failed: ${result.error}`,
      toolResults,
      needsFollowUp: true,
      followUpHint: `Tool ${ctx.toolName} failed with: ${result.error}. Try an alternative approach.`,
    };
  }

  private async reason(ctx: AgentContext): Promise<AgentResult> {
    const messages = [
      { role: 'user' as const, content: this.buildPrompt(ctx) },
    ];

    try {
      const response = await llmRouter.generate(this.provider, {
        messages,
        systemPrompt: DEV_SYSTEM_PROMPT,
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
        output: `[Developer] Reasoning failed: ${err instanceof Error ? err.message : String(err)}`,
        needsFollowUp: true,
        followUpHint: 'LLM call failed for developer reasoning. Retry or switch approach.',
      };
    }
  }

  private buildPrompt(ctx: AgentContext): string {
    const parts = [`Task: ${ctx.userMessage}`];
    if (ctx.previousResults && ctx.previousResults.length > 0) {
      parts.push(`\nPrevious results:\n${ctx.previousResults.join('\n---\n')}`);
    }
    return parts.join('\n');
  }
}
