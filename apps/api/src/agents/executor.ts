// apps/api/src/agents/executor.ts
/**
 * Agent Task Executor
 *
 * Executes individual tasks using the appropriate agent's tools
 */

import type { AssignedTask, AgentExecutionResult } from './deterministicRouter/types.js';
import type { SendEventFn } from './router.js';
import { executeTool } from '../tools/executor.js';
import { getToolsForLLM } from '../tools/registry.js';
import { llmRouter } from '../llm/router.js';
import { getAgent, getToolsForAgent } from './router.js';
import type { LLMMessage, ToolResult } from '../llm/types.js';

export interface ExecuteTaskOptions {
  sessionId: string;
  projectRoot: string | null;
  sendEvent: SendEventFn;
}

/**
 * Execute a single task using the assigned agent
 */
export async function executeAgentTask(
  task: AssignedTask,
  dependencyData: unknown,
  options: ExecuteTaskOptions
): Promise<AgentExecutionResult> {
  const { sessionId, projectRoot, sendEvent } = options;
  const agent = getAgent(task.agent);
  const agentToolNames = getToolsForAgent(task.agent);
  const tools = getToolsForLLM().filter(t => agentToolNames.includes(t.name));

  // Build focused prompt for this specific task
  const taskPrompt = buildTaskPrompt(task, dependencyData, projectRoot);

  const messages: LLMMessage[] = [
    { role: 'user', content: taskPrompt },
  ];

  // Run agent with tool use
  let turn = 0;
  const MAX_TURNS = 5;
  let finalResult: unknown = null;

  while (turn < MAX_TURNS) {
    turn++;

    const response = await llmRouter.generate('anthropic', {
      model: agent.model,
      messages,
      systemPrompt: agent.systemPrompt,
      tools,
      toolsEnabled: true,
    });

    // No more tool calls - we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      finalResult = response.content;
      break;
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

      const result = await executeTool(toolCall.name, toolCall.arguments);

      sendEvent({
        type: 'tool_result',
        agent: task.agent,
        toolName: toolCall.name,
        result: result.result,
        success: result.success,
      });

      toolResults.push({
        toolUseId: toolCall.id,
        result: result.success ? JSON.stringify(result.result) : `Error: ${result.error}`,
        isError: !result.success,
      });

      // Store successful result
      if (result.success) {
        finalResult = result.result;
      }
    }

    // Add tool results
    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
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
