/**
 * Agent Router / Orchestrator
 *
 * Handles routing, delegation, and escalation between agents.
 * Central coordination point for the multi-agent system.
 */

import { nanoid } from 'nanoid';
import type {
  AgentName,
  AgentDefinition,
  AgentStreamEvent,
  DelegationTask,
  DelegationResult,
  EscalationIssue,
  EscalationIssueType,
  EscalationResponse,
  UserQuestion,
  UserResponse,
  ApprovalRequest,
  ApprovalResponse,
  QualificationResult,
  GatheredContext,
  ExecutedTool,
} from './types.js';
import * as stateManager from './stateManager.js';
import { llmRouter } from '../llm/router.js';
import { executeTool } from '../tools/executor.js';
import { getToolsForLLM, toolRequiresConfirmation } from '../tools/registry.js';
import { createAction } from '../actions/manager.js';
import { buildActionPreview } from '../actions/preview.js';
import type { LLMMessage, ToolCall } from '../llm/types.js';

// Agent definitions
import { CHAPO_AGENT } from './chapo.js';
import { KODA_AGENT } from './koda.js';
import { DEVO_AGENT } from './devo.js';

export type SendEventFn = (event: AgentStreamEvent) => void;

const AGENTS: Record<AgentName, AgentDefinition> = {
  chapo: CHAPO_AGENT,
  koda: KODA_AGENT,
  devo: DEVO_AGENT,
};

// Get agent definition
export function getAgent(name: AgentName): AgentDefinition {
  return AGENTS[name];
}

// Get tools for a specific agent
export function getToolsForAgent(agent: AgentName): string[] {
  return AGENTS[agent].tools;
}

// Check if an agent can use a specific tool
export function canAgentUseTool(agent: AgentName, toolName: string): boolean {
  return AGENTS[agent].tools.includes(toolName);
}

/**
 * Main entry point: Process a user request through the multi-agent system
 */
export async function processRequest(
  sessionId: string,
  userMessage: string,
  projectRoot: string | null,
  sendEvent: SendEventFn
): Promise<string> {
  // Initialize or get state
  const state = stateManager.getOrCreateState(sessionId);
  stateManager.setOriginalRequest(sessionId, userMessage);
  stateManager.setPhase(sessionId, 'qualification');
  stateManager.setActiveAgent(sessionId, 'chapo');

  sendEvent({ type: 'agent_start', agent: 'chapo', phase: 'qualification' });

  try {
    // Phase 1: CHAPO qualifies the task
    const qualification = await runChapoQualification(
      sessionId,
      userMessage,
      projectRoot,
      sendEvent
    );

    stateManager.setQualificationResult(sessionId, qualification);

    // Check if user clarification needed
    if (qualification.requiresClarification && qualification.clarificationQuestion) {
      const question: UserQuestion = {
        questionId: nanoid(),
        question: qualification.clarificationQuestion,
        fromAgent: 'chapo',
        timestamp: new Date().toISOString(),
      };
      stateManager.addPendingQuestion(sessionId, question);
      stateManager.setPhase(sessionId, 'waiting_user');
      sendEvent({ type: 'user_question', question });

      return `Ich habe eine Frage bevor ich fortfahren kann:\n\n${qualification.clarificationQuestion}`;
    }

    // Check if approval needed (risky task)
    if (qualification.requiresApproval && !stateManager.isApprovalGranted(sessionId)) {
      const approval: ApprovalRequest = {
        approvalId: nanoid(),
        description: `Task: ${userMessage}\n\nRisiko: ${qualification.riskLevel}\nZiel-Agent: ${qualification.targetAgent}`,
        riskLevel: qualification.riskLevel,
        actions: [],
        fromAgent: 'chapo',
        timestamp: new Date().toISOString(),
      };
      stateManager.addPendingApproval(sessionId, approval);
      stateManager.setPhase(sessionId, 'waiting_user');
      sendEvent({ type: 'approval_request', request: approval });

      return `Dieser Task erfordert deine Freigabe:\n\n**${userMessage}**\n\nRisiko-Level: ${qualification.riskLevel}\n\nBitte bestätige, dass ich fortfahren soll.`;
    }

    // Phase 2: Execute based on task type
    stateManager.setPhase(sessionId, 'execution');

    let result: string;

    if (qualification.taskType === 'mixed' && qualification.targetAgent === null) {
      // Parallel execution of KODA and DEVO
      result = await runParallelExecution(
        sessionId,
        userMessage,
        qualification,
        projectRoot,
        sendEvent
      );
    } else if (qualification.targetAgent) {
      // Single agent execution
      result = await delegateToAgent(
        sessionId,
        qualification.targetAgent,
        userMessage,
        qualification.gatheredContext,
        sendEvent
      );
    } else {
      // Chapo handles it (simple read-only task)
      result = `Task analysiert:\n\n${qualification.reasoning}`;
    }

    // Phase 3: Review
    stateManager.setPhase(sessionId, 'review');
    sendEvent({ type: 'agent_start', agent: 'chapo', phase: 'review' });

    // CHAPO reviews the result
    const reviewedResult = await runChapoReview(
      sessionId,
      userMessage,
      result,
      sendEvent
    );

    // Send history
    sendEvent({
      type: 'agent_history',
      entries: stateManager.getHistory(sessionId),
    });

    sendEvent({ type: 'agent_complete', agent: 'chapo', result: reviewedResult });

    return reviewedResult;
  } catch (error) {
    stateManager.setPhase(sessionId, 'error');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    stateManager.addHistoryEntry(
      sessionId,
      state.activeAgent,
      'respond',
      userMessage,
      errorMessage,
      { status: 'error' }
    );

    sendEvent({ type: 'error', agent: state.activeAgent, error: errorMessage });

    return `Fehler aufgetreten: ${errorMessage}\n\nBitte hilf mir, dieses Problem zu lösen.`;
  }
}

