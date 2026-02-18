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
  // Plan Mode types
  ChapoPerspective,
  KodaPerspective,
  DevoPerspective,
  ExecutionPlan,
  PlanTask,
  EffortEstimate,
  TaskPriority,
  // SCOUT types
  ScoutResult,
  ScoutScope,
} from './types.js';
import * as stateManager from './stateManager.js';
import { llmRouter } from '../llm/router.js';
import { getToolsForLLM } from '../tools/registry.js';
import { mcpManager } from '../mcp/index.js';
import { executeToolWithApprovalBridge } from '../actions/approvalBridge.js';
import type { LLMMessage, ToolCall } from '../llm/types.js';

// Agent definitions
import { CHAPO_AGENT } from './chapo.js';
import { KODA_AGENT } from './koda.js';
import { DEVO_AGENT } from './devo.js';
import { SCOUT_AGENT } from './scout.js';
import { loadClaudeMdContext, formatClaudeMdBlock } from '../scanner/claudeMdLoader.js';
import { loadDevaiMdContext, formatDevaiMdBlock } from '../scanner/devaiMdLoader.js';
import { processRequestNew } from './newRouter.js';
import { config } from '../config.js';
import { getMessages } from '../db/queries.js';
import {
  classifyTaskComplexity,
  selectModel,
  detectTargetAgent,
  shouldSkipQualification,
  shouldSkipReview,
} from '../llm/modelSelector.js';
import type { TaskComplexityLevel, ModelSelection } from './types.js';

export type SendEventFn = (event: AgentStreamEvent) => void;

const AGENTS: Record<AgentName, AgentDefinition> = {
  chapo: CHAPO_AGENT,
  koda: KODA_AGENT,
  devo: DEVO_AGENT,
  scout: SCOUT_AGENT,
};

function parseYesNo(input: string): boolean | null {
  const raw = input.trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
  if (!raw) return null;

  const yes = new Set([
    'y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'continue', 'proceed', 'go ahead',
    'ja', 'j', 'klar', 'weiter', 'mach weiter', 'bitte weiter',
    // Common typos / near-misses
    'yess', 'yees', 'yas',
    'contine', 'contiune', 'contnue', 'conitnue', 'continoue', 'continu', 'cntinue',
  ]);
  const no = new Set([
    'n', 'no', 'nope', 'stop', 'cancel', 'abort',
    'nein', 'nee', 'stopp', 'abbrechen',
    // Common typos / near-misses
    'cancell', 'abor', 'abrt',
  ]);

  if (yes.has(raw)) return true;
  if (no.has(raw)) return false;
  return null;
}

function looksLikeContinuePrompt(text: string): boolean {
  const t = (text || '').toLowerCase();
  return t.includes('required more steps than allowed') || t.includes('should i continue?');
}

function normalizeQuickText(text: string): string {
  return (text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/g, '');
}

function isSmallTalk(text: string): boolean {
  const t = normalizeQuickText(text);
  if (!t) return false;
  const greetings = new Set([
    'hi', 'hello', 'hey', 'yo', 'sup',
    'hallo', 'moin', 'servus',
    'ey', 'was geht', "what's up", 'whats up', 'wie gehts', "wie geht's",
  ]);
  return greetings.has(t);
}

async function loadRecentConversationHistory(sessionId: string): Promise<Array<{ role: string; content: string }>> {
  const messages = await getMessages(sessionId);
  return messages.slice(-30).map((m) => ({ role: m.role, content: m.content }));
}

