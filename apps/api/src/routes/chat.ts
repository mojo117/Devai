import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { resolve } from 'path';
import type { ChatMessage, ChatResponse } from '@devai/shared';
import { llmRouter } from '../llm/router.js';
import type { LLMMessage, ToolCall, ToolDefinition as LLMToolDefinition, ToolResult } from '../llm/types.js';
import { getToolsForLLM, toolRequiresConfirmation, getToolDefinition } from '../tools/registry.js';
import { executeTool } from '../tools/executor.js';
import { createAction, getPendingActions } from '../actions/manager.js';
import { buildActionPreview } from '../actions/preview.js';
import { readFile } from '../tools/fs.js';
import { logToolExecution } from '../audit/logger.js';
import { config } from '../config.js';
import { getProjectContext } from '../scanner/projectScanner.js';
import { loadClaudeMdContext, formatClaudeMdBlock } from '../scanner/claudeMdLoader.js';
import { checkPermission } from '../permissions/checker.js';
import { shouldRequireConfirmation } from '../config/trust.js';
import { getTrustMode } from '../db/queries.js';
import { getSkillById, getSkillLoadState, refreshSkills } from '../skills/registry.js';
import type { SkillManifest } from '@devai/shared';
import { createSession, saveMessage, updateSessionTitleIfEmpty, getMessages, getSetting } from '../db/queries.js';
import {
  processRequest as processMultiAgentRequest,
  handleUserApproval,
  handlePlanApproval,
  getCurrentPlan,
  getTasks,
} from '../agents/router.js';
import { getState, getOrCreateState, getTaskProgress } from '../agents/stateManager.js';
import type { AgentStreamEvent } from '../agents/types.js';

const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    timestamp: z.string(),
  })),
  provider: z.enum(['anthropic', 'openai', 'gemini']),
  projectRoot: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  sessionId: z.string().optional(),
  pinnedFiles: z.array(z.string()).optional(),
  projectContextOverride: z.object({
    enabled: z.boolean().optional(),
    summary: z.string().optional(),
  }).optional(),
});

const AgentApprovalSchema = z.object({
  sessionId: z.string(),
  approvalId: z.string(),
  approved: z.boolean(),
});

const PlanApprovalSchema = z.object({
  sessionId: z.string(),
  planId: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
});

