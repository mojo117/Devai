import * as stateManager from '../stateManager.js';
import type { AgentName } from '../types.js';

export type PlanStepStatus = 'todo' | 'doing' | 'done' | 'blocked';

const PLAN_STEP_STATUSES = new Set<PlanStepStatus>(['todo', 'doing', 'done', 'blocked']);
const PLAN_STEP_OWNERS = new Set<AgentName>(['chapo', 'devo', 'scout', 'caio']);

export interface ChapoPlanStep {
  id: string;
  text: string;
  owner: AgentName;
  status: PlanStepStatus;
}

export interface PlanSetResult {
  success: boolean;
  planId?: string;
  stepsCount?: number;
  updatedAt?: string;
  error?: string;
}

export function setChapoPlan(
  sessionId: string,
  args: { title: string; steps: ChapoPlanStep[] },
): PlanSetResult {
  const title = String(args.title || '').trim();
  const stepsInput = Array.isArray(args.steps) ? args.steps : [];

  if (!title) {
    return { success: false, error: 'title is required' };
  }
  if (stepsInput.length === 0) {
    return { success: false, error: 'steps must contain at least one step' };
  }

  const stepIdSet = new Set<string>();
  let doingCount = 0;

  const steps: ChapoPlanStep[] = [];
  for (const raw of stepsInput) {
    const id = String(raw?.id || '').trim();
    const text = String(raw?.text || '').trim();
    const owner = String(raw?.owner || '').trim() as AgentName;
    const status = String(raw?.status || '').trim() as PlanStepStatus;

    if (!id || !text) {
      return { success: false, error: 'Each step requires non-empty id and text' };
    }
    if (stepIdSet.has(id)) {
      return { success: false, error: `Duplicate step id: ${id}` };
    }
    if (!PLAN_STEP_OWNERS.has(owner)) {
      return { success: false, error: `Invalid step owner: ${owner}` };
    }
    if (!PLAN_STEP_STATUSES.has(status)) {
      return { success: false, error: `Invalid step status: ${status}` };
    }

    if (status === 'doing') doingCount += 1;
    stepIdSet.add(id);
    steps.push({ id, text, owner, status });
  }

  if (doingCount > 1) {
    return { success: false, error: 'Only one step may be in status "doing"' };
  }

  const now = new Date().toISOString();
  const existing = stateManager.getState(sessionId)?.taskContext?.gatheredInfo?.chapoPlan;
  const previousVersion = (
    existing
    && typeof existing === 'object'
    && typeof (existing as { version?: unknown }).version === 'number'
  )
    ? ((existing as { version: number }).version)
    : 0;
  const nextVersion = previousVersion + 1;
  const planId = `chapo-plan-${Date.now()}`;

  stateManager.setGatheredInfo(sessionId, 'chapoPlan', {
    planId,
    version: nextVersion,
    title,
    steps,
    updatedAt: now,
  });

  return {
    success: true,
    planId,
    stepsCount: steps.length,
    updatedAt: now,
  };
}