function getProjectRootFromState(sessionId: string): string | null {
  const state = stateManager.getState(sessionId);
  const value = state?.taskContext.gatheredInfo['projectRoot'];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

async function getDevaiMdBlockForSession(sessionId: string): Promise<string> {
  const state = stateManager.getState(sessionId);
  if (state?.taskContext.gatheredInfo['devaiMdBlock']) {
    return String(state.taskContext.gatheredInfo['devaiMdBlock']);
  }

  const uiHost = (state?.taskContext.gatheredInfo['uiHost'] as string | undefined) || null;
  try {
    const ctx = await loadDevaiMdContext();
    const block = formatDevaiMdBlock(ctx, { uiHost });
    stateManager.setGatheredInfo(sessionId, 'devaiMdBlock', block);
    return block;
  } catch {
    return '';
  }
}

function buildToolResultContent(result: { success: boolean; result?: unknown; error?: string }): { content: string; isError: boolean } {
  if (result.success) {
    const value = result.result === undefined ? '' : JSON.stringify(result.result);
    return { content: value || 'OK', isError: false };
  }
  const content = result.error ? `Error: ${result.error}` : 'Error: Tool failed without a message.';
  return { content, isError: true };
}

// Get agent definition
export function getAgent(name: AgentName): AgentDefinition {
  return AGENTS[name];
}

// Get tools for a specific agent (native + MCP)
export function getToolsForAgent(agent: AgentName): string[] {
  const nativeTools = AGENTS[agent].tools;
  const mcpTools = mcpManager.getToolsForAgent(agent);
  return [...nativeTools, ...mcpTools];
}

// Check if an agent can use a specific tool
export function canAgentUseTool(agent: AgentName, toolName: string): boolean {
  return getToolsForAgent(agent).includes(toolName);
}

/**
 * Main entry point: Process a user request through the multi-agent system
 */
export async function processRequest(
  sessionId: string,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }> | undefined,
  projectRoot: string | null,
  sendEvent: SendEventFn
): Promise<string> {
  await stateManager.ensureStateLoaded(sessionId);
  // Default to empty array if not provided
  const history = conversationHistory ?? [];

  // If the user typed a simple yes/no while we're waiting on an approval, treat it as the approval decision.
  // This prevents "yes is too vague" when the new router asks "Should I continue?".
  const decision = parseYesNo(userMessage);
  const gateState = stateManager.getOrCreateState(sessionId);
  const pendingApprovals = gateState.pendingApprovals ?? [];
  if (decision !== null && pendingApprovals.length > 0) {
    const latest = pendingApprovals[pendingApprovals.length - 1];
    return handleUserApproval(sessionId, latest.approvalId, decision, sendEvent);
  }

  // If we're waiting for the user to answer a clarification question, treat the next message as the answer.
  const pendingQuestions = gateState.pendingQuestions ?? [];
  if (gateState.currentPhase === 'waiting_user' && pendingQuestions.length > 0) {
    const latestQ = pendingQuestions[pendingQuestions.length - 1];
    return handleUserResponse(sessionId, latestQ.questionId, userMessage, sendEvent);
  }

  // Fallback: if state was lost (restart) but the last assistant prompt was a "continue?" gate,
  // interpret "yes" as "continue the previous request".
  if (decision === true && pendingApprovals.length === 0) {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.content || '';
    if (looksLikeContinuePrompt(lastAssistant)) {
      const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
      if (lastUser.trim()) {
        stateManager.setOriginalRequest(sessionId, lastUser);
        userMessage = lastUser;
      }
    }
  }

  // Lightweight small-talk response (avoid forcing project clarification on greetings).
  if (isSmallTalk(userMessage) && history.length <= 1) {
    return 'Hey. Womit soll ich dir helfen: Code aendern, Bug fixen, oder etwas nachschlagen?';
  }

  // Keep the last actual request for approval/resume flows.
  stateManager.setOriginalRequest(sessionId, userMessage);

  // Load devai.md global instructions for this session (applies to both routers).
  await getDevaiMdBlockForSession(sessionId);

  // New capability-based router (feature-flagged)
  if (config.useNewAgentRouter) {
    console.info('[agents] Using NEW capability-based router');
    return processRequestNew({ sessionId, userMessage, projectRoot, sendEvent, conversationHistory: history });
  }

  // FAST PATH: Early task classification (no LLM call!)
  const taskComplexity = classifyTaskComplexity(userMessage);
  const modelSelection = selectModel(taskComplexity);

  console.info('[agents] processRequest start', {
    sessionId,
    projectRoot: projectRoot || null,
    messageLength: userMessage.length,
    taskComplexity,
    selectedModel: `${modelSelection.provider}/${modelSelection.model}`,
  });

  // Initialize or get state
  const state = stateManager.getOrCreateState(sessionId);
  stateManager.setOriginalRequest(sessionId, userMessage);
  stateManager.setGatheredInfo(sessionId, 'taskComplexity', taskComplexity);
  stateManager.setGatheredInfo(sessionId, 'modelSelection', modelSelection);

  // Load devai.md global instructions and store in state
  await getDevaiMdBlockForSession(sessionId);

  // Load CLAUDE.md project instructions and store in state
  if (projectRoot) {
    const claudeMdContext = await loadClaudeMdContext(projectRoot);
    const claudeMdBlock = formatClaudeMdBlock(claudeMdContext);
    stateManager.setGatheredInfo(sessionId, 'claudeMdBlock', claudeMdBlock);
    stateManager.setGatheredInfo(sessionId, 'projectRoot', projectRoot);
  }

  try {
    // FAST PATH: Skip qualification for trivial/simple tasks
    if (shouldSkipQualification(taskComplexity)) {
      console.info('[agents] FAST PATH: Skipping qualification', { taskComplexity });
      return executeSimpleTask(sessionId, userMessage, history, projectRoot, taskComplexity, modelSelection, sendEvent);
    }

    // STANDARD PATH: Full qualification for moderate/complex tasks
    stateManager.setPhase(sessionId, 'qualification');
    stateManager.setActiveAgent(sessionId, 'chapo');
    sendEvent({ type: 'agent_start', agent: 'chapo', phase: 'qualification' });

    // Phase 1: CHAPO qualifies the task (with smart model selection)
    const qualification = await runChapoQualification(
      sessionId,
      userMessage,
      history,
      projectRoot,
      sendEvent,
      modelSelection
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
      await stateManager.flushState(sessionId);

      return `Ich habe eine Frage bevor ich fortfahren kann:\n\n${qualification.clarificationQuestion}`;
    }

    // Check if approval needed (risky task)
    if (qualification.requiresApproval && !stateManager.isApprovalGranted(sessionId)) {
      console.info('[agents] approval required', {
        sessionId,
        riskLevel: qualification.riskLevel,
        targetAgent: qualification.targetAgent,
      });
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
      sendEvent({ type: 'approval_request', request: approval, sessionId });
      await stateManager.flushState(sessionId);

      return `Dieser Task erfordert deine Freigabe:\n\n**${userMessage}**\n\nRisiko-Level: ${qualification.riskLevel}\n\nBitte bestätige, dass ich fortfahren soll.`;
    }

    // Phase 2: Check if Plan Mode is required
    if (determinePlanModeRequired(qualification)) {
      console.info('[agents] Plan Mode required', {
        sessionId,
        taskType: qualification.taskType,
        complexity: qualification.complexity,
        riskLevel: qualification.riskLevel,
      });

      // Run Plan Mode - returns plan for user approval
      const plan = await runPlanMode(
        sessionId,
        userMessage,
        qualification,
        sendEvent
      );

      // Plan Mode pauses here for user approval
      // The plan will be executed after user approves via handlePlanApproval
      return `**Plan erstellt und wartet auf Genehmigung**\n\n${plan.summary}\n\n**Risiko:** ${plan.overallRisk}\n**Tasks:** ${plan.tasks.length}\n\nBitte überprüfe den Plan und bestätige die Ausführung.`;
    }

    // Phase 2: Execute based on task type (simple tasks without Plan Mode)
    stateManager.setPhase(sessionId, 'execution');

    let result: string;

    if (qualification.taskType === 'exploration' || qualification.targetAgent === 'chapo') {
      // CHAPO already executed the tools during qualification - return results directly
      result = qualification.reasoning;
    } else if (qualification.taskType === 'mixed' && qualification.targetAgent === null) {
      // Parallel execution of KODA and DEVO
      result = await runParallelExecution(
        sessionId,
        userMessage,
        qualification,
        projectRoot,
        sendEvent
      );
    } else if (qualification.targetAgent) {
      // Single agent execution (KODA or DEVO)
      result = await delegateToAgent(
        sessionId,
        qualification.targetAgent,
        userMessage,
        qualification.gatheredContext,
        sendEvent
      );
    } else {
      // Fallback: Chapo handles it (simple read-only task)
      result = qualification.reasoning || 'Task verarbeitet.';
    }

    // Phase 3: Review (conditional - skip for simple low-risk tasks)
    const skipReview = shouldSkipReview(taskComplexity, qualification.riskLevel, result);

    let finalResult: string;
    if (skipReview) {
      console.info('[agents] Skipping review phase', { taskComplexity, riskLevel: qualification.riskLevel });
      finalResult = result;
    } else {
      stateManager.setPhase(sessionId, 'review');
      sendEvent({ type: 'agent_start', agent: 'chapo', phase: 'review' });

      // CHAPO reviews the result
      finalResult = await runChapoReview(
        sessionId,
        userMessage,
        result,
        sendEvent
      );
    }

    // Send history
    sendEvent({
      type: 'agent_history',
      entries: stateManager.getHistory(sessionId),
    });

    sendEvent({ type: 'agent_complete', agent: 'chapo', result: finalResult });

    return finalResult;
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
 * FAST PATH: Execute simple tasks without qualification
 */
async function executeSimpleTask(
  sessionId: string,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  projectRoot: string | null,
  taskComplexity: TaskComplexityLevel,
  modelSelection: ModelSelection,
  sendEvent: SendEventFn
): Promise<string> {
  const targetAgent = detectTargetAgent(userMessage);

  console.info('[agents] executeSimpleTask', {
    sessionId,
    taskComplexity,
    targetAgent,
    model: `${modelSelection.provider}/${modelSelection.model}`,
  });

  stateManager.setPhase(sessionId, 'execution');
  stateManager.setActiveAgent(sessionId, targetAgent);
  sendEvent({ type: 'agent_start', agent: targetAgent, phase: 'execution' });

  const agent = getAgent(targetAgent);
  const agentToolNames = getToolsForAgent(targetAgent);
  const tools = getToolsForLLM().filter((t) => agentToolNames.includes(t.name));

  // Get CLAUDE.md project instructions from state
  const state = stateManager.getState(sessionId);
  const claudeMdBlock = (state?.taskContext.gatheredInfo['claudeMdBlock'] as string) || '';
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);

  const systemPrompt = `${agent.systemPrompt}
${devaiMdBlock}
${claudeMdBlock}
${projectRoot ? `Working Directory: ${projectRoot}` : ''}

WICHTIG: Dies ist eine einfache Anfrage. Führe sie DIREKT aus ohne zu fragen.`;

  const messages: LLMMessage[] = [
    ...conversationHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      })),
    { role: 'user', content: userMessage },
  ];

  // Single turn execution for simple tasks
  const response = await llmRouter.generateWithFallback(
    modelSelection.provider as 'anthropic' | 'openai' | 'gemini',
    {
      model: modelSelection.model,
      messages,
      systemPrompt,
      tools,
      toolsEnabled: true,
    }
  );

  let result = response.content || '';

  // Execute any tool calls
  if (response.toolCalls && response.toolCalls.length > 0) {
    for (const toolCall of response.toolCalls) {
      sendEvent({
        type: 'tool_call',
        agent: targetAgent,
        toolName: toolCall.name,
        args: toolCall.arguments,
      });

      const toolResult = await executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
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
        agent: targetAgent,
        toolName: toolCall.name,
        result: toolResult.result,
        success: toolResult.success,
      });

      // Append tool result to response
      if (toolResult.success) {
        result += `\n\n${JSON.stringify(toolResult.result, null, 2)}`;
      } else {
        result += `\n\nFehler: ${toolResult.error}`;
      }
    }
  }

  sendEvent({ type: 'agent_complete', agent: targetAgent, result });
  sendEvent({
    type: 'agent_history',
    entries: stateManager.getHistory(sessionId),
  });

  return result;
}