// System prompt for the AI assistant
const SYSTEM_PROMPT = `You are DevAI, an AI developer assistant. You help users with code-related tasks.

You have access to the following tools:

FILE SYSTEM:
- fs.listFiles(path): List files in a directory
- fs.readFile(path): Read file contents
- fs.writeFile(path, content): Write content to a file (REQUIRES USER CONFIRMATION)
- fs.mkdir(path): Create a new directory (REQUIRES USER CONFIRMATION)
- fs.move(source, destination): Move or rename a file/directory (REQUIRES USER CONFIRMATION)
- fs.delete(path, recursive?): Delete a file or directory. Set recursive=true for non-empty directories (REQUIRES USER CONFIRMATION)
- fs.glob(pattern, path?): Find files matching a glob pattern (e.g., **/*.ts, src/**/*.tsx)
- fs.grep(pattern, path, glob?): Search for text/regex pattern in files
- fs.edit(path, old_string, new_string): Make targeted edits to a file (REQUIRES USER CONFIRMATION)

GIT:
- git.status(): Show git status
- git.diff(): Show git diff
- git.commit(message): Create a git commit (REQUIRES USER CONFIRMATION)

GITHUB:
- github.triggerWorkflow(workflow, ref, inputs): Trigger a GitHub Actions workflow (REQUIRES USER CONFIRMATION)
- github.getWorkflowRunStatus(runId): Get workflow run status

LOGS:
- logs.getStagingLogs(lines): Get staging environment logs

CONTEXT (Read-Only Document Access):
- context.listDocuments(): List all documents in the context folder
- context.readDocument(path): Read a specific document by filename
- context.searchDocuments(query): Search for text across all documents

The context folder contains reference materials you can use to inform your responses.
When relevant to the user's question, check if there are helpful documents available.

CONFIRMATION:
- askForConfirmation(toolName, toolArgs, description): Request approval for a tool that requires confirmation

IMPORTANT: For tools marked with (REQUIRES USER CONFIRMATION), you MUST:
1. Call askForConfirmation(toolName, toolArgs, description) with the tool name, arguments, and a clear description
2. The user will see an Approve/Reject button in the UI
3. The action will only execute after the user approves it

Example:
User: "Delete the archive folder"
You: First verify it exists with fs.listFiles, then call:
askForConfirmation("fs.delete", {"path": "/path/to/archive", "recursive": true}, "Delete the archive folder")

When exploring a codebase, use fs.glob to find files and fs.grep to search for specific code. This is more efficient than listing directories manually.

FILE ACCESS:
- You have FULL access to /opt/Klyde/projects and all subdirectories
- Each project is at /opt/Klyde/projects/<project-name> (e.g., /opt/Klyde/projects/Devai)
- Your working directory is in "Project Context" above - but you can access ANY project
- Linux is CASE SENSITIVE: /Test and /test are DIFFERENT directories

IF USER MENTIONS A GITHUB REPO OR URL:
- Extract the repo name from the URL (e.g., "mojo117/Devai" → "Devai")
- The repo is likely at /opt/Klyde/projects/<repo-name>
- Use fs.listFiles("/opt/Klyde/projects") to see all available projects
- DO NOT say "I cannot access" - TRY to find the project first!

BEFORE any file/directory operation:
1. Use fs.listFiles to verify the path exists
2. Check the EXACT case of directory/file names
3. If not found, use fs.glob or try /opt/Klyde/projects/<name>
4. If still uncertain, ASK the user - but NEVER claim you "cannot access"

Examples:
- User gives GitHub link → extract repo name, check /opt/Klyde/projects/<repo-name>
- User says "here" or "this folder" → use the working directory from Project Context
- Path error → try fs.listFiles on parent dir, then search with fs.glob

NEVER say "access denied" or "cannot access" for paths under /opt/Klyde/projects - you CAN access them.

Focus on solving the user's problem efficiently while being transparent about any changes you want to make.`;

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.post('/chat', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'application/x-ndjson');
    const parseResult = ChatRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

      const {
        messages,
        provider,
        projectRoot: requestedProjectRoot,
        skillIds,
        sessionId: requestedSessionId,
        projectContextOverride,
      } = parseResult.data;

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

      // Validate project root against allowed paths
      let projectContext = null;
      let validatedProjectRoot: string | null = null;
      if (requestedProjectRoot) {
        const normalizedPath = resolve(requestedProjectRoot);
        const isAllowed = config.allowedRoots.some((root) => {
          const absoluteRoot = resolve(root);
          return normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot;
        });
        if (isAllowed) {
          validatedProjectRoot = normalizedPath;
          projectContext = await getProjectContext(normalizedPath);
        }
      }
      const overrideSummary = projectContextOverride?.enabled && projectContextOverride.summary?.trim().length
        ? projectContextOverride.summary.trim()
        : null;
      const effectiveSummary = overrideSummary || projectContext?.summary || '';
      const projectContextBlock = validatedProjectRoot
        ? `\n\nProject Context:\nWorking Directory: ${validatedProjectRoot}\n${effectiveSummary}`
        : '';

      // Load CLAUDE.md from project root and parent directories
      let claudeMdBlock = '';
      if (validatedProjectRoot) {
        const claudeMdContext = await loadClaudeMdContext(validatedProjectRoot);
        claudeMdBlock = formatClaudeMdBlock(claudeMdContext);
      }

      // Load Global Context
      let globalContextBlock = '';
      try {
        const globalContextValue = await getSetting('globalContext');
        if (globalContextValue) {
          const parsed = JSON.parse(globalContextValue);
          if (parsed.enabled && parsed.content?.trim()) {
            globalContextBlock = `\n\nGlobal Context:\n${parsed.content.trim()}`;
          }
        }
      } catch {
        // Ignore errors - global context is optional
      }

      const selectedSkills = await resolveSkills(skillIds);
      const { allowedToolNames, skillsPrompt } = summarizeSkills(selectedSkills);
      const pinnedFilesBlock = await buildPinnedFilesBlock(parseResult.data.pinnedFiles);

      // Get available tools, filtered by skills if needed
      const tools = filterToolsForSkills(getToolsForLLM(), allowedToolNames);

      const activeSessionId = requestedSessionId || (await createSession()).id;

      const sendEvent = (event: Record<string, unknown>) => {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      };

      sendEvent({ type: 'status', status: 'started', timestamp: new Date().toISOString() });

      // Agentic loop - continue until no tool calls or max turns
      const MAX_TURNS = 10;
      let turn = 0;
      let finalContent = '';
      const conversationMessages: LLMMessage[] = [...llmMessages];

      // Get trust mode setting
      const trustMode = await getTrustMode();

      while (turn < MAX_TURNS) {
        turn++;
        sendEvent({ type: 'status', status: 'thinking', turn });

      const llmResponse = await llmRouter.generate(provider, {
          messages: conversationMessages,
          systemPrompt: SYSTEM_PROMPT + projectContextBlock + claudeMdBlock + globalContextBlock + skillsPrompt + pinnedFilesBlock,
          toolsEnabled: true,
          tools,
        });

        // Accumulate content from each turn
        if (llmResponse.content) {
          finalContent += (finalContent && llmResponse.content ? '\n\n' : '') + llmResponse.content;
        }

        // If no tool calls, we're done
        if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
          sendEvent({ type: 'status', status: 'completed', turn });
          break;
        }

        // Process tool calls
        const toolResultsForLLM: ToolResult[] = [];

        for (const toolCall of llmResponse.toolCalls) {
          sendEvent({
            type: 'tool_call',
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          });

          const result = await handleToolCall(toolCall, allowedToolNames, sendEvent, trustMode);
          const isError = result.startsWith('Error');
          const safeResult = isError && !result.trim()
            ? 'Error: Tool failed without a message.'
            : result;

          toolResultsForLLM.push({
            toolUseId: toolCall.id,
            result: safeResult,
            isError,
          });

          streamToolResult(sendEvent, toolCall.id, toolCall.name, safeResult);
        }

        // Add assistant message with tool calls to conversation
        conversationMessages.push({
          role: 'assistant',
          content: llmResponse.content || '',
          toolCalls: llmResponse.toolCalls,
        });

        // Add tool results as user message
        conversationMessages.push({
          role: 'user',
          content: '',
          toolResults: toolResultsForLLM,
        });

        sendEvent({ type: 'status', status: 'tool_results_sent', turn });
      }

      if (turn >= MAX_TURNS) {
        finalContent += '\n\n[Reached maximum reasoning turns]';
      }

      const responseMessage: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: finalContent,
        timestamp: new Date().toISOString(),
      };

      const latestUserMessage = [...messages].reverse().find((m) => m.role === 'user');
      if (latestUserMessage) {
        await saveMessage(activeSessionId, latestUserMessage);
        const title = buildSessionTitle(latestUserMessage.content);
        if (title) {
          await updateSessionTitleIfEmpty(activeSessionId, title);
        }
      }
      await saveMessage(activeSessionId, responseMessage);

      // Get current pending actions
      const pendingActions = await getPendingActions();

      const contextStats = buildContextStats({
        systemPrompt: SYSTEM_PROMPT,
        projectContextBlock,
        claudeMdBlock,
        globalContextBlock,
        skillsPrompt,
        pinnedFilesBlock,
        messages: conversationMessages,
      });

      const response: ChatResponse = {
        message: responseMessage,
        pendingActions,
        sessionId: activeSessionId,
        contextStats,
      };

      sendEvent({ type: 'context_stats', stats: contextStats });
      sendEvent({ type: 'response', response });
      reply.raw.end();
      return reply;
    } catch (error) {
      app.log.error(error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.startsWith('Unknown skill:')) {
        return reply.status(400).send({
          error: message,
        });
      }
      return reply.status(500).send({
        error: 'Failed to generate response',
        details: message,
      });
    }
  });

  // Endpoint to expose the system prompt for the UI
  app.get('/system-prompt', async (_request, reply) => {
    return reply.send({ prompt: SYSTEM_PROMPT });
  });

  // Multi-agent chat endpoint (CHAPO → KODA/DEVO)
  const MultiAgentRequestSchema = z.object({
    message: z.string(),
    sessionId: z.string().optional(),
    projectRoot: z.string().optional(),
  });

  app.post('/chat/agents', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'application/x-ndjson');

    const parseResult = MultiAgentRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const { message, sessionId: requestedSessionId, projectRoot } = parseResult.data;

    // Validate project root
    let validatedProjectRoot: string | null = null;
    if (projectRoot) {
      const normalizedPath = resolve(projectRoot);
      const isAllowed = config.allowedRoots.some((root) => {
        const absoluteRoot = resolve(root);
        return normalizedPath.startsWith(absoluteRoot + '/') || normalizedPath === absoluteRoot;
      });
      if (isAllowed) {
        validatedProjectRoot = normalizedPath;
      }
    }

    try {
      const activeSessionId = requestedSessionId || (await createSession()).id;

      // Load conversation history (last 30 messages)
      const historyMessages = await getMessages(activeSessionId);
      const recentHistory = historyMessages.slice(-30).map(m => ({
        role: m.role,
        content: m.content
      }));

      // Initialize or get state
      const state = getOrCreateState(activeSessionId);
      if (validatedProjectRoot) {
        state.taskContext.originalRequest = message;
      }

      const sendEvent = (event: AgentStreamEvent | Record<string, unknown>) => {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      };

      sendEvent({
        type: 'agent_switch',
        from: 'chapo',  // Initial agent
        to: 'chapo',
        reason: 'Initiating multi-agent workflow',
      });

      // Process request through multi-agent system
      const result = await processMultiAgentRequest(
        activeSessionId,
        message,
        recentHistory,
        validatedProjectRoot || config.allowedRoots[0],
        sendEvent
      );

      // Build response message
      const responseMessage: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: result,
        timestamp: new Date().toISOString(),
      };

      // Save messages
      const userMessage: ChatMessage = {
        id: nanoid(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      };

      await saveMessage(activeSessionId, userMessage);
      await saveMessage(activeSessionId, responseMessage);

      const title = buildSessionTitle(message);
      if (title) {
        await updateSessionTitleIfEmpty(activeSessionId, title);
      }

      // Get final state for response
      const finalState = getState(activeSessionId);
      const pendingActions = await getPendingActions();

      sendEvent({
        type: 'response',
        response: {
          message: responseMessage,
          pendingActions,
          sessionId: activeSessionId,
          agentHistory: finalState?.agentHistory || [],
        },
      });

      reply.raw.end();
      return reply;
    } catch (error) {
      app.log.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        error: 'Multi-agent processing failed',
        details: errorMessage,
      });
    }
  });

  // Handle multi-agent approval decisions
  app.post('/chat/agents/approval', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    app.log.info('[agents] approval endpoint hit');
    reply.raw.setHeader('Content-Type', 'application/x-ndjson');

    const parseResult = AgentApprovalSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const { sessionId, approvalId, approved } = parseResult.data;
    app.log.info(`[agents] approval decision sessionId=${sessionId} approvalId=${approvalId} approved=${approved}`);

    try {
      const sendEvent = (event: AgentStreamEvent | Record<string, unknown>) => {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      };

      const result = await handleUserApproval(sessionId, approvalId, approved, sendEvent);

      const responseMessage: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: result,
        timestamp: new Date().toISOString(),
      };

      const state = getState(sessionId);
      if (state) {
        await saveMessage(sessionId, responseMessage);
      }

      sendEvent({
        type: 'response',
        response: {
          message: responseMessage,
          pendingActions: getPendingActions(),
          sessionId,
          agentHistory: state?.agentHistory || [],
        },
      });

      reply.raw.end();
      return reply;
    } catch (error) {
      app.log.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        error: 'Multi-agent approval failed',
        details: errorMessage,
      });
    }
  });

  // Get agent state for a session
  app.get('/chat/agents/:sessionId/state', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const state = getState(sessionId);

    if (!state) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    return reply.send({
      sessionId,
      currentPhase: state.currentPhase,
      activeAgent: state.activeAgent,
      agentHistory: state.agentHistory,
      pendingApprovals: state.pendingApprovals,
      pendingQuestions: state.pendingQuestions,
    });
  });

  // ============ Plan Mode Endpoints ============

  // Handle plan approval/rejection
  app.post('/chat/agents/plan/approval', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    app.log.info('[agents] plan approval endpoint hit');
    reply.raw.setHeader('Content-Type', 'application/x-ndjson');

    const parseResult = PlanApprovalSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parseResult.error.issues,
      });
    }

    const { sessionId, planId, approved, reason } = parseResult.data;
    app.log.info(`[agents] plan decision sessionId=${sessionId} planId=${planId} approved=${approved} reason=${reason}`);

    try {
      const sendEvent = (event: AgentStreamEvent | Record<string, unknown>) => {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      };

      const result = await handlePlanApproval(sessionId, planId, approved, reason, sendEvent);

      const responseMessage: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: result,
        timestamp: new Date().toISOString(),
      };

      const state = getState(sessionId);
      if (state) {
        await saveMessage(sessionId, responseMessage);
      }

      sendEvent({
        type: 'response',
        response: {
          message: responseMessage,
          pendingActions: getPendingActions(),
          sessionId,
          agentHistory: state?.agentHistory || [],
        },
      });

      reply.raw.end();
      return reply;
    } catch (error) {
      app.log.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        error: 'Plan approval failed',
        details: errorMessage,
      });
    }
  });

  // Get current plan for a session
  app.get('/chat/agents/:sessionId/plan', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const plan = getCurrentPlan(sessionId);

    if (!plan) {
      return reply.status(404).send({ error: 'No plan found for session' });
    }

    return reply.send({
      plan,
      progress: getTaskProgress(sessionId),
    });
  });

  // Get tasks for a session
  app.get('/chat/agents/:sessionId/tasks', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const tasks = getTasks(sessionId);
    const progress = getTaskProgress(sessionId);

    return reply.send({
      tasks,
      progress,
    });
  });
};

