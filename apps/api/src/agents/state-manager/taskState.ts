import { nanoid } from 'nanoid';
import { getOrCreateState, getState, schedulePersist } from './core.js';
import type {
  AgentName,
  ExecutedTool,
  PlanTask,
  PlannedToolCall,
  TaskPriority,
  TaskStatus,
} from '../types.js';

/**
 * Create a new task
 */
export function createTask(
  sessionId: string,
  taskData: {
    planId: string;
    subject: string;
    description: string;
    activeForm: string;
    assignedAgent: AgentName;
    priority?: TaskPriority;
    blockedBy?: string[];
    toolsToExecute?: PlannedToolCall[];
  },
): PlanTask {
  const state = getOrCreateState(sessionId);

  const task: PlanTask = {
    taskId: nanoid(),
    planId: taskData.planId,
    subject: taskData.subject,
    description: taskData.description,
    activeForm: taskData.activeForm,
    assignedAgent: taskData.assignedAgent,
    priority: taskData.priority ?? 'normal',
    status: 'pending',
    blockedBy: taskData.blockedBy ?? [],
    blocks: [],
    toolsToExecute: taskData.toolsToExecute,
    toolsExecuted: [],
    createdAt: new Date().toISOString(),
  };

  state.tasks.push(task);
  state.taskOrder.push(task.taskId);

  // Update blocks for dependencies
  for (const blockedById of task.blockedBy) {
    const blockerTask = state.tasks.find((t) => t.taskId === blockedById);
    if (blockerTask && !blockerTask.blocks.includes(task.taskId)) {
      blockerTask.blocks.push(task.taskId);
    }
  }

  schedulePersist(sessionId);
  return task;
}

/**
 * Get a task by ID
 */
export function getTask(
  sessionId: string,
  taskId: string,
): PlanTask | undefined {
  const state = getState(sessionId);
  return state?.tasks.find((t) => t.taskId === taskId);
}

/**
 * Get all tasks for a session
 */
export function getTasks(sessionId: string): PlanTask[] {
  const state = getState(sessionId);
  return state?.tasks ?? [];
}

/**
 * Get tasks in execution order
 */
export function getTasksInOrder(sessionId: string): PlanTask[] {
  const state = getState(sessionId);
  if (!state) return [];

  return state.taskOrder
    .map((taskId) => state.tasks.find((t) => t.taskId === taskId))
    .filter((t): t is PlanTask => t !== undefined);
}

/**
 * Get the next task that is not blocked
 * Returns the first pending task whose blockedBy tasks are all completed
 */
export function getNextTask(sessionId: string): PlanTask | undefined {
  const state = getState(sessionId);
  if (!state) return undefined;

  // Get tasks in order
  const orderedTasks = getTasksInOrder(sessionId);

  for (const task of orderedTasks) {
    if (task.status !== 'pending') continue;

    // Check if all blocking tasks are completed
    const isBlocked = task.blockedBy.some((blockerId) => {
      const blocker = state.tasks.find((t) => t.taskId === blockerId);
      return blocker && blocker.status !== 'completed';
    });

    if (!isBlocked) {
      return task;
    }
  }

  return undefined;
}

/**
 * Update task status with optional additional data
 */
export function updateTaskStatus(
  sessionId: string,
  taskId: string,
  status: TaskStatus,
  options?: {
    progress?: number;
    result?: string;
    error?: string;
  },
): PlanTask | undefined {
  const state = getState(sessionId);
  const task = state?.tasks.find((t) => t.taskId === taskId);
  if (!task) return undefined;

  task.status = status;

  if (options?.progress !== undefined) {
    task.progress = options.progress;
  }

  if (options?.result !== undefined) {
    task.result = options.result;
  }

  if (options?.error !== undefined) {
    task.error = options.error;
  }

  // Update timestamps
  if (status === 'in_progress' && !task.startedAt) {
    task.startedAt = new Date().toISOString();
  }

  if (status === 'completed' || status === 'failed' || status === 'skipped') {
    task.completedAt = new Date().toISOString();
  }

  schedulePersist(sessionId);
  return task;
}

