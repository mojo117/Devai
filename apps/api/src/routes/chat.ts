import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { ChatMessage, ChatResponse } from '@devai/shared';
import { llmRouter } from '../llm/router.js';
import type { LLMMessage, ToolCall } from '../llm/types.js';
import { getToolsForLLM, toolRequiresConfirmation, getToolDefinition } from '../tools/registry.js';
import { executeTool } from '../tools/executor.js';
import { createAction, getPendingActions } from '../actions/manager.js';
import { logToolExecution } from '../audit/logger.js';
import { config } from '../config.js';
import { getProjectContext } from '../scanner/projectScanner.js';

const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    timestamp: z.string(),
  })),
  provider: z.enum(['anthropic', 'openai', 'gemini']),
  projectRoot: z.string().optional(),
});

// System prompt for the AI assistant
const SYSTEM_PROMPT = `You are DevAI, an AI developer assistant. You help users with code-related tasks.

You have access to the following tools:
- fs.listFiles(path): List files in a directory
- fs.readFile(path): Read file contents
- fs.writeFile(path, content): Write content to a file (REQUIRES USER CONFIRMATION)
- git.status(): Show git status
- git.diff(): Show git diff
- git.commit(message): Create a git commit (REQUIRES USER CONFIRMATION)
- github.triggerWorkflow(workflow, ref, inputs): Trigger a GitHub Actions workflow (REQUIRES USER CONFIRMATION)
- github.getWorkflowRunStatus(runId): Get workflow run status
- logs.getStagingLogs(lines): Get staging environment logs
- askForConfirmation(toolName, toolArgs, description): Request approval for a tool that requires confirmation (returns actionId)

IMPORTANT: For tools that require confirmation, first call askForConfirmation with the tool name and args. Only proceed after user approval.

Focus on solving the user's problem efficiently while being transparent about any changes you want to make.`;

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.post('/chat', async (request, reply) => {
    const parseResult = ChatRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const { messages, provider, projectRoot: requestedProjectRoot } = parseResult.data;

    // Check if provider is configured
    if (!llmRouter.isProviderConfigured(provider)) {
      return reply.status(400).send({
        error: `Provider ${provider} is not configured. Please set the API key in .env`,
      });
    }

    try {
      // Convert messages to LLM format
      const llmMessages: LLMMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const projectRoot = config.projectRoot || requestedProjectRoot;
      const projectContext = projectRoot ? await getProjectContext(projectRoot) : null;
      const projectContextBlock = projectContext
        ? `\n\nProject Context:\n${projectContext.summary}`
        : '';

      // Get available tools
      const tools = getToolsForLLM();

      // Generate response from LLM
      const llmResponse = await llmRouter.generate(provider, {
        messages: llmMessages,
        systemPrompt: SYSTEM_PROMPT + projectContextBlock,
        toolsEnabled: true,
        tools,
      });

      // Process tool calls if any
      let responseContent = llmResponse.content;
      const toolResults: string[] = [];

      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        for (const toolCall of llmResponse.toolCalls) {
          const result = await handleToolCall(toolCall);
          toolResults.push(result);
        }

        // Append tool results to response
        if (toolResults.length > 0) {
          responseContent += '\n\n' + toolResults.join('\n\n');
        }
      }

      const responseMessage: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: responseContent,
        timestamp: new Date().toISOString(),
      };

      // Get current pending actions
      const pendingActions = getPendingActions();

      const response: ChatResponse = {
        message: responseMessage,
        pendingActions,
      };

      return response;
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({
        error: 'Failed to generate response',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};

async function handleToolCall(toolCall: ToolCall): Promise<string> {
  const toolName = toolCall.name;
  const toolArgs = toolCall.arguments;
  const toolDef = getToolDefinition(toolName);

  if (!toolDef) {
    return `Error: Unknown tool "${toolName}"`;
  }

  if (toolName === 'askForConfirmation') {
    const requestedToolName = toolArgs.toolName as string | undefined;
    const requestedToolArgs = toolArgs.toolArgs as Record<string, unknown> | undefined;
    const description = (toolArgs.description as string | undefined) ||
      (requestedToolName ? generateActionDescription(requestedToolName, requestedToolArgs || {}) : 'Requested action');

    if (!requestedToolName || !requestedToolArgs) {
      return 'Error: askForConfirmation requires toolName and toolArgs';
    }

    if (!getToolDefinition(requestedToolName)) {
      return `Error: Unknown tool "${requestedToolName}"`;
    }

    if (!toolRequiresConfirmation(requestedToolName)) {
      return `Error: Tool "${requestedToolName}" does not require confirmation`;
    }

    const action = createAction({
      id: nanoid(),
      toolName: requestedToolName,
      toolArgs: requestedToolArgs,
      description,
    });

    return `Action created: **${description}**\n\nThis action requires your approval before it can be executed. Please review and approve it in the Actions panel.\n\nAction ID: \`${action.id}\``;
  }

  // Enforce confirmation flow for restricted tools
  if (toolRequiresConfirmation(toolName)) {
    return `Error: Tool "${toolName}" requires confirmation. Use askForConfirmation first.`;
  }

  // Execute the tool immediately
  const result = await executeTool(toolName, toolArgs);

  // Log the execution
  await logToolExecution(toolName, toolArgs, result);

  if (result.success) {
    return formatToolResult(toolName, result.result);
  } else {
    return `Error executing ${toolName}: ${result.error}`;
  }
}

function generateActionDescription(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'fs.writeFile':
      return `Write to file: ${args.path}`;
    case 'git.commit':
      return `Git commit: "${args.message}"`;
    case 'github.triggerWorkflow':
      return `Trigger workflow: ${args.workflow} on ${args.ref}`;
    default:
      return `Execute: ${toolName}`;
  }
}

function formatToolResult(toolName: string, result: unknown): string {
  if (result === null || result === undefined) {
    return `${toolName} completed successfully.`;
  }

  if (typeof result === 'string') {
    return result;
  }

  // Handle specific tool results
  switch (toolName) {
    case 'fs.listFiles': {
      const r = result as { path: string; files: Array<{ name: string; type: string }> };
      const files = r.files.map((f) => `${f.type === 'directory' ? '📁' : '📄'} ${f.name}`);
      return `**Files in ${r.path}:**\n${files.join('\n')}`;
    }

    case 'fs.readFile': {
      const r = result as { path: string; content: string; size: number };
      const preview = r.content.length > 500 ? r.content.substring(0, 500) + '\n...' : r.content;
      return `**${r.path}** (${r.size} bytes):\n\`\`\`\n${preview}\n\`\`\``;
    }

    case 'git.status': {
      const r = result as {
        branch: string;
        staged: string[];
        modified: string[];
        untracked: string[];
      };
      const lines = [`Branch: ${r.branch}`];
      if (r.staged.length) lines.push(`Staged: ${r.staged.join(', ')}`);
      if (r.modified.length) lines.push(`Modified: ${r.modified.join(', ')}`);
      if (r.untracked.length) lines.push(`Untracked: ${r.untracked.join(', ')}`);
      return `**Git Status:**\n${lines.join('\n')}`;
    }

    case 'git.diff': {
      const r = result as { diff: string; filesChanged: number };
      const preview = r.diff.length > 1000 ? r.diff.substring(0, 1000) + '\n...' : r.diff;
      return `**Git Diff** (${r.filesChanged} files):\n\`\`\`diff\n${preview}\n\`\`\``;
    }

    case 'logs.getStagingLogs': {
      const r = result as { lines: string[]; totalLines: number };
      const preview = r.lines.slice(-20).join('\n');
      return `**Staging Logs** (${r.totalLines} total lines, showing last 20):\n\`\`\`\n${preview}\n\`\`\``;
    }

    default:
      return `**${toolName} result:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }
}
