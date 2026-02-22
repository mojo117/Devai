import { llmRouter } from '../llm/router.js';
import type { LLMMessage, LLMProvider, ToolCall, ToolDefinition, ToolResult } from '../llm/types.js';
import type { AgentErrorHandler } from './error-handler.js';
import type { AgentStreamEvent } from './types.js';

export type SubAgentName = 'devo' | 'caio' | 'scout';

export interface SubAgentToolCallContext {
  toolCall: ToolCall;
  turn: number;
}

export interface SubAgentToolCallOutcome {
  toolResult: ToolResult;
  escalated?: string;
}

export interface SubAgentRunConfig {
  sessionId: string;
  agent: SubAgentName;
  provider: LLMProvider;
  model: string;
  objective: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  errorHandler: AgentErrorHandler;
  sendEvent: (event: AgentStreamEvent) => void;
  handleToolCall: (ctx: SubAgentToolCallContext) => Promise<SubAgentToolCallOutcome>;
  maxTurns?: number;
}

export interface SubAgentRunResult {
  exit: 'completed' | 'escalated' | 'llm_error' | 'max_turns';
  finalContent: string;
  turns: number;
  escalationDescription?: string;
  llmError?: string;
}

export class SubAgentRunner {
  async run(config: SubAgentRunConfig): Promise<SubAgentRunResult> {
    const messages: LLMMessage[] = [{ role: 'user', content: config.objective }];
    const maxTurns = config.maxTurns ?? 10;
    let turn = 0;
    let finalContent = '';

    while (turn < maxTurns) {
      turn++;
      config.sendEvent({
        type: 'agent_thinking',
        agent: config.agent,
        status: `Turn ${turn}...`,
      });

      const [response, llmErr] = await config.errorHandler.safe(
        `delegate:${config.sessionId}:${config.agent}:llm:${turn}`,
        () =>
          llmRouter.generateWithFallback(config.provider, {
            model: config.model,
            messages,
            systemPrompt: config.systemPrompt,
            tools: config.tools,
            toolsEnabled: true,
          }),
      );

      if (llmErr) {
        config.sendEvent({
          type: 'error',
          agent: config.agent,
          error: `Sub-agent LLM error: ${llmErr.message}`,
        });
        return {
          exit: 'llm_error',
          finalContent,
          turns: turn,
          llmError: config.errorHandler.formatForLLM(llmErr),
        };
      }

      if (response.content) {
        finalContent = response.content;
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          exit: 'completed',
          finalContent,
          turns: turn,
        };
      }

      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      });

      const toolResults: ToolResult[] = [];

      for (const toolCall of response.toolCalls) {
        const [outcome, outcomeErr] = await config.errorHandler.safe(
          `delegate:${config.sessionId}:${config.agent}:tool:${toolCall.name}:${turn}`,
          () => config.handleToolCall({ toolCall, turn }),
        );

        if (outcomeErr) {
          toolResults.push({
            toolUseId: toolCall.id,
            result: `Error: ${config.errorHandler.formatForLLM(outcomeErr)}`,
            isError: true,
          });
          continue;
        }

        toolResults.push(outcome.toolResult);
        if (outcome.escalated) {
          return {
            exit: 'escalated',
            finalContent,
            turns: turn,
            escalationDescription: outcome.escalated,
          };
        }
      }

      messages.push({
        role: 'user',
        content: '',
        toolResults,
      });
    }

    return {
      exit: 'max_turns',
      finalContent,
      turns: maxTurns,
    };
  }
}