export async function handleToolCall(
  toolCall: ToolCall,
  allowedToolNames: Set<string> | null,
  sendEvent?: (event: Record<string, unknown>) => void,
  trustMode?: 'default' | 'trusted'
): Promise<string> {
  const toolName = toolCall.name;
  const toolArgs = toolCall.arguments;
  const toolDef = getToolDefinition(toolName);

  if (!toolDef) {
    return `Error: Unknown tool "${toolName}"`;
  }

  if (!isToolAllowed(toolName, allowedToolNames)) {
    return `Error: Tool "${toolName}" is not allowed by the active skills.`;
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

    if (!isToolAllowed(requestedToolName, allowedToolNames)) {
      return `Error: Tool "${requestedToolName}" is not allowed by the active skills.`;
    }

    if (!toolRequiresConfirmation(requestedToolName)) {
      return `Error: Tool "${requestedToolName}" does not require confirmation`;
    }

    const preview = await buildActionPreview(requestedToolName, requestedToolArgs);

    const action = await createAction({
      id: nanoid(),
      toolName: requestedToolName,
      toolArgs: requestedToolArgs,
      description,
      preview,
    });

    // Send action_pending event to client for inline approval UI
    if (sendEvent) {
      sendEvent({
        type: 'action_pending',
        actionId: action.id,
        toolName: action.toolName,
        toolArgs: action.toolArgs,
        description: action.description,
        preview: action.preview,
      });
    }

    return `Action created: **${description}**\n\nThis action requires your approval before it can be executed.\n\nAction ID: \`${action.id}\``;
  }

  // Check permission patterns before requiring confirmation
  if (toolRequiresConfirmation(toolName)) {
    const permCheck = await checkPermission(toolName, toolArgs);

    if (!permCheck.allowed) {
      return `Error: Tool "${toolName}" is denied by permission pattern: ${permCheck.reason}`;
    }

    // Check trust mode for confirmation bypass
    const effectiveTrustMode = trustMode || 'default';
    const trustCheck = shouldRequireConfirmation(
      toolName,
      toolArgs,
      effectiveTrustMode,
      true
    );

    if (trustCheck.requiresConfirmation && permCheck.requiresConfirmation) {
      return `Error: Tool "${toolName}" requires confirmation. Use askForConfirmation first.`;
    }

    // Log trusted mode execution
    if (effectiveTrustMode === 'trusted' && sendEvent) {
      sendEvent({
        type: 'trusted_execution',
        toolName,
        reason: 'Trust mode enabled',
      });
    }

    // Permission pattern grants this tool - execute directly
    if (sendEvent && !trustCheck.requiresConfirmation) {
      sendEvent({
        type: 'permission_granted',
        toolName,
        pattern: permCheck.matchedPattern?.id,
        reason: permCheck.reason,
      });
    }
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
    case 'fs_writeFile':
      return `Write to file: ${args.path}`;
    case 'git_commit':
      return `Git commit: "${args.message}"`;
    case 'github_triggerWorkflow':
      return `Trigger workflow: ${args.workflow} on ${args.ref}`;
    default:
      return `Execute: ${toolName}`;
  }
}

