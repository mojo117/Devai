// apps/api/src/agents/deterministicRouter/index.ts
import type { CapabilityAnalysis } from '../analyzer/types.js';
import type { AssignedTask, RoutingResult } from './types.js';
import { CAPABILITY_AGENT_MAP } from './types.js';

/**
 * Route a capability analysis to agents
 * This is pure code - no LLM involved
 */
export function routeAnalysis(analysis: CapabilityAnalysis): RoutingResult {
  // 1. Handle clarification first
  if (analysis.needs.clarification && analysis.question) {
    return {
      type: 'question',
      question: analysis.question,
    };
  }

  // 2. Map tasks to agents
  const assignedTasks: AssignedTask[] = analysis.tasks.map((task, index) => ({
    ...task,
    index,
    agent: CAPABILITY_AGENT_MAP[task.capability] || 'koda', // Default to koda
  }));

  // 3. Sort by dependencies
  const sortedTasks = topologicalSort(assignedTasks);

  return {
    type: 'execute',
    tasks: sortedTasks,
  };
}

/**
 * Topological sort for task dependencies
 */
export function topologicalSort(tasks: AssignedTask[]): AssignedTask[] {
  const sorted: AssignedTask[] = [];
  const visited = new Set<number>();
  const visiting = new Set<number>();

  const taskMap = new Map(tasks.map(t => [t.index, t]));

  function visit(task: AssignedTask) {
    if (visited.has(task.index)) return;
    if (visiting.has(task.index)) {
      throw new Error(`Circular dependency detected at task ${task.index}`);
    }

    visiting.add(task.index);

    // Visit dependency first
    if (task.depends_on !== undefined) {
      const dep = taskMap.get(task.depends_on);
      if (dep) visit(dep);
    }

    visiting.delete(task.index);
    visited.add(task.index);
    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task);
  }

  return sorted;
}

export * from './types.js';
