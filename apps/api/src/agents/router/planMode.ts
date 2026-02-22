import * as stateManager from '../stateManager.js';
import type {
  DevoPerspective,
  ExecutionPlan,
  PlanTask,
  QualificationResult,
} from '../types.js';
import { getChapoPerspective } from './perspectives/chapoPerspective.js';
import { getDevoPerspective } from './perspectives/devoPerspective.js';
import { synthesizePlan } from './planSynthesizer.js';
import { executePlan, handlePlanApproval } from './planExecutor.js';
import type { SendEventFn } from './shared.js';

/**
 * Determine if Plan Mode is required based on qualification.
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
 * Run Plan Mode - orchestrate multi-perspective planning.
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

export { executePlan, handlePlanApproval };

/**
 * Get current plan for a session.
 */
export function getCurrentPlan(sessionId: string): ExecutionPlan | undefined {
  return stateManager.getCurrentPlan(sessionId);
}

/**
 * Get tasks for a session.
 */
export function getTasks(sessionId: string): PlanTask[] {
  return stateManager.getTasks(sessionId);
}