function isToolAllowed(toolName: string, allowedToolNames: Set<string> | null): boolean {
  if (!allowedToolNames) return true;
  if (toolName === 'askForConfirmation') return true;
  return allowedToolNames.has(toolName);
}

function filterToolsForSkills(
  tools: LLMToolDefinition[],
  allowedToolNames: Set<string> | null
): LLMToolDefinition[] {
  if (!allowedToolNames) return tools;
  return tools.filter((tool) => tool.name === 'askForConfirmation' || allowedToolNames.has(tool.name));
}

async function resolveSkills(skillIds: string[] | undefined): Promise<SkillManifest[]> {
  if (!skillIds || skillIds.length === 0) {
    return [];
  }

  const state = getSkillLoadState();
  if (!state.loadedAt) {
    await refreshSkills();
  }

  const selectedSkills: SkillManifest[] = [];

  for (const id of skillIds) {
    const skill = getSkillById(id);
    if (!skill) {
      throw new Error(`Unknown skill: ${id}`);
    }
    selectedSkills.push(skill);
  }

  return selectedSkills;
}

function summarizeSkills(skills: SkillManifest[]): {
  allowedToolNames: Set<string> | null;
  skillsPrompt: string;
} {
  if (skills.length === 0) {
    return { allowedToolNames: null, skillsPrompt: '' };
  }

  const allowList = new Set<string>();
  let hasExplicitAllowList = false;
  const promptParts: string[] = [];

  for (const skill of skills) {
    if (skill.systemPrompt) {
      promptParts.push(skill.systemPrompt);
    }

    if (skill.toolAllowList && skill.toolAllowList.length > 0) {
      hasExplicitAllowList = true;
      for (const toolName of skill.toolAllowList) {
        allowList.add(toolName);
      }
    }
  }

  const skillsPrompt = promptParts.length > 0 ? `\n\nActive Skills:\n${promptParts.join('\n\n')}` : '';

  return {
    allowedToolNames: hasExplicitAllowList ? allowList : null,
    skillsPrompt,
  };
}

