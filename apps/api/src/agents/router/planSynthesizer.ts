import { nanoid } from 'nanoid';
import { llmRouter } from '../../llm/router.js';
import * as stateManager from '../stateManager.js';
import { getCombinedSystemContextBlock } from '../systemContext.js';
import type {
  ChapoPerspective,
  DevoPerspective,
  PlanTask,
  TaskPriority,
} from '../types.js';
import { getAgent } from './agentAccess.js';
import { parseAssignedAgent, parseJsonObjectFromModelOutput } from './planParsing.js';
import type { SendEventFn } from './shared.js';

/**
 * CHAPO synthesizes all perspectives into an execution plan with tasks.
 */
export async function synthesizePlan(
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

  let summary = 'Plan erstellt.';
  const tasks: PlanTask[] = [];
  const parsed = parseJsonObjectFromModelOutput(response.content) as {
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
      assignedAgent: parseAssignedAgent(taskData.assignedAgent),
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

  if (!parsed.tasks && !parsed.summary) {
    console.warn('[agents] Failed to parse plan synthesis JSON from model output');
  }

  return { summary, tasks };
}
