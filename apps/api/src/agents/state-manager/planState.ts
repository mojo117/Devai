import { nanoid } from 'nanoid';
import { getOrCreateState, getState, schedulePersist } from './core.js';
import type {
  ChapoPerspective,
  DevoPerspective,
  ExecutionPlan,
  PlanTask,
  RiskLevel,
} from '../types.js';

/**
 * Create a new execution plan with CHAPO's initial perspective
 */
export function createPlan(
  sessionId: string,
  chapoPerspective: ChapoPerspective,
): ExecutionPlan {
  const state = getOrCreateState(sessionId);

  const plan: ExecutionPlan = {
    planId: nanoid(),
    sessionId,
    status: 'draft',
    chapoPerspective,
    summary: '',
    tasks: [],
    estimatedDuration: '',
    overallRisk: chapoPerspective.riskAssessment,
    createdAt: new Date().toISOString(),
  };

  state.currentPlan = plan;
  state.currentPhase = 'planning';
  schedulePersist(sessionId);
  return plan;
}

/**
 * Add DEVO's ops-focused perspective to the current plan
 */
export function addDevoPerspective(
  sessionId: string,
  perspective: DevoPerspective,
): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;

  state.currentPlan.devoPerspective = perspective;
  schedulePersist(sessionId);
  return state.currentPlan;
}

/**
 * Finalize the plan with summary and tasks, ready for approval
 */
export function finalizePlan(
  sessionId: string,
  summary: string,
  tasks: PlanTask[],
  estimatedDuration?: string,
): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;

  state.currentPlan.summary = summary;
  state.currentPlan.tasks = tasks;
  state.currentPlan.status = 'pending_approval';
  state.currentPhase = 'waiting_plan_approval';

  if (estimatedDuration) {
    state.currentPlan.estimatedDuration = estimatedDuration;
  }

  // Calculate overall risk from all perspectives
  const risks: RiskLevel[] = [state.currentPlan.chapoPerspective.riskAssessment];
  // DEVO doesn't have riskAssessment, but concerns affect overall risk
  if (state.currentPlan.devoPerspective?.infrastructureChanges?.length) {
    risks.push('medium');
  }
  state.currentPlan.overallRisk = risks.includes('high')
    ? 'high'
    : risks.includes('medium')
      ? 'medium'
      : 'low';

  // Store tasks in state for tracking
  state.tasks = tasks;
  state.taskOrder = tasks.map((t) => t.taskId);

  schedulePersist(sessionId);
  return state.currentPlan;
}

/**
 * Approve the current plan and move to execution phase
 */
export function approvePlan(sessionId: string): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;
  if (state.currentPlan.status !== 'pending_approval') return undefined;

  state.currentPlan.status = 'approved';
  state.currentPlan.approvedAt = new Date().toISOString();
  state.currentPhase = 'execution';

  schedulePersist(sessionId);
  return state.currentPlan;
}

/**
 * Reject the current plan
 */
export function rejectPlan(
  sessionId: string,
  reason: string,
): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;

  state.currentPlan.status = 'rejected';
  state.currentPlan.rejectedAt = new Date().toISOString();
  state.currentPlan.rejectionReason = reason;

  // Move plan to history
  state.planHistory.push(state.currentPlan);
  state.currentPlan = undefined;
  state.currentPhase = 'qualification'; // Reset to allow new approach

  // Clear tasks
  state.tasks = [];
  state.taskOrder = [];

  schedulePersist(sessionId);
  return state.planHistory[state.planHistory.length - 1];
}

/**
 * Get the current execution plan
 */
export function getCurrentPlan(sessionId: string): ExecutionPlan | undefined {
  const state = getState(sessionId);
  return state?.currentPlan;
}

/**
 * Get plan history
 */
export function getPlanHistory(sessionId: string): ExecutionPlan[] {
  const state = getState(sessionId);
  return state?.planHistory ?? [];
}

/**
 * Mark plan as executing
 */
export function startPlanExecution(sessionId: string): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;
  if (state.currentPlan.status !== 'approved') return undefined;

  state.currentPlan.status = 'executing';
  state.currentPhase = 'execution';
  schedulePersist(sessionId);
  return state.currentPlan;
}

/**
 * Mark plan as completed and move to history
 */
export function completePlan(sessionId: string): ExecutionPlan | undefined {
  const state = getState(sessionId);
  if (!state?.currentPlan) return undefined;

  state.currentPlan.status = 'completed';
  state.planHistory.push(state.currentPlan);

  const completedPlan = state.currentPlan;
  state.currentPlan = undefined;
  state.currentPhase = 'review';

  schedulePersist(sessionId);
  return completedPlan;
}