function buildSessionTitle(content: string): string | null {
  const trimmed = content.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 57)}...`;
}

function buildContextStats(input: {
  systemPrompt: string;
  projectContextBlock: string;
  claudeMdBlock: string;
  globalContextBlock: string;
  skillsPrompt: string;
  pinnedFilesBlock: string;
  messages: LLMMessage[];
}): { tokensUsed: number; tokenBudget: number; note: string } {
  const combinedPrompt = input.systemPrompt + input.projectContextBlock + input.claudeMdBlock + input.globalContextBlock + input.skillsPrompt + input.pinnedFilesBlock;
  const messageText = input.messages.map((m) => m.content || '').join('\n');
  const tokensUsed = estimateTokens(combinedPrompt + messageText);
  const tokenBudget = 16000;
  return {
    tokensUsed,
    tokenBudget,
    note: 'Approximate token usage based on character count.',
  };
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

async function buildPinnedFilesBlock(pinnedFiles?: string[]): Promise<string> {
  if (!pinnedFiles || pinnedFiles.length === 0) {
    return '';
  }

  const unique = Array.from(new Set(pinnedFiles)).slice(0, 8);
  const sections: string[] = [];

  for (const file of unique) {
    try {
      const result = await readFile(file);
      const preview = truncateLines(result.content, 80);
      sections.push(`File: ${file}\n${preview}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read file';
      sections.push(`File: ${file}\n[Preview error: ${message}]`);
    }
  }

  if (sections.length === 0) {
    return '';
  }

  return `\n\nPinned Files:\n${sections.join('\n\n')}`;
}

