import * as stateManager from '../stateManager.js';
import { classifyTaskComplexity, selectModel } from '../../llm/modelSelector.js';
import { ChapoLoop } from '../chapo-loop.js';
import type {
  ExecutionPlan,
  PlanTask,
} from '../types.js';
import { getProjectRootFromState } from './requestUtils.js';
import type { SendEventFn } from './shared.js';

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
 * Execute an approved plan.
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
 * Handle plan approval/rejection.
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
