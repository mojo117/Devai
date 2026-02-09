// ──────────────────────────────────────────────
// Looper-AI  –  Developer Agent
// Handles code generation, editing, building.
// ──────────────────────────────────────────────

import type { LooperAgent, AgentContext, AgentResult } from './base-agent.js';
import { executeTool, type ToolExecutionResult } from '../../tools/executor.js';
import type { LLMProvider } from '../../llm/types.js';
import { llmRouter } from '../../llm/router.js';

const DEV_SYSTEM_PROMPT = `You are Chapo's developer agent.
You receive a development task and tool results, and produce code or technical output.
Be precise, write clean code, and explain your changes briefly.
If you need to read or write files, produce the tool calls described in your response.
Always think step by step before writing code.`;

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

    const result = await executeTool(ctx.toolName!, ctx.toolArgs || {});
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
