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
  UserQuestion,
  UserResponse,
  QualificationResult,
  TaskType,
  // Plan Mode types
  ChapoPerspective,
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
import { getToolsForLLM, toolRegistry } from '../tools/registry.js';
import { mcpManager } from '../mcp/index.js';
import { executeToolWithApprovalBridge } from '../actions/approvalBridge.js';
import type { LLMMessage } from '../llm/types.js';

// Agent definitions
import { CHAPO_AGENT } from './chapo.js';
import { DEVO_AGENT } from './devo.js';
import { SCOUT_AGENT } from './scout.js';
import { getMessages, getTrustMode } from '../db/queries.js';
import { rememberNote } from '../memory/workspaceMemory.js';
import { getCombinedSystemContextBlock, warmSystemContextForSession } from './systemContext.js';
import {
  classifyTaskComplexity,
  selectModel,
} from '../llm/modelSelector.js';
import { ChapoLoop } from './chapo-loop.js';

export type SendEventFn = (event: AgentStreamEvent) => void;

const AGENTS: Record<AgentName, AgentDefinition> = {
  chapo: CHAPO_AGENT,
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

function extractExplicitRememberNote(text: string): { note: string; promoteToLongTerm: boolean } | null {
  const patterns = [
    /^\s*(?:remember(?:\s+this)?|please\s+remember|note\s+this)\s*[:,-]?\s+(.+)$/i,
    /^\s*(?:merk\s+dir(?:\s+bitte)?|merke\s+dir)\s*[:,-]?\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const note = match[1].trim();
    if (note.length < 3) return null;
    if (note.endsWith('?')) return null;

    const promoteToLongTerm = /\b(always|dauerhaft|langfristig|important|wichtig)\b/i.test(text);
    return { note, promoteToLongTerm };
  }

  return null;
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

function buildToolResultContent(result: { success: boolean; result?: unknown; error?: string }): { content: string; isError: boolean } {
  if (result.success) {
    const value = result.result === undefined ? '' : JSON.stringify(result.result);
    return { content: value || 'OK', isError: false };
  }
  const content = result.error ? `Error: ${result.error}` : 'Error: Tool failed without a message.';
  return { content, isError: true };
}

function buildPlanQualificationForComplexTask(userMessage: string): QualificationResult {
  const lower = userMessage.toLowerCase();
  const looksDevOps = /(deploy|pm2|server|ssh|infra|docker|nginx|k8s|kubernetes)/.test(lower);
  const taskType: TaskType = looksDevOps ? 'devops' : 'mixed';

  return {
    taskType,
    riskLevel: 'high',
    complexity: 'complex',
    targetAgent: looksDevOps ? 'devo' : null,
    requiresApproval: false,
    requiresClarification: false,
    gatheredContext: { relevantFiles: [], fileContents: {} },
    reasoning: 'Complex task routed directly to Plan Mode pre-qualification.',
  };
}

// Get agent definition
export function getAgent(name: AgentName): AgentDefinition {
  return AGENTS[name];
}

// Get tools for a specific agent (native + MCP + meta — via unified registry)
export function getToolsForAgent(agent: AgentName): string[] {
  // Primary source: unified registry (includes native + meta tools registered at module load)
  const registryTools = toolRegistry.getAgentTools(agent);

  // Also include MCP tools (registered at runtime, may not be in agent access yet)
  const mcpTools = mcpManager.getToolsForAgent(agent);
  const combined = new Set([...registryTools, ...mcpTools]);
  return Array.from(combined);
}

// Check if an agent can use a specific tool
export function canAgentUseTool(agent: AgentName, toolName: string): boolean {
  // Check unified registry first, then fall back to MCP manager
  return toolRegistry.canAccess(agent, toolName) ||
    mcpManager.getToolsForAgent(agent).includes(toolName);
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

  const explicitRemember = extractExplicitRememberNote(userMessage);
  if (explicitRemember) {
    try {
      const saved = await rememberNote(explicitRemember.note, {
        sessionId,
        source: 'chat.explicit_remember',
        promoteToLongTerm: explicitRemember.promoteToLongTerm,
      });
      const longTermInfo = saved.longTerm ? ` und zusaetzlich in ${saved.longTerm.filePath}` : '';
      return `Notiert. Gespeichert in ${saved.daily.filePath}${longTermInfo}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Ich konnte die Notiz nicht speichern: ${message}`;
    }
  }

  // Keep the last actual request for approval/resume flows.
  stateManager.setOriginalRequest(sessionId, userMessage);
  await warmSystemContextForSession(sessionId, projectRoot || getProjectRootFromState(sessionId));

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
  const trustMode = await getTrustMode();
  const approvalsBypassed = trustMode === 'trusted';
  stateManager.setGatheredInfo(sessionId, 'trustMode', trustMode);

  try {
    // Pre-loop gate: keep full qualification + Plan Mode for complex tasks.
    if (taskComplexity === 'complex') {
      stateManager.setPhase(sessionId, 'qualification');
      stateManager.setActiveAgent(sessionId, 'chapo');
      sendEvent({ type: 'agent_start', agent: 'chapo', phase: 'qualification' });

      const qualification = buildPlanQualificationForComplexTask(userMessage);

      stateManager.setQualificationResult(sessionId, qualification);

      if (determinePlanModeRequired(qualification)) {
        console.info('[agents] Plan Mode required', {
          sessionId,
          taskType: qualification.taskType,
          complexity: qualification.complexity,
          riskLevel: qualification.riskLevel,
        });

        const plan = await runPlanMode(
          sessionId,
          userMessage,
          qualification,
          sendEvent
        );

        if (approvalsBypassed) {
          console.info('[agents] trusted mode: auto-approving generated plan', {
            sessionId,
            planId: plan.planId,
          });
          return handlePlanApproval(
            sessionId,
            plan.planId,
            true,
            'Auto-approved in trusted mode',
            sendEvent
          );
        }

        return `**Plan erstellt und wartet auf Genehmigung**\n\n${plan.summary}\n\n**Risiko:** ${plan.overallRisk}\n**Tasks:** ${plan.tasks.length}\n\nBitte überprüfe den Plan und bestätige die Ausführung.`;
      }
    }

    const loopProjectRoot = projectRoot || getProjectRootFromState(sessionId);
    const loop = new ChapoLoop(sessionId, sendEvent, loopProjectRoot, modelSelection, {
      selfValidationEnabled: taskComplexity !== 'trivial',
      maxIterations: taskComplexity === 'trivial' ? 8 : 20,
    });
    const loopResult = await loop.run(userMessage, history);

    if (loopResult.status === 'error') {
      stateManager.setPhase(sessionId, 'error');
    }

    return loopResult.answer;
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
    question.fromAgent === 'chapo' || question.fromAgent === 'devo' || question.fromAgent === 'scout'
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

  stateManager.grantApproval(sessionId);
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
  const systemContextBlock = getCombinedSystemContextBlock(sessionId);

  const systemPrompt = `${chapo.systemPrompt}
${systemContextBlock}

STRATEGISCHE ANALYSE FÜR PLAN MODE

Du analysierst als CHAPO (Task Coordinator) den Request aus strategischer Sicht.
Fokus auf:
- Koordinationsbedarf für DEVO
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
  const systemContextBlock = getCombinedSystemContextBlock(sessionId);

  // DEVO gets read-only tools for exploration
  const readOnlyTools = getToolsForLLM().filter((t) =>
    ['fs_glob', 'fs_grep', 'fs_readFile', 'fs_listFiles', 'git_status', 'git_diff', 'pm2_status'].includes(t.name)
  );

  const systemPrompt = `${devo.systemPrompt}
${systemContextBlock}

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
  devoPerspective?: DevoPerspective,
  sendEvent?: SendEventFn
): Promise<{ summary: string; tasks: PlanTask[] }> {
  sendEvent?.({ type: 'agent_thinking', agent: 'chapo', status: 'Synthese des Plans...' });

  const chapo = getAgent('chapo');
  const systemContextBlock = getCombinedSystemContextBlock(sessionId);
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

${devoPerspective ? `DEVO (Developer & DevOps):
- Analyse: ${devoPerspective.analysis}
- Deployment-Impact: ${devoPerspective.deploymentImpact.join(', ')}
- Rollback: ${devoPerspective.rollbackStrategy}
- Services: ${devoPerspective.servicesAffected.join(', ')}
- Infra-Änderungen: ${devoPerspective.infrastructureChanges.join(', ')}
- Bedenken: ${devoPerspective.concerns.join(', ')}` : ''}`;

  const systemPrompt = `${chapo.systemPrompt}
${systemContextBlock}

PLAN-SYNTHESE

Du hast die Perspektiven aller Agenten erhalten. Erstelle einen Execution Plan mit konkreten Tasks.

${perspectivesSummary}

ANFORDERUNGEN:
1. Erstelle eine klare Zusammenfassung des Plans
2. Definiere konkrete Tasks mit:
   - subject: Kurzer Titel (imperativ, z.B. "Update API endpoint")
   - description: Detaillierte Beschreibung
   - activeForm: Präsens Partizip für Spinner (z.B. "Updating API endpoint...")
   - assignedAgent: "devo"
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
      "assignedAgent": "devo",
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
          assignedAgent: taskData.assignedAgent || 'devo',
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

  // Phase 2: Get DEVO perspective (based on task type)
  let devoResult: DevoPerspective | null = null;

  if (qualification.taskType === 'devops' || qualification.taskType === 'mixed' || qualification.taskType === 'code_change') {
    devoResult = await getDevoPerspective(sessionId, userMessage, qualification, sendEvent);
  }

  // Add perspective to plan
  if (devoResult) {
    stateManager.addDevoPerspective(sessionId, devoResult);
  }

  // Phase 3: CHAPO synthesizes all perspectives into tasks
  const { summary, tasks } = await synthesizePlan(
    sessionId,
    userMessage,
    chapoPerspective,
    devoResult ?? undefined,
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

async function executePlanTaskWithLoop(
  sessionId: string,
  task: PlanTask,
  plan: ExecutionPlan,
  sendEvent: SendEventFn
): Promise<string> {
  const projectRoot = getProjectRootFromState(sessionId);
  const complexity = classifyTaskComplexity(task.description);
  const modelSelection = selectModel(complexity);

  const loop = new ChapoLoop(sessionId, sendEvent, projectRoot, modelSelection, {
    selfValidationEnabled: true,
    maxIterations: 20,
  });

  const taskPrompt = `GENEHMIGTER PLAN-TASK

Task-ID: ${task.taskId}
Titel: ${task.subject}
Zugewiesener Agent: ${task.assignedAgent}
Beschreibung: ${task.description}
${task.activeForm ? `Aktive Form: ${task.activeForm}` : ''}
${plan.devoPerspective?.servicesAffected?.length ? `Betroffene Services: ${plan.devoPerspective.servicesAffected.join(', ')}` : ''}

Führe diesen Task jetzt aus und gib ein präzises Ergebnis zurück.
WICHTIG:
- Kein neuer Gesamtplan
- Nur diese Task ausführen
- Nur bei absolutem Blocker eine Rückfrage stellen`;

  const result = await loop.run(taskPrompt, []);

  if (result.status === 'completed') {
    return result.answer;
  }

  if (result.status === 'waiting_for_user') {
    throw new Error(`Task benötigt Rückfrage: ${result.question || result.answer}`);
  }

  throw new Error(result.answer || 'Task execution failed in decision loop');
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
      const result = await executePlanTaskWithLoop(
        sessionId,
        nextTask,
        plan,
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
  const systemContextBlock = getCombinedSystemContextBlock(sessionId);
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
      systemPrompt: `${scout.systemPrompt}\n${systemContextBlock}`,
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