/**
 * CHAPO: Task Qualification Phase
 */
async function runChapoQualification(
  sessionId: string,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  projectRoot: string | null,
  sendEvent: SendEventFn,
  modelSelection?: ModelSelection
): Promise<QualificationResult> {
  sendEvent({ type: 'agent_thinking', agent: 'chapo', status: 'Analysiere Task...' });

  const chapo = getAgent('chapo');
  const chapoToolNames = getToolsForAgent('chapo');
  const tools = getToolsForLLM().filter((t) => chapoToolNames.includes(t.name));

  // Use provided model or default to agent's model
  const provider = (modelSelection?.provider || 'anthropic') as 'anthropic' | 'openai' | 'gemini';
  const model = modelSelection?.model || chapo.model;

  // Get CLAUDE.md project instructions from state (loaded in processRequest)
  const state = stateManager.getState(sessionId);
  const claudeMdBlock = (state?.taskContext.gatheredInfo['claudeMdBlock'] as string) || '';
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);

  const systemPrompt = `${chapo.systemPrompt}
${devaiMdBlock}
${claudeMdBlock}
${projectRoot ? `Working Directory: ${projectRoot}` : ''}

WICHTIG: Bei Read-Only Anfragen (Dateien auflisten, lesen, suchen, Git-Status) führe das Tool SOFORT aus.
Gib NUR JSON zurück wenn du an KODA/DEVO delegieren musst.

Falls Delegation nötig:
\`\`\`json
{
  "taskType": "code_change|devops|exploration|mixed",
  "riskLevel": "low|medium|high",
  "targetAgent": "koda|devo|chapo",
  "requiresApproval": true/false,
  "requiresClarification": false,
  "reasoning": "..."
}
\`\`\``;

  const messages: LLMMessage[] = [
    ...conversationHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      })),
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

    const response = await llmRouter.generateWithFallback(provider, {
      model,
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

    // Add assistant message with tool calls once
    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

    // Execute tools (read-only for CHAPO)
    // Meta-tools (delegation) are handled specially
    for (const toolCall of response.toolCalls) {
      sendEvent({
        type: 'tool_call',
        agent: 'chapo',
        toolName: toolCall.name,
        args: toolCall.arguments,
      });

      // Handle delegation meta-tools specially
      if (toolCall.name === 'delegateToScout') {
        // CHAPO wants to spawn SCOUT for exploration/web search
        const query = toolCall.arguments.query as string;
        const scope = (toolCall.arguments.scope as ScoutScope) || 'both';
        const context = toolCall.arguments.context as string | undefined;

        sendEvent({
          type: 'agent_thinking',
          agent: 'chapo',
          status: `Spawne SCOUT für: ${query}`,
        });

        try {
          const scoutResult = await spawnScout(sessionId, query, { scope, context, sendEvent });
          sendEvent({
            type: 'tool_result',
            agent: 'chapo',
            toolName: toolCall.name,
            result: scoutResult,
            success: true,
          });
          toolResults.push({
            toolUseId: toolCall.id,
            result: JSON.stringify(scoutResult, null, 2),
            isError: false,
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'SCOUT spawn failed';
          sendEvent({
            type: 'tool_result',
            agent: 'chapo',
            toolName: toolCall.name,
            result: { error: errMsg },
            success: false,
          });
          toolResults.push({
            toolUseId: toolCall.id,
            result: `Error: ${errMsg}`,
            isError: true,
          });
        }
        continue;
      }

      if (toolCall.name === 'delegateToKoda' || toolCall.name === 'delegateToDevo') {
        // These require proper delegation via the main flow - return qualification result
        const targetAgent = toolCall.name === 'delegateToKoda' ? 'koda' : 'devo';
        const taskDesc = toolCall.arguments.task as string;

        sendEvent({
          type: 'tool_result',
          agent: 'chapo',
          toolName: toolCall.name,
          result: { delegating: true, targetAgent, task: taskDesc },
          success: true,
        });

        // Return early with delegation result
        return {
          taskType: targetAgent === 'koda' ? 'code_change' : 'devops',
          riskLevel: 'medium',
          complexity: 'moderate',
          targetAgent,
          requiresApproval: false,
          requiresClarification: false,
          gatheredContext: {
            ...gatheredContext,
            delegationTask: taskDesc,
            delegationContext: toolCall.arguments.context,
            delegationFiles: toolCall.arguments.files as string[] | undefined,
          },
          reasoning: `CHAPO delegiert an ${targetAgent.toUpperCase()}: ${taskDesc}`,
        };
      }

      if (toolCall.name === 'askUser' || toolCall.name === 'requestApproval') {
        // Handle user questions and approval requests
        const question = toolCall.arguments.question || toolCall.arguments.description;
        toolResults.push({
          toolUseId: toolCall.id,
          result: `Frage an User: ${question}`,
          isError: false,
        });
        sendEvent({
          type: 'tool_result',
          agent: 'chapo',
          toolName: toolCall.name,
          result: { question },
          success: true,
        });
        continue;
      }

      // Regular tool execution
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

      const toolResult = buildToolResultContent(result);
      toolResults.push({
        toolUseId: toolCall.id,
        result: toolResult.content,
        isError: toolResult.isError,
      });
    }

    // Add tool results as a single user message
    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
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

  // Default qualification - Act First, Ask Later
  // If CHAPO didn't output JSON, it likely executed tools directly (exploration)
  // Don't ask for clarification - let the results speak
  return {
    taskType: 'exploration',
    riskLevel: 'low',
    complexity: 'simple',
    targetAgent: 'chapo',  // CHAPO handles it directly
    requiresApproval: false,
    requiresClarification: false,  // NEVER ask by default!
    gatheredContext,
    reasoning: finalContent || 'Read-Only Exploration ausgeführt',
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
  const agentToolNames = getToolsForAgent(targetAgent);
  const tools = getToolsForLLM().filter((t) => agentToolNames.includes(t.name));

  // Get CLAUDE.md project instructions from state
  const state = stateManager.getState(sessionId);
  const claudeMdBlock = (state?.taskContext.gatheredInfo['claudeMdBlock'] as string) || '';
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);

  const contextSummary = context.relevantFiles.length > 0
    ? `\n\nRelevante Dateien:\n${context.relevantFiles.join('\n')}`
    : '';

  const gitStatusSummary = context.gitStatus
    ? `\n\nGit Status:\n- Branch: ${context.gitStatus.branch}\n- Modified: ${context.gitStatus.modified.join(', ') || 'none'}`
    : '';

  const systemPrompt = `${agent.systemPrompt}
${devaiMdBlock}
${claudeMdBlock}
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

    // Add assistant message with tool calls once
    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

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

        toolResults.push({
          toolUseId: toolCall.id,
          result: `CHAPO Antwort: ${escalation.instructions || escalation.alternativeApproach}`,
          isError: false,
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

        toolResults.push({
          toolUseId: toolCall.id,
          result: `Error: Tool "${toolCall.name}" is not available to ${targetAgent}`,
          isError: true,
        });
        continue;
      }

      sendEvent({
        type: 'tool_call',
        agent: targetAgent,
        toolName: toolCall.name,
        args: toolCall.arguments,
      });

      const startTime = Date.now();
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

      const toolResult = buildToolResultContent(result);
      toolResults.push({
        toolUseId: toolCall.id,
        result: toolResult.content,
        isError: toolResult.isError,
      });
    }

    // Add tool results as a single user message
    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
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
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);
  const state = stateManager.getState(sessionId);
  const claudeMdBlock = (state?.taskContext.gatheredInfo['claudeMdBlock'] as string) || '';
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
    systemPrompt: `${chapo.systemPrompt}\n${devaiMdBlock}\n${claudeMdBlock}`,
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
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);
  const state = stateManager.getState(sessionId);
  const claudeMdBlock = (state?.taskContext.gatheredInfo['claudeMdBlock'] as string) || '';
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
    systemPrompt: `${chapo.systemPrompt}\n${devaiMdBlock}\n${claudeMdBlock}`,
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
  await stateManager.ensureStateLoaded(sessionId);
  const question = stateManager.removePendingQuestion(sessionId, questionId);
  if (!question) {
    return 'Frage nicht gefunden.';
  }

  const historyAgent: AgentName =
    question.fromAgent === 'chapo' || question.fromAgent === 'koda' || question.fromAgent === 'devo' || question.fromAgent === 'scout'
      ? question.fromAgent
      : 'chapo';

  const userResponse: UserResponse = {
    questionId,
    answer,
    timestamp: new Date().toISOString(),
  };

  stateManager.addHistoryEntry(
    sessionId,
    historyAgent,
    'respond',
    question,
    userResponse,
    { status: 'success' }
  );
  await stateManager.flushState(sessionId);

  // Continue processing with the new information
  const state = stateManager.getState(sessionId);
  if (state) {
    const history = await loadRecentConversationHistory(sessionId);
    const projectRoot = getProjectRootFromState(sessionId);
    return processRequest(
      sessionId,
      `${state.taskContext.originalRequest}\n\nZusätzliche Info: ${answer}`,
      history,
      projectRoot,
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
  await stateManager.ensureStateLoaded(sessionId);
  console.info('[agents] handleUserApproval', { sessionId, approvalId, approved });
  const approval = stateManager.removePendingApproval(sessionId, approvalId);
  if (!approval) {
    console.warn('[agents] approval not found', { sessionId, approvalId });
    return 'Freigabe-Anfrage nicht gefunden.';
  }

  if (!approved) {
    stateManager.setPhase(sessionId, 'error');
    await stateManager.flushState(sessionId);
    return 'Task abgebrochen durch User.';
  }

  // Some approvals are not "risk approvals" but a "continue" gate (e.g. new router step-limit).
  // Store a one-shot override in state so the next run can adjust its budget.
  const ctx = approval.context;
  if (ctx && typeof ctx === 'object' && ctx.kind === 'new_router_continue') {
    const maxTurns = (ctx as Record<string, unknown>).maxTurns;
    if (typeof maxTurns === 'number' && Number.isFinite(maxTurns) && maxTurns > 0) {
      stateManager.setGatheredInfo(sessionId, 'newRouterMaxTurnsOverride', maxTurns);
    }
  } else {
    // Only grant "global approval" for real risk approvals. Continue-gates should not disable future approval checks.
    stateManager.grantApproval(sessionId);
  }
  await stateManager.flushState(sessionId);

  const state = stateManager.getState(sessionId);
  if (state) {
    const history = await loadRecentConversationHistory(sessionId);
    const projectRoot = getProjectRootFromState(sessionId);
    return processRequest(
      sessionId,
      state.taskContext.originalRequest,
      history,
      projectRoot,
      sendEvent
    );
  }

  return 'Session nicht gefunden.';
}

// ============================================
// PLAN MODE FUNCTIONS
// ============================================

/**
 * Determine if Plan Mode is required based on qualification
 */
export function determinePlanModeRequired(qualification: QualificationResult): boolean {
  // Plan Mode is required for:
  // 1. Mixed tasks (both code and ops)
  // 2. Complex tasks
  // 3. High-risk tasks
  if (qualification.taskType === 'mixed') return true;
  if (qualification.complexity === 'complex') return true;
  if (qualification.riskLevel === 'high') return true;
  return false;
}

/**
 * Get CHAPO's strategic perspective
 */
async function getChapoPerspective(
  sessionId: string,
  userMessage: string,
  qualification: QualificationResult,
  sendEvent: SendEventFn
): Promise<ChapoPerspective> {
  sendEvent({ type: 'perspective_start', agent: 'chapo' });
  sendEvent({ type: 'agent_thinking', agent: 'chapo', status: 'Strategische Analyse...' });

  const chapo = getAgent('chapo');
  const state = stateManager.getState(sessionId);
  const claudeMdBlock = (state?.taskContext.gatheredInfo['claudeMdBlock'] as string) || '';
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);

  const systemPrompt = `${chapo.systemPrompt}
${devaiMdBlock}
${claudeMdBlock}

STRATEGISCHE ANALYSE FÜR PLAN MODE

Du analysierst als CHAPO (Task Coordinator) den Request aus strategischer Sicht.
Fokus auf:
- Koordinationsbedarf zwischen KODA und DEVO
- Risikobewertung und Impact-Bereiche
- Abhängigkeiten und kritische Pfade

Kontext aus Qualifizierung:
- Task-Typ: ${qualification.taskType}
- Risiko: ${qualification.riskLevel}
- Komplexität: ${qualification.complexity}
- Reasoning: ${qualification.reasoning}

Antworte mit einem JSON-Block:
\`\`\`json
{
  "strategicAnalysis": "Beschreibung der strategischen Überlegungen",
  "riskAssessment": "low|medium|high",
  "impactAreas": ["Bereich 1", "Bereich 2"],
  "coordinationNeeds": ["Koordinationspunkt 1", "Koordinationspunkt 2"],
  "concerns": ["Bedenken 1", "Bedenken 2"],
  "recommendations": ["Empfehlung 1", "Empfehlung 2"],
  "estimatedEffort": "trivial|small|medium|large",
  "dependencies": ["Abhängigkeit 1"]
}
\`\`\``;

  const response = await llmRouter.generate('anthropic', {
    model: chapo.model,
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt,
    toolsEnabled: false,
  });

  // Parse JSON response
  const jsonMatch = response.content.match(/```json\n([\s\S]*?)\n```/);
  let parsed: Record<string, unknown> = {};
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      console.warn('[agents] Failed to parse CHAPO perspective JSON');
    }
  }

  const perspective: ChapoPerspective = {
    agent: 'chapo',
    analysis: (parsed.strategicAnalysis as string) || response.content,
    concerns: (parsed.concerns as string[]) || [],
    recommendations: (parsed.recommendations as string[]) || [],
    estimatedEffort: (parsed.estimatedEffort as EffortEstimate) || 'medium',
    dependencies: (parsed.dependencies as string[]) || [],
    timestamp: new Date().toISOString(),
    strategicAnalysis: (parsed.strategicAnalysis as string) || '',
    riskAssessment: (parsed.riskAssessment as 'low' | 'medium' | 'high') || qualification.riskLevel,
    impactAreas: (parsed.impactAreas as string[]) || [],
    coordinationNeeds: (parsed.coordinationNeeds as string[]) || [],
  };

  sendEvent({ type: 'perspective_complete', agent: 'chapo', perspective });
  return perspective;
}

/**
 * Get KODA's code-focused perspective (read-only exploration)
 */
async function getKodaPerspective(
  sessionId: string,
  userMessage: string,
  qualification: QualificationResult,
  sendEvent: SendEventFn
): Promise<KodaPerspective> {
  sendEvent({ type: 'perspective_start', agent: 'koda' });
  sendEvent({ type: 'agent_thinking', agent: 'koda', status: 'Code-Impact-Analyse...' });

  const koda = getAgent('koda');
  const state = stateManager.getState(sessionId);
  const claudeMdBlock = (state?.taskContext.gatheredInfo['claudeMdBlock'] as string) || '';
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);

  // KODA gets read-only tools for exploration
  const readOnlyTools = getToolsForLLM().filter((t) =>
    ['fs_glob', 'fs_grep', 'fs_readFile', 'fs_listFiles', 'git_status', 'git_diff'].includes(t.name)
  );

  const contextSummary = qualification.gatheredContext.relevantFiles.length > 0
    ? `\n\nBereits gesammelte Dateien:\n${qualification.gatheredContext.relevantFiles.join('\n')}`
    : '';

  const systemPrompt = `${koda.systemPrompt}
${devaiMdBlock}
${claudeMdBlock}

CODE-IMPACT-ANALYSE FÜR PLAN MODE

Du analysierst als KODA (Senior Developer) den Request aus Code-Perspektive.
Du hast nur READ-ONLY Zugriff - keine Änderungen erlaubt!

Fokus auf:
- Welche Dateien müssen geändert werden?
- Welche Code-Patterns existieren bereits?
- Gibt es potenzielle Breaking Changes?
- Welche Tests sind nötig?

${contextSummary}

AUFGABE: Untersuche die Codebase und identifiziere alle betroffenen Dateien und Patterns.

Antworte am Ende mit einem JSON-Block:
\`\`\`json
{
  "analysis": "Zusammenfassung der Code-Analyse",
  "affectedFiles": ["path/to/file1.ts", "path/to/file2.ts"],
  "codePatterns": ["Pattern 1", "Pattern 2"],
  "potentialBreakingChanges": ["Breaking Change 1"],
  "testingRequirements": ["Test 1", "Test 2"],
  "concerns": ["Bedenken 1"],
  "recommendations": ["Empfehlung 1"],
  "estimatedEffort": "trivial|small|medium|large"
}
\`\`\``;

  const messages: LLMMessage[] = [{ role: 'user', content: userMessage }];

  // Run KODA with read-only tools for exploration
  let turn = 0;
  const MAX_TURNS = 5;
  let finalContent = '';

  while (turn < MAX_TURNS) {
    turn++;

    const response = await llmRouter.generate('anthropic', {
      model: koda.model,
      messages,
      systemPrompt,
      tools: readOnlyTools,
      toolsEnabled: true,
    });

    if (response.content) {
      finalContent = response.content;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

    for (const toolCall of response.toolCalls) {
      sendEvent({
        type: 'tool_call',
        agent: 'koda',
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
        agent: 'koda',
        toolName: toolCall.name,
        result: result.result,
        success: result.success,
      });

      const toolResult = buildToolResultContent(result);
      toolResults.push({
        toolUseId: toolCall.id,
        result: toolResult.content,
        isError: toolResult.isError,
      });
    }

    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
  }

  // Parse JSON response
  const jsonMatch = finalContent.match(/```json\n([\s\S]*?)\n```/);
  let parsed: Record<string, unknown> = {};
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      console.warn('[agents] Failed to parse KODA perspective JSON');
    }
  }

  const perspective: KodaPerspective = {
    agent: 'koda',
    analysis: (parsed.analysis as string) || finalContent,
    concerns: (parsed.concerns as string[]) || [],
    recommendations: (parsed.recommendations as string[]) || [],
    estimatedEffort: (parsed.estimatedEffort as EffortEstimate) || 'medium',
    timestamp: new Date().toISOString(),
    affectedFiles: (parsed.affectedFiles as string[]) || [],
    codePatterns: (parsed.codePatterns as string[]) || [],
    potentialBreakingChanges: (parsed.potentialBreakingChanges as string[]) || [],
    testingRequirements: (parsed.testingRequirements as string[]) || [],
  };

  sendEvent({ type: 'perspective_complete', agent: 'koda', perspective });
  return perspective;
}

