import { nanoid } from 'nanoid';
import { llmRouter } from '../../llm/router.js';
import { getToolsForLLM } from '../../tools/registry.js';
import { executeToolWithApprovalBridge } from '../../actions/approvalBridge.js';
import type { LLMMessage } from '../../llm/types.js';
import * as stateManager from '../stateManager.js';
import { getCombinedSystemContextBlock } from '../systemContext.js';
import {
  classifyTaskComplexity,
  selectModel,
} from '../../llm/modelSelector.js';
import { ChapoLoop } from '../chapo-loop.js';
import type {
  ChapoPerspective,
  DevoPerspective,
  EffortEstimate,
  ExecutionPlan,
  PlanTask,
  QualificationResult,
  RiskLevel,
  TaskPriority,
} from '../types.js';
import { getAgent } from './agentAccess.js';
import { buildToolResultContent, getProjectRootFromState } from './requestUtils.js';
import type { SendEventFn } from './shared.js';

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
  sendEvent: SendEventFn,
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

  const response = await llmRouter.generateWithFallback('zai', {
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
  sendEvent: SendEventFn,
): Promise<DevoPerspective> {
  void qualification;
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

    const response = await llmRouter.generateWithFallback('zai', {
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
        agentName: 'devo',
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
  sendEvent?: SendEventFn,
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

  const response = await llmRouter.generateWithFallback('zai', {
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
      const parsed = JSON.parse(jsonMatch[1]) as {
        summary?: string;
        tasks?: Array<{
          subject?: string;
          description?: string;
          activeForm?: string;
          assignedAgent?: string;
          priority?: TaskPriority;
          blockedByIndices?: number[];
        }>;
      };
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
          assignedAgent: (taskData.assignedAgent as 'devo' | 'chapo' | 'scout' | 'caio') || 'devo',
          priority: taskData.priority || 'normal',
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
  sendEvent: SendEventFn,
): Promise<ExecutionPlan> {
  console.info('[agents] Starting Plan Mode', { sessionId, taskType: qualification.taskType });

  sendEvent({ type: 'plan_start', sessionId });

  // Phase 1: Get CHAPO's strategic perspective
  const chapoPerspective = await getChapoPerspective(
    sessionId,
    userMessage,
    qualification,
    sendEvent,
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
    sendEvent,
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
  sendEvent: SendEventFn,
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
  sendEvent: SendEventFn,
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
        sendEvent,
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
  sendEvent?: SendEventFn,
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
  }

  stateManager.rejectPlan(sessionId, reason || 'Abgelehnt durch Benutzer');
  sendEvent?.({ type: 'plan_rejected', planId, reason: reason || 'Abgelehnt durch Benutzer' });

  return `Plan abgelehnt${reason ? `: ${reason}` : ''}. Bitte gib mir mehr Details oder einen anderen Ansatz.`;
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