/**
 * CHAPO: Task Qualification Phase
 */
async function runChapoQualification(
  sessionId: string,
  userMessage: string,
  projectRoot: string | null,
  sendEvent: SendEventFn
): Promise<QualificationResult> {
  sendEvent({ type: 'agent_thinking', agent: 'chapo', status: 'Analysiere Task...' });

  const chapo = getAgent('chapo');
  const tools = getToolsForLLM().filter((t) => chapo.tools.includes(t.name));

  const systemPrompt = `${chapo.systemPrompt}

AKTUELLE AUFGABE: Task-Qualifizierung

Analysiere den User-Request und:
1. Sammle relevanten Kontext (nutze fs.glob, fs.readFile, git.status)
2. Bestimme den Task-Typ: code_change | devops | mixed | unclear
3. Bewerte das Risiko: low | medium | high
4. Entscheide, ob Klarstellung oder Freigabe nötig ist
5. Bestimme den Ziel-Agenten: koda (Code) | devo (DevOps) | null (parallel/unklar)

${projectRoot ? `Working Directory: ${projectRoot}` : ''}

Antworte am Ende mit einem JSON-Block im Format:
\`\`\`json
{
  "taskType": "code_change|devops|mixed|unclear",
  "riskLevel": "low|medium|high",
  "targetAgent": "koda|devo|null",
  "requiresApproval": true/false,
  "requiresClarification": true/false,
  "clarificationQuestion": "...",
  "reasoning": "..."
}
\`\`\``;

  const messages: LLMMessage[] = [
    { role: 'user', content: userMessage },
  ];

  const gatheredContext: GatheredContext = {
    relevantFiles: [],
    fileContents: {},
  };

  // Run CHAPO with tools for context gathering
  let turn = 0;
  const MAX_TURNS = 5;
  let finalContent = '';

  while (turn < MAX_TURNS) {
    turn++;

    const response = await llmRouter.generate('anthropic', {
      model: chapo.model,
      messages,
      systemPrompt,
      tools,
      toolsEnabled: true,
    });

    if (response.content) {
      finalContent = response.content;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    // Execute tools (read-only for CHAPO)
    for (const toolCall of response.toolCalls) {
      sendEvent({
        type: 'tool_call',
        agent: 'chapo',
        toolName: toolCall.name,
        args: toolCall.arguments,
      });

      const result = await executeTool(toolCall.name, toolCall.arguments);

      sendEvent({
        type: 'tool_result',
        agent: 'chapo',
        toolName: toolCall.name,
        result: result.result,
        success: result.success,
      });

      // Track gathered files
      if (toolCall.name === 'fs_readFile' && result.success) {
        const path = toolCall.arguments.path as string;
        gatheredContext.relevantFiles.push(path);
        gatheredContext.fileContents[path] = (result.result as { content: string }).content;
        stateManager.addGatheredFile(sessionId, path);
      }

      if (toolCall.name === 'git_status' && result.success) {
        gatheredContext.gitStatus = result.result as GatheredContext['gitStatus'];
      }

      // Add tool result to messages
      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      });
      messages.push({
        role: 'user',
        content: '',
        toolResults: [{
          toolUseId: toolCall.id,
          result: JSON.stringify(result.result),
          isError: !result.success,
        }],
      });
    }
  }

  // Parse qualification result from response
  const jsonMatch = finalContent.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        taskType: parsed.taskType || 'unclear',
        riskLevel: parsed.riskLevel || 'medium',
        complexity: 'moderate',
        targetAgent: parsed.targetAgent === 'null' ? null : parsed.targetAgent,
        requiresApproval: parsed.requiresApproval ?? false,
        requiresClarification: parsed.requiresClarification ?? false,
        clarificationQuestion: parsed.clarificationQuestion,
        gatheredContext,
        reasoning: parsed.reasoning || '',
      };
    } catch {
      // Fallback if JSON parsing fails
    }
  }

  // Default qualification
  return {
    taskType: 'unclear',
    riskLevel: 'medium',
    complexity: 'moderate',
    targetAgent: null,
    requiresApproval: true,
    requiresClarification: true,
    clarificationQuestion: 'Kannst du mir mehr Details zu deinem Request geben?',
    gatheredContext,
    reasoning: finalContent,
  };
}