function truncateLines(content: string, maxLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    return content;
  }
  return `${lines.slice(0, maxLines).join('\n')}\n...`;
}

function streamToolResult(
  sendEvent: (event: Record<string, unknown>) => void,
  id: string,
  name: string,
  result: string
) {
  const chunkSize = 400;
  if (result.length <= chunkSize) {
    sendEvent({ type: 'tool_result', id, name, result });
    return;
  }

  const total = Math.ceil(result.length / chunkSize);
  for (let i = 0; i < total; i += 1) {
    const chunk = result.slice(i * chunkSize, (i + 1) * chunkSize);
    sendEvent({
      type: 'tool_result_chunk',
      id,
      name,
      chunk,
      index: i + 1,
      total,
    });
  }

  sendEvent({ type: 'tool_result', id, name, completed: true });
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
    case 'fs_listFiles': {
      const r = result as { path: string; files: Array<{ name: string; type: string }> };
      const files = r.files.map((f) => `${f.type === 'directory' ? '??' : '??'} ${f.name}`);
      return `**Files in ${r.path}:**\n${files.join('\n')}`;
    }

    case 'fs_readFile': {
      const r = result as { path: string; content: string; size: number };
      const preview = r.content.length > 500 ? r.content.substring(0, 500) + '\n...' : r.content;
      return `**${r.path}** (${r.size} bytes):\n\`\`\`\n${preview}\n\`\`\``;
    }

    case 'git_status': {
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

    case 'git_diff': {
      const r = result as { diff: string; filesChanged: number };
      const preview = r.diff.length > 1000 ? r.diff.substring(0, 1000) + '\n...' : r.diff;
      return `**Git Diff** (${r.filesChanged} files):\n\`\`\`diff\n${preview}\n\`\`\``;
    }

    case 'logs_getStagingLogs': {
      const r = result as { lines: string[]; totalLines: number };
      const preview = r.lines.slice(-20).join('\n');
      return `**Staging Logs** (${r.totalLines} total lines, showing last 20):\n\`\`\`\n${preview}\n\`\`\``;
    }

    default:
      return `**${toolName} result:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  }
}