/**
 * Get DEVO's ops-focused perspective (read-only exploration)
 */
async function getDevoPerspective(
  sessionId: string,
  userMessage: string,
  qualification: QualificationResult,
  sendEvent: SendEventFn
): Promise<DevoPerspective> {
  sendEvent({ type: 'perspective_start', agent: 'devo' });
  sendEvent({ type: 'agent_thinking', agent: 'devo', status: 'DevOps-Impact-Analyse...' });

  const devo = getAgent('devo');
  const state = stateManager.getState(sessionId);
  const claudeMdBlock = (state?.taskContext.gatheredInfo['claudeMdBlock'] as string) || '';
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);

  // DEVO gets read-only tools for exploration
  const readOnlyTools = getToolsForLLM().filter((t) =>
    ['fs_glob', 'fs_grep', 'fs_readFile', 'fs_listFiles', 'git_status', 'git_diff', 'pm2_status'].includes(t.name)
  );

  const systemPrompt = `${devo.systemPrompt}
${devaiMdBlock}
${claudeMdBlock}

DEVOPS-IMPACT-ANALYSE FÜR PLAN MODE

Du analysierst als DEVO (DevOps Engineer) den Request aus Ops-Perspektive.
Du hast nur READ-ONLY Zugriff - keine Änderungen erlaubt!

Fokus auf:
- Deployment-Auswirkungen
- Rollback-Strategie
- Betroffene Services
- Infrastruktur-Änderungen

AUFGABE: Untersuche die Infrastruktur und identifiziere alle Ops-relevanten Aspekte.

Antworte am Ende mit einem JSON-Block:
\`\`\`json
{
  "analysis": "Zusammenfassung der DevOps-Analyse",
  "deploymentImpact": ["Impact 1", "Impact 2"],
  "rollbackStrategy": "Beschreibung der Rollback-Strategie",
  "servicesAffected": ["Service 1", "Service 2"],
  "infrastructureChanges": ["Änderung 1"],
  "concerns": ["Bedenken 1"],
  "recommendations": ["Empfehlung 1"],
  "estimatedEffort": "trivial|small|medium|large"
}
\`\`\``;

  const messages: LLMMessage[] = [{ role: 'user', content: userMessage }];

  // Run DEVO with read-only tools for exploration
  let turn = 0;
  const MAX_TURNS = 5;
  let finalContent = '';

  while (turn < MAX_TURNS) {
    turn++;

    const response = await llmRouter.generate('anthropic', {
      model: devo.model,
      messages,
      systemPrompt,
      tools: readOnlyTools,
      toolsEnabled: true,
    });

    if (response.content) {
      finalContent = response.content;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

    for (const toolCall of response.toolCalls) {
      sendEvent({
        type: 'tool_call',
        agent: 'devo',
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
        agent: 'devo',
        toolName: toolCall.name,
        result: result.result,
        success: result.success,
      });

      const toolResult = buildToolResultContent(result);
      toolResults.push({
        toolUseId: toolCall.id,
        result: toolResult.content,
        isError: toolResult.isError,
      });
    }

    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
  }

  // Parse JSON response
  const jsonMatch = finalContent.match(/```json\n([\s\S]*?)\n```/);
  let parsed: Record<string, unknown> = {};
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch {
      console.warn('[agents] Failed to parse DEVO perspective JSON');
    }
  }

  const perspective: DevoPerspective = {
    agent: 'devo',
    analysis: (parsed.analysis as string) || finalContent,
    concerns: (parsed.concerns as string[]) || [],
    recommendations: (parsed.recommendations as string[]) || [],
    estimatedEffort: (parsed.estimatedEffort as EffortEstimate) || 'medium',
    timestamp: new Date().toISOString(),
    deploymentImpact: (parsed.deploymentImpact as string[]) || [],
    rollbackStrategy: (parsed.rollbackStrategy as string) || 'Manual rollback via git revert',
    servicesAffected: (parsed.servicesAffected as string[]) || [],
    infrastructureChanges: (parsed.infrastructureChanges as string[]) || [],
  };

  sendEvent({ type: 'perspective_complete', agent: 'devo', perspective });
  return perspective;
}