/**
 * Add a dependency between tasks
 */
export function addTaskDependency(
  sessionId: string,
  taskId: string,
  blockedByTaskId: string,
): boolean {
  const state = getState(sessionId);
  if (!state) return false;

  const task = state.tasks.find((t) => t.taskId === taskId);
  const blockerTask = state.tasks.find((t) => t.taskId === blockedByTaskId);

  if (!task || !blockerTask) return false;

  // Avoid circular dependencies
  if (blockerTask.blockedBy.includes(taskId)) {
    return false;
  }

  if (!task.blockedBy.includes(blockedByTaskId)) {
    task.blockedBy.push(blockedByTaskId);
  }

  if (!blockerTask.blocks.includes(taskId)) {
    blockerTask.blocks.push(taskId);
  }

  schedulePersist(sessionId);
  return true;
}

/**
 * Add an executed tool to a task
 */
export function addExecutedTool(
  sessionId: string,
  taskId: string,
  tool: ExecutedTool,
): PlanTask | undefined {
  const state = getState(sessionId);
  const task = state?.tasks.find((t) => t.taskId === taskId);
  if (!task) return undefined;

  if (!task.toolsExecuted) {
    task.toolsExecuted = [];
  }

  task.toolsExecuted.push(tool);
  schedulePersist(sessionId);
  return task;
}

/**
 * Get tasks by status
 */
export function getTasksByStatus(
  sessionId: string,
  status: TaskStatus,
): PlanTask[] {
  const state = getState(sessionId);
  return state?.tasks.filter((t) => t.status === status) ?? [];
}

/**
 * Get tasks assigned to a specific agent
 */
export function getTasksByAgent(
  sessionId: string,
  agent: AgentName,
): PlanTask[] {
  const state = getState(sessionId);
  return state?.tasks.filter((t) => t.assignedAgent === agent) ?? [];
}

/**
 * Check if all tasks are completed
 */
export function areAllTasksCompleted(sessionId: string): boolean {
  const state = getState(sessionId);
  if (!state || state.tasks.length === 0) return false;

  return state.tasks.every((t) => t.status === 'completed' || t.status === 'skipped');
}

/**
 * Get task execution progress summary
 */
export function getTaskProgress(sessionId: string): {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  skipped: number;
  percentComplete: number;
} {
  const state = getState(sessionId);
  const tasks = state?.tasks ?? [];

  const counts = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    skipped: tasks.filter((t) => t.status === 'skipped').length,
  };

  const percentComplete =
    counts.total > 0
      ? Math.round(((counts.completed + counts.skipped) / counts.total) * 100)
      : 0;

  return { ...counts, percentComplete };
}

/**
 * Skip all tasks that are blocked by a failed task
 */
export function skipBlockedTasks(
  sessionId: string,
  failedTaskId: string,
): PlanTask[] {
  const state = getState(sessionId);
  if (!state) return [];

  const skippedTasks: PlanTask[] = [];
  const failedTask = state.tasks.find((t) => t.taskId === failedTaskId);

  if (!failedTask) return [];

  // Recursively skip all tasks blocked by this one
  const skipRecursive = (taskId: string) => {
    const task = state.tasks.find((t) => t.taskId === taskId);
    if (!task) return;

    for (const blockedId of task.blocks) {
      const blockedTask = state.tasks.find((t) => t.taskId === blockedId);
      if (blockedTask && blockedTask.status === 'pending') {
        blockedTask.status = 'skipped';
        blockedTask.completedAt = new Date().toISOString();
        blockedTask.error = `Skipped due to failed dependency: ${failedTask.subject}`;
        skippedTasks.push(blockedTask);
        skipRecursive(blockedId);
      }
    }
  };

  skipRecursive(failedTaskId);
  return skippedTasks;
}
