// apps/api/src/agents/executor.ts
/**
 * Agent Task Executor
 *
 * Executes individual tasks using the appropriate agent's tools
 */

import type { AssignedTask, AgentExecutionResult } from './deterministicRouter/types.js';
import type { SendEventFn } from './router.js';
import { executeToolWithApprovalBridge } from '../actions/approvalBridge.js';
import { getToolsForLLM } from '../tools/registry.js';
import { llmRouter } from '../llm/router.js';
import { getAgent, getToolsForAgent } from './router.js';
import type { LLMMessage, ToolResult } from '../llm/types.js';
import { getCombinedSystemContextBlock, warmSystemContextForSession } from './systemContext.js';

export interface ExecuteTaskOptions {
  sessionId: string;
  projectRoot: string | null;
  sendEvent: SendEventFn;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTurns?: number;
  maxToolCalls?: number;
  maxDurationMs?: number;
}

/**
 * Execute a single task using the assigned agent
 */
export async function executeAgentTask(
  task: AssignedTask,
  dependencyData: unknown,
  options: ExecuteTaskOptions
): Promise<AgentExecutionResult> {
  const { sessionId, projectRoot, sendEvent, conversationHistory = [], maxTurns, maxToolCalls, maxDurationMs } = options;
  const agent = getAgent(task.agent);
  const agentToolNames = getToolsForAgent(task.agent);
  const tools = getToolsForLLM().filter(t => agentToolNames.includes(t.name));

  // Build focused prompt for this specific task
  const taskPrompt = buildTaskPrompt(task, dependencyData, projectRoot);
  await warmSystemContextForSession(sessionId, projectRoot);
  const systemContextBlock = getCombinedSystemContextBlock(sessionId);

  // Include conversation history for context, then the task prompt
  const messages: LLMMessage[] = [
    ...conversationHistory.map(m => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: taskPrompt },
  ];

  // Run agent with tool use
  const startedAt = Date.now();
  let turn = 0;
  const MAX_TURNS = Math.max(1, maxTurns ?? 5);
  const MAX_TOOL_CALLS = maxToolCalls;
  const MAX_DURATION_MS = maxDurationMs;
  let finalResult: unknown = null;
  let completedNormally = false;
  let lastError: string | undefined;
  let successfulToolCalls = 0;
  let failedToolCalls = 0;

  while (turn < MAX_TURNS) {
    if (typeof MAX_DURATION_MS === 'number' && MAX_DURATION_MS > 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= MAX_DURATION_MS) {
        return {
          success: false,
          data: finalResult,
          error: `Task exceeded time budget (${MAX_DURATION_MS}ms)`,
          uncertain: true,
          uncertaintyReason: 'The task exceeded the allowed time budget. Should I continue?',
          budgetHit: { type: 'time', limit: MAX_DURATION_MS, used: elapsed },
        };
      }
    }
    turn++;

    const response = await llmRouter.generate('anthropic', {
      model: agent.model,
      messages,
      systemPrompt: `${agent.systemPrompt}\n${systemContextBlock}`,
      tools,
      toolsEnabled: true,
    });

    // No more tool calls - we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      finalResult = response.content;
      completedNormally = true;
      break;
    }

    if (typeof MAX_TOOL_CALLS === 'number' && MAX_TOOL_CALLS >= 0) {
      const nextToolCalls = successfulToolCalls + failedToolCalls + response.toolCalls.length;
      if (nextToolCalls > MAX_TOOL_CALLS) {
        return {
          success: false,
          data: finalResult,
          error: `Task exceeded tool-call budget (${MAX_TOOL_CALLS})`,
          uncertain: true,
          uncertaintyReason: 'The task required more tool calls than allowed. Should I continue?',
          budgetHit: { type: 'tool_calls', limit: MAX_TOOL_CALLS, used: successfulToolCalls + failedToolCalls },
        };
      }
    }

    // Add assistant message
    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    // Execute tools
    const toolResults: ToolResult[] = [];

    for (const toolCall of response.toolCalls) {
      sendEvent({
        type: 'tool_call',
        agent: task.agent,
        toolName: toolCall.name,
        args: toolCall.arguments,
      });

      const result = await executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
        onActionPending: (action) => {
          sendEvent({
            type: 'action_pending',
            actionId: action.id,
            toolName: action.toolName,
            toolArgs: action.toolArgs,
            description: action.description,
            preview: action.preview,
          });
        },
      });

      sendEvent({
        type: 'tool_result',
        agent: task.agent,
        toolName: toolCall.name,
        result: result.result,
        success: result.success,
      });

      // Track success/failure
      if (result.success) {
        successfulToolCalls++;
        finalResult = result.result;
      } else {
        failedToolCalls++;
        lastError = result.error;
      }

      toolResults.push({
        toolUseId: toolCall.id,
        result: result.success ? JSON.stringify(result.result) : `Error: ${result.error}`,
        isError: !result.success,
      });
    }

    // Add tool results
    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
  }

  // Determine actual success based on execution
  const hitMaxTurns = turn >= MAX_TURNS && !completedNormally;
  const allToolsFailed = failedToolCalls > 0 && successfulToolCalls === 0;

  if (hitMaxTurns) {
    return {
      success: false,
      data: finalResult,
      error: `Task did not complete within ${MAX_TURNS} turns`,
      uncertain: true,
      uncertaintyReason: 'The task required more steps than allowed. Should I continue?',
      budgetHit: { type: 'turns', limit: MAX_TURNS, used: turn },
    };
  }

  if (allToolsFailed) {
    return {
      success: false,
      error: lastError || 'All tool executions failed',
    };
  }

  return {
    success: true,
    data: finalResult,
  };
}

function buildTaskPrompt(
  task: AssignedTask,
  dependencyData: unknown,
  projectRoot: string | null
): string {
  let prompt = `TASK: ${task.description}`;

  if (dependencyData) {
    prompt += `\n\nContext from previous task:\n${JSON.stringify(dependencyData, null, 2)}`;
  }

  if (projectRoot) {
    prompt += `\n\nWorking directory: ${projectRoot}`;
  }

  prompt += '\n\nExecute this task directly. Do not ask questions unless absolutely necessary.';

  return prompt;
}