/**
 * CHAPO synthesizes all perspectives into an execution plan with tasks
 */
async function synthesizePlan(
  sessionId: string,
  userMessage: string,
  chapoPerspective: ChapoPerspective,
  kodaPerspective?: KodaPerspective,
  devoPerspective?: DevoPerspective,
  sendEvent?: SendEventFn
): Promise<{ summary: string; tasks: PlanTask[] }> {
  sendEvent?.({ type: 'agent_thinking', agent: 'chapo', status: 'Synthese des Plans...' });

  const chapo = getAgent('chapo');
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);
  const plan = stateManager.getCurrentPlan(sessionId);
  const planId = plan?.planId || nanoid();

  const perspectivesSummary = `
CHAPO (Strategisch):
- Analyse: ${chapoPerspective.strategicAnalysis}
- Risiko: ${chapoPerspective.riskAssessment}
- Impact-Bereiche: ${chapoPerspective.impactAreas.join(', ')}
- Koordinationsbedarf: ${chapoPerspective.coordinationNeeds.join(', ')}
- Bedenken: ${chapoPerspective.concerns.join(', ')}
- Empfehlungen: ${chapoPerspective.recommendations.join(', ')}

${kodaPerspective ? `KODA (Code):
- Analyse: ${kodaPerspective.analysis}
- Betroffene Dateien: ${kodaPerspective.affectedFiles.join(', ')}
- Code-Patterns: ${kodaPerspective.codePatterns.join(', ')}
- Breaking Changes: ${kodaPerspective.potentialBreakingChanges.join(', ')}
- Tests: ${kodaPerspective.testingRequirements.join(', ')}
- Bedenken: ${kodaPerspective.concerns.join(', ')}` : ''}

${devoPerspective ? `DEVO (DevOps):
- Analyse: ${devoPerspective.analysis}
- Deployment-Impact: ${devoPerspective.deploymentImpact.join(', ')}
- Rollback: ${devoPerspective.rollbackStrategy}
- Services: ${devoPerspective.servicesAffected.join(', ')}
- Infra-Änderungen: ${devoPerspective.infrastructureChanges.join(', ')}
- Bedenken: ${devoPerspective.concerns.join(', ')}` : ''}`;

  const systemPrompt = `${chapo.systemPrompt}
${devaiMdBlock}

PLAN-SYNTHESE

Du hast die Perspektiven aller Agenten erhalten. Erstelle einen Execution Plan mit konkreten Tasks.

${perspectivesSummary}

ANFORDERUNGEN:
1. Erstelle eine klare Zusammenfassung des Plans
2. Definiere konkrete Tasks mit:
   - subject: Kurzer Titel (imperativ, z.B. "Update API endpoint")
   - description: Detaillierte Beschreibung
   - activeForm: Präsens Partizip für Spinner (z.B. "Updating API endpoint...")
   - assignedAgent: "koda" | "devo"
   - priority: "critical" | "high" | "normal" | "low"
   - blockedBy: Array von Task-Indizes die zuerst fertig sein müssen

Antworte mit einem JSON-Block:
\`\`\`json
{
  "summary": "Zusammenfassung des gesamten Plans",
  "tasks": [
    {
      "subject": "Task-Titel",
      "description": "Detaillierte Beschreibung",
      "activeForm": "Doing something...",
      "assignedAgent": "koda|devo",
      "priority": "normal",
      "blockedByIndices": []
    }
  ]
}
\`\`\``;

  const response = await llmRouter.generate('anthropic', {
    model: chapo.model,
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt,
    toolsEnabled: false,
  });

  // Parse JSON response
  const jsonMatch = response.content.match(/```json\n([\s\S]*?)\n```/);
  let summary = 'Plan erstellt.';
  const tasks: PlanTask[] = [];

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      summary = parsed.summary || summary;

      // Create tasks and track IDs for dependency resolution
      const taskIds: string[] = [];

      for (const taskData of parsed.tasks || []) {
        const taskId = nanoid();
        taskIds.push(taskId);

        const task: PlanTask = {
          taskId,
          planId,
          subject: taskData.subject || 'Unnamed task',
          description: taskData.description || '',
          activeForm: taskData.activeForm || `${taskData.subject}...`,
          assignedAgent: taskData.assignedAgent || 'koda',
          priority: (taskData.priority as TaskPriority) || 'normal',
          status: 'pending',
          blockedBy: [], // Will be resolved after all tasks are created
          blocks: [],
          createdAt: new Date().toISOString(),
        };

        // Store blockedByIndices temporarily for resolution
        (task as PlanTask & { _blockedByIndices?: number[] })._blockedByIndices =
          taskData.blockedByIndices || [];

        tasks.push(task);
      }

      // Resolve blockedBy indices to actual taskIds
      for (const task of tasks) {
        const indices = (task as PlanTask & { _blockedByIndices?: number[] })._blockedByIndices || [];
        for (const idx of indices) {
          if (idx >= 0 && idx < taskIds.length) {
            task.blockedBy.push(taskIds[idx]);
            // Also update blocks on the blocker
            const blockerTask = tasks[idx];
            if (blockerTask && !blockerTask.blocks.includes(task.taskId)) {
              blockerTask.blocks.push(task.taskId);
            }
          }
        }
        delete (task as PlanTask & { _blockedByIndices?: number[] })._blockedByIndices;
      }
    } catch (e) {
      console.warn('[agents] Failed to parse plan synthesis JSON:', e);
    }
  }

  return { summary, tasks };
}

