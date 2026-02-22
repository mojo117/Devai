import { llmRouter } from '../../../llm/router.js';
import { getToolsForLLM } from '../../../tools/registry.js';
import { executeToolWithApprovalBridge } from '../../../actions/approvalBridge.js';
import type { LLMMessage } from '../../../llm/types.js';
import { getCombinedSystemContextBlock } from '../../systemContext.js';
import type { DevoPerspective, EffortEstimate, QualificationResult } from '../../types.js';
import { getAgent } from '../agentAccess.js';
import { buildToolResultContent } from '../requestUtils.js';
import type { SendEventFn } from '../shared.js';
import { parseJsonObjectFromModelOutput } from '../planParsing.js';

/**
 * Get DEVO's ops-focused perspective (read-only exploration)
 */
export async function getDevoPerspective(
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

  const parsed = parseJsonObjectFromModelOutput(finalContent);

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