/**
 * Delegate task to a specific agent (KODA or DEVO)
 */
async function delegateToAgent(
  sessionId: string,
  targetAgent: AgentName,
  task: string,
  context: GatheredContext,
  sendEvent: SendEventFn
): Promise<string> {
  stateManager.setActiveAgent(sessionId, targetAgent);
  sendEvent({
    type: 'agent_switch',
    from: 'chapo',
    to: targetAgent,
    reason: `Delegiere ${targetAgent === 'koda' ? 'Code-Arbeit' : 'DevOps-Arbeit'}`,
  });
  sendEvent({ type: 'delegation', from: 'chapo', to: targetAgent, task });

  const agent = getAgent(targetAgent);
  const tools = getToolsForLLM().filter((t) => agent.tools.includes(t.name));

  const contextSummary = context.relevantFiles.length > 0
    ? `\n\nRelevante Dateien:\n${context.relevantFiles.join('\n')}`
    : '';

  const gitStatusSummary = context.gitStatus
    ? `\n\nGit Status:\n- Branch: ${context.gitStatus.branch}\n- Modified: ${context.gitStatus.modified.join(', ') || 'none'}`
    : '';

  const systemPrompt = `${agent.systemPrompt}

KONTEXT VON CHAPO:
${contextSummary}${gitStatusSummary}

AUFGABE: ${task}

Führe die Aufgabe aus. Bei Problemen nutze escalateToChapo().`;

  const messages: LLMMessage[] = [
    { role: 'user', content: task },
  ];

  const executedTools: ExecutedTool[] = [];
  let turn = 0;
  const MAX_TURNS = 10;
  let finalContent = '';

  while (turn < MAX_TURNS) {
    turn++;
    sendEvent({ type: 'agent_thinking', agent: targetAgent, status: `Turn ${turn}...` });

    const response = await llmRouter.generate('anthropic', {
      model: agent.model,
      messages,
      systemPrompt,
      tools,
      toolsEnabled: true,
    });

    if (response.content) {
      finalContent = response.content;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    // Execute tools
    for (const toolCall of response.toolCalls) {
      // Check for escalation
      if (toolCall.name === 'escalateToChapo') {
        // Build proper EscalationIssue from tool arguments
        const args = toolCall.arguments as {
          issueType?: string;
          description?: string;
          context?: Record<string, unknown>;
          suggestedSolutions?: string[];
        };
        const escalationIssue: EscalationIssue = {
          issueId: nanoid(),
          fromAgent: targetAgent,
          issueType: (args.issueType as EscalationIssueType) || 'error',
          description: args.description || 'Unknown issue',
          context: args.context || {},
          suggestedSolutions: args.suggestedSolutions,
          timestamp: new Date().toISOString(),
        };
        const escalation = await handleEscalation(
          sessionId,
          targetAgent,
          escalationIssue,
          sendEvent
        );

        if (escalation.action === 'abort') {
          return `Task abgebrochen: ${escalation.instructions}`;
        }

        // Add escalation result to messages
        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: [toolCall],
        });
        messages.push({
          role: 'user',
          content: `CHAPO Antwort: ${escalation.instructions || escalation.alternativeApproach}`,
        });
        continue;
      }

      // Verify tool is in agent's allowed list (security check)
      if (!canAgentUseTool(targetAgent, toolCall.name)) {
        sendEvent({
          type: 'tool_result',
          agent: targetAgent,
          toolName: toolCall.name,
          result: `Error: Tool "${toolCall.name}" is not available to ${targetAgent}`,
          success: false,
        });

        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls,
        });
        messages.push({
          role: 'user',
          content: '',
          toolResults: [{
            toolUseId: toolCall.id,
            result: `Error: Tool "${toolCall.name}" is not available to ${targetAgent}`,
            isError: true,
          }],
        });
        continue;
      }

      sendEvent({
        type: 'tool_call',
        agent: targetAgent,
        toolName: toolCall.name,
        args: toolCall.arguments,
      });

      // Check if tool requires confirmation - create pending action for UI approval
      if (toolRequiresConfirmation(toolCall.name)) {
        const preview = await buildActionPreview(toolCall.name, toolCall.arguments);
        const description = generateToolDescription(toolCall.name, toolCall.arguments);

        const action = createAction({
          id: nanoid(),
          toolName: toolCall.name,
          toolArgs: toolCall.arguments,
          description,
          preview,
        });

        // Send action_pending event for inline approval in UI
        sendEvent({
          type: 'action_pending',
          actionId: action.id,
          toolName: action.toolName,
          toolArgs: action.toolArgs,
          description: action.description,
          preview: action.preview,
        });

        // Add tool result to messages indicating action is pending
        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls,
        });
        messages.push({
          role: 'user',
          content: '',
          toolResults: [{
            toolUseId: toolCall.id,
            result: `Action created for approval: ${description} (Action ID: ${action.id})`,
            isError: false,
          }],
        });
        continue;
      }

      const startTime = Date.now();
      const result = await executeTool(toolCall.name, toolCall.arguments);
      const duration = Date.now() - startTime;

      executedTools.push({
        name: toolCall.name,
        args: toolCall.arguments,
        result: result.result,
        success: result.success,
        duration,
        timestamp: new Date().toISOString(),
      });

      sendEvent({
        type: 'tool_result',
        agent: targetAgent,
        toolName: toolCall.name,
        result: result.result,
        success: result.success,
      });

      // Add to messages
      messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      });
      messages.push({
        role: 'user',
        content: '',
        toolResults: [{
          toolUseId: toolCall.id,
          result: result.success ? JSON.stringify(result.result) : `Error: ${result.error}`,
          isError: !result.success,
        }],
      });
    }
  }

  // Helper function to generate tool descriptions
  function generateToolDescription(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'fs_writeFile':
        return `Write to file: ${args.path}`;
      case 'fs_edit':
        return `Edit file: ${args.path}`;
      case 'fs_mkdir':
        return `Create directory: ${args.path}`;
      case 'fs_move':
        return `Move: ${args.source} → ${args.destination}`;
      case 'fs_delete':
        return `Delete: ${args.path}`;
      case 'git_commit':
        return `Git commit: "${args.message}"`;
      case 'git_push':
        return `Git push to ${args.remote || 'origin'}/${args.branch || 'current branch'}`;
      case 'git_pull':
        return `Git pull from ${args.remote || 'origin'}/${args.branch || 'current branch'}`;
      case 'github_triggerWorkflow':
        return `Trigger workflow: ${args.workflow} on ${args.ref}`;
      case 'bash_execute':
        return `Execute: ${args.command}`;
      case 'ssh_execute':
        return `SSH to ${args.host}: ${args.command}`;
      case 'pm2_restart':
        return `PM2 restart: ${args.processName}`;
      case 'pm2_stop':
        return `PM2 stop: ${args.processName}`;
      case 'pm2_start':
        return `PM2 start: ${args.processName}`;
      case 'pm2_reloadAll':
        return `PM2 reload all processes`;
      case 'npm_install':
        return args.packageName ? `npm install ${args.packageName}` : 'npm install';
      case 'npm_run':
        return `npm run ${args.script}`;
      default:
        return `Execute: ${toolName}`;
    }
  }

  // Log to history
  stateManager.addHistoryEntry(
    sessionId,
    targetAgent,
    'execute_tool',
    task,
    finalContent,
    {
      toolCalls: executedTools.map((t) => ({
        id: nanoid(),
        name: t.name,
        arguments: t.args,
        result: t.result,
        duration: t.duration,
      })),
      status: 'success',
    }
  );

  sendEvent({ type: 'agent_complete', agent: targetAgent, result: finalContent });

  return finalContent;
}