/**
 * Run Plan Mode - orchestrate multi-perspective planning
 */
export async function runPlanMode(
  sessionId: string,
  userMessage: string,
  qualification: QualificationResult,
  sendEvent: SendEventFn
): Promise<ExecutionPlan> {
  console.info('[agents] Starting Plan Mode', { sessionId, taskType: qualification.taskType });

  sendEvent({ type: 'plan_start', sessionId });

  // Phase 1: Get CHAPO's strategic perspective
  const chapoPerspective = await getChapoPerspective(
    sessionId,
    userMessage,
    qualification,
    sendEvent
  );

  // Create the plan in state
  const plan = stateManager.createPlan(sessionId, chapoPerspective);

  // Phase 2: Get KODA and DEVO perspectives in parallel (based on task type)
  const perspectivePromises: Promise<KodaPerspective | DevoPerspective | null>[] = [];

  if (qualification.taskType === 'code_change' || qualification.taskType === 'mixed') {
    perspectivePromises.push(
      getKodaPerspective(sessionId, userMessage, qualification, sendEvent)
    );
  } else {
    perspectivePromises.push(Promise.resolve(null));
  }

  if (qualification.taskType === 'devops' || qualification.taskType === 'mixed') {
    perspectivePromises.push(
      getDevoPerspective(sessionId, userMessage, qualification, sendEvent)
    );
  } else {
    perspectivePromises.push(Promise.resolve(null));
  }

  const [kodaResult, devoResult] = await Promise.all(perspectivePromises);

  // Add perspectives to plan
  if (kodaResult) {
    stateManager.addKodaPerspective(sessionId, kodaResult as KodaPerspective);
  }
  if (devoResult) {
    stateManager.addDevoPerspective(sessionId, devoResult as DevoPerspective);
  }

  // Phase 3: CHAPO synthesizes all perspectives into tasks
  const { summary, tasks } = await synthesizePlan(
    sessionId,
    userMessage,
    chapoPerspective,
    kodaResult as KodaPerspective | undefined,
    devoResult as DevoPerspective | undefined,
    sendEvent
  );

  // Finalize the plan
  const finalPlan = stateManager.finalizePlan(sessionId, summary, tasks);

  if (finalPlan) {
    sendEvent({ type: 'plan_ready', plan: finalPlan });
    sendEvent({ type: 'plan_approval_request', plan: finalPlan });

    // Send task events
    for (const task of tasks) {
      sendEvent({ type: 'task_created', task });
    }
    sendEvent({ type: 'tasks_list', tasks });
  }

  return finalPlan || plan;
}