/**
 * Run parallel execution of KODA and DEVO
 */
async function runParallelExecution(
  sessionId: string,
  task: string,
  qualification: QualificationResult,
  projectRoot: string | null,
  sendEvent: SendEventFn
): Promise<string> {
  sendEvent({
    type: 'parallel_start',
    agents: ['koda', 'devo'],
    tasks: ['Code-Änderungen', 'DevOps-Operationen'],
  });

  // Create delegation tasks
  const kodaTask: DelegationTask = {
    taskId: nanoid(),
    description: 'Code-Änderungen',
    originalRequest: task,
    context: qualification.gatheredContext,
    constraints: [],
    fromAgent: 'chapo',
    toAgent: 'koda',
    timestamp: new Date().toISOString(),
  };

  const devoTask: DelegationTask = {
    taskId: nanoid(),
    description: 'DevOps-Operationen',
    originalRequest: task,
    context: qualification.gatheredContext,
    constraints: [],
    fromAgent: 'chapo',
    toAgent: 'devo',
    timestamp: new Date().toISOString(),
  };

  const execution = stateManager.startParallelExecution(
    sessionId,
    ['koda', 'devo'],
    [kodaTask, devoTask]
  );

  // Run both agents in parallel
  const [kodaResult, devoResult] = await Promise.all([
    delegateToAgent(sessionId, 'koda', task, qualification.gatheredContext, sendEvent)
      .then((result) => ({ success: true, result }))
      .catch((error) => ({ success: false, result: error.message })),
    delegateToAgent(sessionId, 'devo', task, qualification.gatheredContext, sendEvent)
      .then((result) => ({ success: true, result }))
      .catch((error) => ({ success: false, result: error.message })),
  ]);

  // Add results
  stateManager.addParallelResult(sessionId, execution.executionId, {
    taskId: kodaTask.taskId,
    success: kodaResult.success,
    result: kodaResult.result,
    toolsExecuted: [],
    fromAgent: 'koda',
    timestamp: new Date().toISOString(),
  });

  stateManager.addParallelResult(sessionId, execution.executionId, {
    taskId: devoTask.taskId,
    success: devoResult.success,
    result: devoResult.result,
    toolsExecuted: [],
    fromAgent: 'devo',
    timestamp: new Date().toISOString(),
  });

  const finalExecution = stateManager.getParallelExecution(sessionId, execution.executionId);

  sendEvent({
    type: 'parallel_complete',
    results: finalExecution?.results || [],
  });

  return `**KODA (Code):**\n${kodaResult.result}\n\n**DEVO (DevOps):**\n${devoResult.result}`;
}