/**
 * Execute an approved plan
 */
export async function executePlan(
  sessionId: string,
  sendEvent: SendEventFn
): Promise<string> {
  const plan = stateManager.getCurrentPlan(sessionId);
  if (!plan) {
    return 'Kein Plan gefunden.';
  }

  if (plan.status !== 'approved') {
    return 'Plan ist nicht genehmigt.';
  }

  console.info('[agents] Executing plan', { sessionId, planId: plan.planId });

  // Mark plan as executing
  stateManager.startPlanExecution(sessionId);

  const results: string[] = [];

  // Execute tasks in dependency order
  while (true) {
    const nextTask = stateManager.getNextTask(sessionId);
    if (!nextTask) {
      // Check if all tasks are done
      if (stateManager.areAllTasksCompleted(sessionId)) {
        break;
      }
      // If not all completed but no next task, we might be stuck
      const progress = stateManager.getTaskProgress(sessionId);
      if (progress.inProgress === 0 && progress.pending > 0) {
        // Deadlock - tasks are blocked
        console.warn('[agents] Task execution deadlock detected');
        break;
      }
      // Wait a bit and try again
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }

    // Mark task as in progress
    stateManager.updateTaskStatus(sessionId, nextTask.taskId, 'in_progress');
    sendEvent({
      type: 'task_started',
      taskId: nextTask.taskId,
      agent: nextTask.assignedAgent,
    });
    sendEvent({
      type: 'task_update',
      taskId: nextTask.taskId,
      status: 'in_progress',
      activeForm: nextTask.activeForm,
    });

    try {
      // Delegate to assigned agent
      const context: GatheredContext = {
        relevantFiles: plan.kodaPerspective?.affectedFiles || [],
        fileContents: {},
      };

      const result = await delegateToAgent(
        sessionId,
        nextTask.assignedAgent,
        nextTask.description,
        context,
        sendEvent
      );

      // Mark task as completed
      stateManager.updateTaskStatus(sessionId, nextTask.taskId, 'completed', {
        result,
        progress: 100,
      });
      sendEvent({
        type: 'task_completed',
        taskId: nextTask.taskId,
        result,
      });
      sendEvent({
        type: 'task_update',
        taskId: nextTask.taskId,
        status: 'completed',
        progress: 100,
      });

      results.push(`✓ ${nextTask.subject}: ${result.substring(0, 100)}...`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Mark task as failed
      stateManager.updateTaskStatus(sessionId, nextTask.taskId, 'failed', {
        error: errorMessage,
      });
      sendEvent({
        type: 'task_failed',
        taskId: nextTask.taskId,
        error: errorMessage,
      });
      sendEvent({
        type: 'task_update',
        taskId: nextTask.taskId,
        status: 'failed',
      });

      // Skip blocked tasks
      const skipped = stateManager.skipBlockedTasks(sessionId, nextTask.taskId);
      for (const skippedTask of skipped) {
        sendEvent({
          type: 'task_update',
          taskId: skippedTask.taskId,
          status: 'skipped',
        });
      }

      results.push(`✗ ${nextTask.subject}: ${errorMessage}`);
    }
  }

  // Complete the plan
  stateManager.completePlan(sessionId);

  // Get final progress
  const progress = stateManager.getTaskProgress(sessionId);

  return `Plan ausgeführt (${progress.completed}/${progress.total} Tasks erfolgreich):\n\n${results.join('\n')}`;
}

/**
 * Handle plan approval/rejection
 */
export async function handlePlanApproval(
  sessionId: string,
  planId: string,
  approved: boolean,
  reason?: string,
  sendEvent?: SendEventFn
): Promise<string> {
  console.info('[agents] handlePlanApproval', { sessionId, planId, approved });

  const plan = stateManager.getCurrentPlan(sessionId);
  if (!plan || plan.planId !== planId) {
    return 'Plan nicht gefunden.';
  }

  if (approved) {
    stateManager.approvePlan(sessionId);
    sendEvent?.({ type: 'plan_approved', planId });

    // Execute the plan
    return executePlan(sessionId, sendEvent || (() => {}));
  } else {
    stateManager.rejectPlan(sessionId, reason || 'Abgelehnt durch Benutzer');
    sendEvent?.({ type: 'plan_rejected', planId, reason: reason || 'Abgelehnt durch Benutzer' });

    return `Plan abgelehnt${reason ? `: ${reason}` : ''}. Bitte gib mir mehr Details oder einen anderen Ansatz.`;
  }
}

/**
 * Get current plan for a session
 */
export function getCurrentPlan(sessionId: string): ExecutionPlan | undefined {
  return stateManager.getCurrentPlan(sessionId);
}

/**
 * Get tasks for a session
 */
export function getTasks(sessionId: string): PlanTask[] {
  return stateManager.getTasks(sessionId);
}

// ============================================
// SCOUT AGENT FUNCTIONS
// ============================================

/**
 * Spawn SCOUT agent for exploration or web search
 */
export async function spawnScout(
  sessionId: string,
  query: string,
  options: {
    scope?: ScoutScope;
    context?: string;
    sendEvent?: SendEventFn;
  } = {}
): Promise<ScoutResult> {
  const { scope = 'both', context, sendEvent } = options;

  console.info('[agents] Spawning SCOUT', { sessionId, query, scope });

  sendEvent?.({ type: 'scout_start', query, scope });

  const scout = getAgent('scout');
  const devaiMdBlock = await getDevaiMdBlockForSession(sessionId);
  const scoutToolNames = getToolsForAgent('scout');
  const tools = getToolsForLLM().filter((t) => scoutToolNames.includes(t.name));

  // Build focused prompt based on scope
  let prompt = `EXPLORE: ${query}`;

  if (scope === 'codebase') {
    prompt += '\n\nFOKUS: Nur Codebase-Exploration. Nutze KEINE Web-Tools (web_search, web_fetch).';
  } else if (scope === 'web') {
    prompt += '\n\nFOKUS: Nur Web-Recherche. Nutze KEINE Dateisystem-Tools.';
  } else {
    prompt += '\n\nFOKUS: Kombiniere Codebase-Exploration und Web-Recherche für beste Ergebnisse.';
  }

  if (context) {
    prompt += `\n\nZUSÄTZLICHER KONTEXT: ${context}`;
  }

  const messages: LLMMessage[] = [{ role: 'user', content: prompt }];

  // Run SCOUT with limited turns
  let turn = 0;
  const MAX_TURNS = 5;
  let finalContent = '';

  while (turn < MAX_TURNS) {
    turn++;

    const response = await llmRouter.generate('anthropic', {
      model: scout.model,
      messages,
      systemPrompt: `${scout.systemPrompt}\n${devaiMdBlock}`,
      tools,
      toolsEnabled: true,
    });

    if (response.content) {
      finalContent = response.content;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: 'assistant',
      content: response.content || '',
      toolCalls: response.toolCalls,
    });

    const toolResults: { toolUseId: string; result: string; isError: boolean }[] = [];

    for (const toolCall of response.toolCalls) {
      // Emit scout_tool event
      sendEvent?.({ type: 'scout_tool', tool: toolCall.name });

      // Check for escalation
      if (toolCall.name === 'escalateToChapo') {
        // SCOUT is escalating - return partial results
        const result = parseScoutResult(finalContent);
        result.recommendations.push('SCOUT eskalierte zu CHAPO - weitere Analyse erforderlich');
        sendEvent?.({ type: 'scout_complete', summary: result });
        return result;
      }

      const result = await executeToolWithApprovalBridge(toolCall.name, toolCall.arguments, {
        onActionPending: (action) => {
          sendEvent?.({
            type: 'action_pending',
            actionId: action.id,
            toolName: action.toolName,
            toolArgs: action.toolArgs,
            description: action.description,
            preview: action.preview,
          });
        },
      });

      const toolResult = buildToolResultContent(result);
      toolResults.push({
        toolUseId: toolCall.id,
        result: toolResult.content,
        isError: toolResult.isError,
      });
    }

    messages.push({
      role: 'user',
      content: '',
      toolResults,
    });
  }

  // Parse SCOUT's JSON response
  const result = parseScoutResult(finalContent);

  sendEvent?.({ type: 'scout_complete', summary: result });

  console.info('[agents] SCOUT complete', {
    sessionId,
    filesFound: result.relevantFiles.length,
    confidence: result.confidence,
  });

  return result;
}

/**
 * Parse SCOUT's response into a ScoutResult
 */
function parseScoutResult(response: string): ScoutResult {
  // Try to extract JSON from response
  const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) ||
                    response.match(/\{[\s\S]*"summary"[\s\S]*\}/);

  if (jsonMatch) {
    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      return {
        summary: parsed.summary || 'Keine Zusammenfassung verfügbar',
        relevantFiles: parsed.relevantFiles || [],
        codePatterns: parsed.codePatterns || {},
        webFindings: (parsed.webFindings || []).map((f: { title?: string; url?: string; relevance?: string }) => ({
          title: f.title || 'Unbekannt',
          url: f.url || '',
          relevance: f.relevance || '',
        })),
        recommendations: parsed.recommendations || [],
        confidence: parsed.confidence || 'medium',
      };
    } catch (e) {
      console.warn('[agents] Failed to parse SCOUT JSON response:', e);
    }
  }

  // Fallback: return raw response as summary
  return {
    summary: response,
    relevantFiles: [],
    codePatterns: {},
    webFindings: [],
    recommendations: [],
    confidence: 'low',
  };
}

/**
 * Export spawnScout for use by other modules
 */
export { spawnScout as delegateToScout };