/**
 * Handle escalation from KODA or DEVO
 */
async function handleEscalation(
  sessionId: string,
  fromAgent: AgentName,
  issue: Partial<EscalationIssue>,
  sendEvent: SendEventFn
): Promise<EscalationResponse> {
  const escalation: EscalationIssue = {
    issueId: nanoid(),
    fromAgent,
    issueType: issue.issueType || 'error',
    description: issue.description || 'Unknown issue',
    context: issue.context || {},
    suggestedSolutions: issue.suggestedSolutions,
    timestamp: new Date().toISOString(),
  };

  sendEvent({ type: 'escalation', from: fromAgent, issue: escalation });

  stateManager.addHistoryEntry(
    sessionId,
    fromAgent,
    'escalate',
    escalation,
    null,
    { status: 'escalated' }
  );

  // Switch to CHAPO for handling
  stateManager.setActiveAgent(sessionId, 'chapo');
  sendEvent({
    type: 'agent_switch',
    from: fromAgent,
    to: 'chapo',
    reason: 'Eskalation behandeln',
  });

  // CHAPO analyzes the issue
  const chapo = getAgent('chapo');
  const response = await llmRouter.generate('anthropic', {
    model: chapo.model,
    messages: [
      {
        role: 'user',
        content: `ESKALATION von ${fromAgent.toUpperCase()}:

Problem-Typ: ${escalation.issueType}
Beschreibung: ${escalation.description}
${escalation.suggestedSolutions ? `Vorgeschlagene Lösungen: ${escalation.suggestedSolutions.join(', ')}` : ''}

Analysiere das Problem und entscheide:
1. Kann ich eine alternative Lösung vorschlagen?
2. Muss ich den User fragen?
3. Soll der Task abgebrochen werden?

Antworte mit einer klaren Handlungsanweisung für ${fromAgent.toUpperCase()}.`,
      },
    ],
    systemPrompt: chapo.systemPrompt,
    toolsEnabled: false,
  });

  stateManager.addHistoryEntry(
    sessionId,
    'chapo',
    'respond',
    escalation,
    response.content,
    { status: 'success' }
  );

  return {
    issueId: escalation.issueId,
    resolved: true,
    action: 'alternative',
    instructions: response.content,
  };
}

/**
 * CHAPO: Review Phase
 */
async function runChapoReview(
  sessionId: string,
  originalTask: string,
  executionResult: string,
  sendEvent: SendEventFn
): Promise<string> {
  stateManager.setActiveAgent(sessionId, 'chapo');
  sendEvent({ type: 'agent_thinking', agent: 'chapo', status: 'Überprüfe Ergebnis...' });

  const chapo = getAgent('chapo');
  const history = stateManager.getHistory(sessionId);

  const historySummary = history
    .slice(-10)
    .map((e) => `[${e.agent}] ${e.action}: ${e.status}`)
    .join('\n');

  const response = await llmRouter.generate('anthropic', {
    model: chapo.model,
    messages: [
      {
        role: 'user',
        content: `REVIEW PHASE

Original-Anfrage: ${originalTask}

Ausführungs-Ergebnis:
${executionResult}

History:
${historySummary}

Erstelle eine Zusammenfassung für den User:
1. Was wurde gemacht?
2. Gab es Probleme?
3. Was sind die nächsten Schritte (falls nötig)?`,
      },
    ],
    systemPrompt: chapo.systemPrompt,
    toolsEnabled: false,
  });

  stateManager.addHistoryEntry(
    sessionId,
    'chapo',
    'review',
    { originalTask, executionResult },
    response.content,
    { status: 'success' }
  );

  return response.content;
}

/**
 * Handle user response to a question
 */
export async function handleUserResponse(
  sessionId: string,
  questionId: string,
  answer: string,
  sendEvent: SendEventFn
): Promise<string> {
  const question = stateManager.removePendingQuestion(sessionId, questionId);
  if (!question) {
    return 'Frage nicht gefunden.';
  }

  const userResponse: UserResponse = {
    questionId,
    answer,
    timestamp: new Date().toISOString(),
  };

  stateManager.addHistoryEntry(
    sessionId,
    'chapo',
    'respond',
    question,
    userResponse,
    { status: 'success' }
  );

  // Continue processing with the new information
  const state = stateManager.getState(sessionId);
  if (state) {
    return processRequest(
      sessionId,
      `${state.taskContext.originalRequest}\n\nZusätzliche Info: ${answer}`,
      null,
      sendEvent
    );
  }

  return 'Session nicht gefunden.';
}

/**
 * Handle user approval
 */
export async function handleUserApproval(
  sessionId: string,
  approvalId: string,
  approved: boolean,
  sendEvent: SendEventFn
): Promise<string> {
  const approval = stateManager.removePendingApproval(sessionId, approvalId);
  if (!approval) {
    return 'Freigabe-Anfrage nicht gefunden.';
  }

  if (!approved) {
    stateManager.setPhase(sessionId, 'error');
    return 'Task abgebrochen durch User.';
  }

  // Grant approval and continue
  stateManager.grantApproval(sessionId);

  const state = stateManager.getState(sessionId);
  if (state) {
    return processRequest(
      sessionId,
      state.taskContext.originalRequest,
      null,
      sendEvent
    );
  }

  return 'Session nicht gefunden.';
}
